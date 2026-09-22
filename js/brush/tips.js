// brush/tips.js
// Stages 3 and 4: brush tips and texture.
//
// Everything here is generated once from a fixed seed and then reused. That
// is deliberate — texture that is re-randomised per point shimmers between
// frames, cannot be cached, and looks different every time a file is
// reopened. Baking the irregularity into a small set of sprites and one paper
// tile keeps the variation controlled and reproducible while still reading as
// physical rather than mechanical.
//
// Sprites are pure alpha masks (white). The renderer stamps them into a mask
// layer and tints the result in one pass, so a stroke costs one fill no
// matter how many stamps it contains.

const SPRITE_PX = 96;      // sprite resolution; stamps scale down from here
const VARIANTS = 4;        // rim variants cycled along a stroke
const PAPER_PX = 256;      // grain tile, tiled across the stroke

// --- Deterministic noise ---------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Stable hash noise in 0..1 for an integer lattice point. Used by the
 * renderer to break up stamp alpha by position: because it is a pure
 * function of world position, the break-up is locked to the paper rather
 * than to the stroke, and redrawing gives the same result.
 */
export function hashNoise(x, y, seed = 0) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return ((h >>> 0) % 65536) / 65536;
}

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

// --- Tip sprites -----------------------------------------------------------

const spriteCache = new Map();

/**
 * Alpha mask for a round tip.
 *
 * `hardness` sets where the falloff begins: 1 keeps full alpha almost to the
 * rim (a pen or marker edge), 0 falls off from the centre (an airbrush-like
 * wash). The falloff itself is a multi-stop curve rather than a linear ramp
 * because a linear radial gradient reads as a visible ring.
 */
function buildRoundSprite(hardness, edgeNoise, variant) {
  const c = makeCanvas(SPRITE_PX, SPRITE_PX);
  const ctx = c.getContext("2d");
  const r = SPRITE_PX / 2;
  const core = Math.max(0, Math.min(0.92, hardness * 0.92));

  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, "rgba(255,255,255,1)");
  if (core > 0) g.addColorStop(core, "rgba(255,255,255,1)");
  // Squared falloff: the alpha ramp that a physically thinning edge produces.
  for (let i = 1; i <= 5; i++) {
    const t = i / 6;
    const stop = core + (1 - core) * t;
    g.addColorStop(stop, `rgba(255,255,255,${(1 - t) * (1 - t)})`);
  }
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SPRITE_PX, SPRITE_PX);

  if (edgeNoise > 0) {
    // Bite irregular notches out of the rim so the stroke edge is not a
    // machined curve. Four variants cycle along the stroke; one sprite
    // repeated every 0.09 diameters would read as a regular pattern.
    const rng = mulberry32(0x9e37 + variant * 7919);
    ctx.globalCompositeOperation = "destination-out";
    const notches = 26;
    for (let i = 0; i < notches; i++) {
      const a = (i / notches) * Math.PI * 2 + rng() * 0.24;
      const depth = r * (0.06 + rng() * 0.18) * edgeNoise;
      const rr = r - depth * 0.35;
      ctx.globalAlpha = 0.35 + rng() * 0.5;
      ctx.beginPath();
      ctx.arc(r + Math.cos(a) * rr, r + Math.sin(a) * rr, depth, 0, Math.PI * 2);
      ctx.fill();
    }
    // A little interior pitting is what separates graphite from a grey disc.
    const pits = Math.round(30 * edgeNoise);
    for (let i = 0; i < pits; i++) {
      const a = rng() * Math.PI * 2;
      const d = Math.sqrt(rng()) * r * 0.8;
      ctx.globalAlpha = 0.12 + rng() * 0.22;
      ctx.beginPath();
      ctx.arc(r + Math.cos(a) * d, r + Math.sin(a) * d, r * (0.03 + rng() * 0.07), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
  return c;
}

/**
 * Mean alpha along a sprite's diameter.
 *
 * The renderer corrects per-stamp alpha for how many stamps overlap, and that
 * count is only meaningful in units of *solid* coverage. A soft tip whose
 * alpha falls off from the centre covers about a third of what its diameter
 * suggests, so without this the correction over-divides and a stroke comes
 * out far lighter than the preset asks for.
 */
function measureCoverage(sprite) {
  const ctx = sprite.getContext("2d");
  const mid = Math.floor(SPRITE_PX / 2);
  const row = ctx.getImageData(0, mid, SPRITE_PX, 1).data;
  let sum = 0;
  for (let i = 0; i < SPRITE_PX; i++) sum += row[i * 4 + 3] / 255;
  return Math.max(0.05, sum / SPRITE_PX);
}

/**
 * Pre-scaled copies of a sprite, largest first.
 *
 * A stroke is thousands of stamps, and stamping a 12px tip from a 96px source
 * means the browser filters an 8x reduction every time. Keeping reduced copies
 * and stamping from the nearest one is the single biggest cost saving in the
 * renderer; it is also slightly better quality, because each reduction is done
 * once with full filtering instead of per stamp.
 */
function buildMipLevels(base) {
  const levels = [base];
  for (let size = SPRITE_PX >> 1; size >= 8; size >>= 1) {
    const c = makeCanvas(size, size);
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(levels[levels.length - 1], 0, 0, size, size);
    levels.push(c);
  }
  return levels;
}

/** Smallest pre-scaled copy that still covers `diameter` px. */
export function spriteFor(levels, diameter) {
  for (let i = levels.length - 1; i > 0; i--) {
    if (levels[i].width >= diameter) return levels[i];
  }
  return levels[0];
}

/**
 * Tip set for a preset, built on first use.
 * @returns { variants, coverage }  variants[i] is a mip chain
 */
export function getTipSprites(preset) {
  const key = `${preset.hardness}|${preset.edgeNoise}`;
  let set = spriteCache.get(key);
  if (!set) {
    const count = preset.edgeNoise > 0 ? VARIANTS : 1;
    const variants = [];
    for (let i = 0; i < count; i++) {
      variants.push(buildMipLevels(buildRoundSprite(preset.hardness, preset.edgeNoise, i)));
    }
    set = { variants, coverage: measureCoverage(variants[0][0]) };
    spriteCache.set(key, set);
  }
  return set;
}

// --- Paper grain -----------------------------------------------------------

let paperTile = null;

/**
 * Tileable paper tooth: value noise at two scales, held in the alpha channel.
 *
 * Applied by the renderer as `destination-out`, so alpha here means "how much
 * ink this part of the paper refuses to hold". Two octaves give both the
 * coarse fibre and the fine tooth; one octave alone looks like TV static.
 */
export function getPaperTile() {
  if (paperTile) return paperTile;
  const c = makeCanvas(PAPER_PX, PAPER_PX);
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(PAPER_PX, PAPER_PX);
  const coarse = valueNoiseField(PAPER_PX, 32, 0x51ed);
  const fine = valueNoiseField(PAPER_PX, 128, 0x2b7f);
  for (let i = 0; i < PAPER_PX * PAPER_PX; i++) {
    const n = coarse[i] * 0.55 + fine[i] * 0.45;
    // Bias toward the middle so the grain modulates rather than punches
    // holes; the renderer's globalAlpha scales the depth from there.
    const a = Math.max(0, Math.min(1, (n - 0.35) * 1.5));
    img.data[i * 4] = 255;
    img.data[i * 4 + 1] = 255;
    img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = Math.round(a * 255);
  }
  ctx.putImageData(img, 0, 0);
  paperTile = c;
  return c;
}

/** Bilinearly upsampled seeded value noise, wrapping so the tile repeats. */
function valueNoiseField(size, cells, seed) {
  const rng = mulberry32(seed);
  const grid = new Float32Array(cells * cells);
  for (let i = 0; i < grid.length; i++) grid[i] = rng();
  const out = new Float32Array(size * size);
  const step = cells / size;
  for (let y = 0; y < size; y++) {
    const gy = y * step;
    const y0 = Math.floor(gy);
    const fy = gy - y0;
    for (let x = 0; x < size; x++) {
      const gx = x * step;
      const x0 = Math.floor(gx);
      const fx = gx - x0;
      const x1 = (x0 + 1) % cells;
      const y1 = (y0 + 1) % cells;
      const a = grid[y0 * cells + x0];
      const b = grid[y0 * cells + x1];
      const c2 = grid[y1 * cells + x0];
      const d = grid[y1 * cells + x1];
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      out[y * size + x] = (a + (b - a) * sx) * (1 - sy) + (c2 + (d - c2) * sx) * sy;
    }
  }
  return out;
}

export const PAPER_TILE_PX = PAPER_PX;
