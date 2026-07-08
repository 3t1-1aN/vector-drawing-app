// brush/mediums.js
// Drawing mediums: pen, marker, pencil, chalk. Each medium renders the
// same element geometry with a different character — pen is crisp, marker
// is broad and translucent, pencil is thin and grainy, chalk is thick and
// heavily textured. The medium is stored on element.style.medium and on
// the active brush.
//
// Pencil and chalk use multi-pass jittered strokes. Jitter is seeded from
// the element id so a given stroke looks stable across frames (no
// shimmering) and across save/load.

export const MEDIUMS = [
  { id: "pen",    label: "Pen",    passes: 1, spread: 0,    widthMul: 1.0,  alphaMul: 1.0,  cap: "round", dash: null,      perPass: [1.0] },
  { id: "marker", label: "Marker", passes: 1, spread: 0,    widthMul: 1.6,  alphaMul: 0.5,  cap: "round", dash: null,      perPass: [1.0] },
  { id: "pencil", label: "Pencil", passes: 3, spread: 0.55, widthMul: 0.7,  alphaMul: 0.6,  cap: "round", dash: null,      perPass: [0.5, 0.3, 0.2] },
  { id: "chalk",  label: "Chalk",  passes: 4, spread: 0.9,  widthMul: 1.2,  alphaMul: 1.0,  cap: "round", dash: [1, 2.5],  perPass: [0.4, 0.3, 0.2, 0.1] },
];

export const MEDIUM_IDS = MEDIUMS.map((m) => m.id);

export function getMedium(id) {
  return MEDIUMS.find((m) => m.id === id) || MEDIUMS[0];
}

// --- Seeded PRNG (mulberry32) --------------------------------------------

function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

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

// --- Geometry sampling ----------------------------------------------------

/** Polyline of points describing the element's outline (world space). */
export function samplePoints(el) {
  switch (el.type) {
    case "line":
      return [{ x: el.startX, y: el.startY }, { x: el.endX, y: el.endY }];
    case "path":
      return el.points.map((p) => ({ x: p.x, y: p.y }));
    case "rect":
    case "square": {
      const c = rectCorners(el);
      return [...c, c[0]];
    }
    case "triangle": {
      const c = el.corners;
      return [...c, c[0]];
    }
    case "circle": {
      const n = Math.max(24, Math.min(96, Math.floor(el.r * 0.5)));
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        pts.push({ x: el.cx + Math.cos(a) * el.r, y: el.cy + Math.sin(a) * el.r });
      }
      return pts;
    }
    default:
      return [];
  }
}

function rectCorners(el) {
  if (el.corners) return el.corners;
  const x1 = Math.min(el.startX, el.endX);
  const y1 = Math.min(el.startY, el.endY);
  const x2 = Math.max(el.startX, el.endX);
  const y2 = Math.max(el.startY, el.endY);
  return [
    { x: x1, y: y1 }, { x: x2, y: y1 },
    { x: x2, y: y2 }, { x: x1, y: y2 },
  ];
}

// --- Rendering ------------------------------------------------------------

/**
 * Stroke an element with its medium. Called in world space (view transform
 * already applied). `styleOverride` lets the caller force a color (used for
 * the recognized-shape preview flash); `alphaScale` multiplies the medium
 * alpha (used for live preview dimming).
 */
export function strokeMedium(ctx, el, view, { styleOverride = null, alphaScale = 1 } = {}) {
  const st = el.style || {};
  const medium = getMedium(st.medium || "pen");
  const color = styleOverride?.stroke || st.stroke || "#888";
  const baseAlpha = (st.opacity ?? 1) * medium.alphaMul * alphaScale;
  const baseWidth = (st.strokeWidth || 2) * medium.widthMul;
  const widthPx = baseWidth / view.zoom;

  ctx.strokeStyle = color;
  ctx.lineCap = medium.cap;
  ctx.lineJoin = "round";
  if (medium.dash) {
    ctx.setLineDash(medium.dash.map((d) => d / view.zoom));
  }

  if (medium.passes <= 1 && medium.spread === 0) {
    // Crisp single pass — pen and marker.
    ctx.globalAlpha = baseAlpha;
    ctx.lineWidth = widthPx;
    ctx.beginPath();
    tracePath(ctx, el);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    return;
  }

  // Textured multi-pass — pencil and chalk.
  const pts = samplePoints(el);
  if (pts.length < 2) {
    ctx.setLineDash([]);
    return;
  }
  const spread = (medium.spread * baseWidth) / view.zoom;
  const seed = hashStr(el.id || "x");
  for (let p = 0; p < medium.passes; p++) {
    const rng = mulberry32(seed + p * 1013);
    ctx.globalAlpha = baseAlpha * (medium.perPass[p] ?? 1);
    ctx.lineWidth = widthPx * (0.85 + (p % 2) * 0.3);
    ctx.beginPath();
    // Slight per-pass tangential shift gives chalk its flat, dragged edge.
    const shift = (p - (medium.passes - 1) / 2) * (spread * 0.15);
    for (let i = 0; i < pts.length; i++) {
      const jx = (rng() - 0.5) * spread;
      const jy = (rng() - 0.5) * spread;
      const x = pts[i].x + jx;
      const y = pts[i].y + jy;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
}

/** Trace the element's crisp outline (used by the pen/marker single pass). */
function tracePath(ctx, el) {
  switch (el.type) {
    case "line":
      ctx.moveTo(el.startX, el.startY);
      ctx.lineTo(el.endX, el.endY);
      break;
    case "rect":
    case "square": {
      const c = rectCorners(el);
      ctx.moveTo(c[0].x, c[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(c[i].x, c[i].y);
      ctx.closePath();
      break;
    }
    case "circle":
      ctx.moveTo(el.cx + el.r, el.cy);
      ctx.arc(el.cx, el.cy, el.r, 0, Math.PI * 2);
      break;
    case "triangle": {
      const c = el.corners;
      ctx.moveTo(c[0].x, c[0].y);
      ctx.lineTo(c[1].x, c[1].y);
      ctx.lineTo(c[2].x, c[2].y);
      ctx.closePath();
      break;
    }
    case "path":
      if (el.points.length === 0) break;
      ctx.moveTo(el.points[0].x, el.points[0].y);
      for (let i = 1; i < el.points.length; i++) {
        ctx.lineTo(el.points[i].x, el.points[i].y);
      }
      break;
  }
}
