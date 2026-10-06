// brush/presets.js
// Brush presets: pure data describing each tool's physical behaviour. This
// module knows nothing about canvas, elements or the UI — the engine reads
// these numbers and the UI reads `swatch` for its SVG previews.
//
// The pipeline each preset feeds is:
//   input -> physics (pressure/velocity/resample) -> tip -> texture -> render
// so every field below belongs to exactly one of those stages.

/** Tip families. The renderer branches on these; nothing else does. */
export const TIP_ROUND = "round";    // stamped sprite, soft or hard
export const TIP_RIBBON = "ribbon";  // filled variable-width outline
export const TIP_NIB = "nib";        // filled outline swept along a fixed nib axis
export const TIP_FILL = "fill";      // no tip: the path's enclosed area is inked

const DEG = Math.PI / 180;

/**
 * Field reference (all ratios unless noted):
 *
 *  sizeMul      base width multiplier over style.strokeWidth (screen px)
 *  alphaMul     base opacity multiplier over style.opacity
 *  spacing      stamp step as a fraction of tip diameter (round tips only)
 *  hardness     0 = fully soft falloff, 1 = hard edge (round tips only)
 *  buildup      0 = uniform alpha within a stroke, 1 = raw per-stamp buildup
 *  smoothing    extra input smoothing on top of the user's setting
 *  width        pressure -> width:  min..1 through pow(p, gamma)
 *  alpha        pressure -> alpha:  min..1 through pow(p, gamma)
 *  vel          normalised speed -> width/alpha gain (signed), texture gain
 *  taper        entry/exit ramp lengths in tip diameters, and the tip scale
 *               reached at the very ends
 *  grain        paper texture: bite strength, tile scale, extra bite at speed
 *  edgeNoise    deterministic rim irregularity baked into the tip sprite
 *  nib          nib geometry (TIP_NIB only): axis angle, narrowest fraction,
 *               low-speed ink pooling, width gain at direction changes
 *  swatch       width/alpha/dash used only by the wheel's SVG previews, plus
 *               `filled` for mediums the preview has to show as an area
 */
export const BRUSH_PRESETS = [
  {
    id: "pencil",
    label: "Pencil",
    tip: TIP_ROUND,
    sizeMul: 0.85,
    alphaMul: 1,
    spacing: 0.09,
    // The mark itself is brush/graphite.js. These tip fields only matter
    // if that rasteriser declines a stroke and the stamp path takes over.
    hardness: 0.4,
    // Graphite lays down in layers, so a little within-stroke buildup is
    // right — but only a little, or light pressure can never stay light.
    buildup: 0.3,
    smoothing: 0.1,
    width: { min: 0.35, gamma: 0.9 },
    alpha: { min: 0.16, gamma: 1.55 },
    vel: { width: -0.06, alpha: -0.16, texture: 0.5 },
    taper: { in: 1.2, out: 1.2, minScale: 0.35 },
    grain: { strength: 0.78, scale: 1.0, speedGain: 0.28 },
    edgeNoise: 0.5,
    nib: null,
    swatch: { widthMul: 0.8, alphaMul: 0.62, dash: null },
    // Screen pixels on the size ring: a sharp point through a blunt soft lead.
    widthRange: { min: 1, max: 7.5, step: 0.5, presets: [1, 2, 4, 6] },
  },
  {
    id: "pen",
    label: "Pen",
    // A ballpoint lays a continuous line, not a row of dabs; a filled
    // outline gives the even opacity and clean edge that implies.
    tip: TIP_RIBBON,
    sizeMul: 1.0,
    alphaMul: 1.0,
    spacing: 0.1,
    hardness: 1,
    buildup: 0,
    smoothing: 0.28,
    width: { min: 0.82, gamma: 1.0 },
    alpha: { min: 0.93, gamma: 1.0 },
    vel: { width: -0.04, alpha: 0, texture: 0 },
    taper: { in: 0.5, out: 0.9, minScale: 0.55 },
    grain: null,
    edgeNoise: 0,
    nib: null,
    swatch: { widthMul: 1.0, alphaMul: 1.0, dash: null },
    // A technical pen through a bold ballpoint. Nothing in between is a brush.
    widthRange: { min: 0.5, max: 3, step: 0.1, presets: [0.5, 1, 2, 3] },
  },
  {
    id: "soft",
    label: "Soft Paint",
    tip: TIP_ROUND,
    sizeMul: 1.7,
    alphaMul: 0.55,
    // Tight spacing keeps the soft falloff reading as one continuous
    // wash rather than a chain of discs.
    spacing: 0.055,
    hardness: 0,
    buildup: 0.75,
    smoothing: 0.2,
    width: { min: 0.3, gamma: 0.85 },
    alpha: { min: 0.1, gamma: 1.25 },
    vel: { width: -0.1, alpha: -0.1, texture: 0 },
    taper: { in: 1.6, out: 2.0, minScale: 0.2 },
    grain: null,
    edgeNoise: 0,
    nib: null,
    swatch: { widthMul: 1.7, alphaMul: 0.45, dash: null },
    // A small round through a wash brush, still a drawing brush rather than a roller.
    widthRange: { min: 3, max: 20, step: 0.5, presets: [3, 6, 12, 18] },
  },
  {
    id: "fountain",
    label: "Fountain Pen",
    tip: TIP_NIB,
    sizeMul: 1.3,
    alphaMul: 1.0,
    spacing: 0.1,
    hardness: 1,
    buildup: 0,
    smoothing: 0.22,
    width: { min: 0.28, gamma: 1.35 },
    alpha: { min: 0.9, gamma: 1.0 },
    vel: { width: -0.18, alpha: 0, texture: 0 },
    // Enough to read as a nib lifting off, but not so much that a short
    // stroke turns into a pointed leaf.
    taper: { in: 0.6, out: 1.0, minScale: 0.22 },
    grain: { strength: 0.12, scale: 1.4, speedGain: 0 },
    edgeNoise: 0,
    nib: {
      angle: -40 * DEG,  // right-handed italic hold
      narrow: 0.2,       // width kept when travelling along the nib edge
      pool: 0.34,        // extra width as the pen slows
      curveGain: 0.22,   // swell through direction changes
    },
    swatch: { widthMul: 1.25, alphaMul: 1.0, dash: null },
    // Extra-fine nib through a broad stub.
    widthRange: { min: 1, max: 8, step: 0.5, presets: [1, 2, 4, 7] },
  },
  {
    id: "marker",
    label: "Marker",
    tip: TIP_ROUND,
    sizeMul: 1.9,
    // Semi-transparent pigment: one pass is light, crossing passes darken.
    alphaMul: 0.42,
    spacing: 0.07,
    hardness: 0.8,
    buildup: 0.15,
    smoothing: 0.18,
    width: { min: 0.88, gamma: 1.0 },
    alpha: { min: 0.85, gamma: 1.0 },
    vel: { width: 0, alpha: -0.05, texture: 0.15 },
    taper: { in: 0.3, out: 0.45, minScale: 0.8 },
    grain: { strength: 0.2, scale: 1.2, speedGain: 0.1 },
    edgeNoise: 0.12,
    nib: null,
    swatch: { widthMul: 1.9, alphaMul: 0.42, dash: null },
    // A fine marker through a broad chisel. Wider than a pen, short of a paint roller.
    widthRange: { min: 4, max: 16, step: 0.5, presets: [4, 8, 12, 16] },
  },
  {
    id: "fill",
    label: "Fill",
    // The odd one out: this does not lay down a line at all. The path is read
    // as the edge of a shape and the area it encloses is inked, so a stroke
    // that crosses itself turns the re-enclosed part into a hole, and
    // crossing back over it a third time fills it in again.
    tip: TIP_FILL,
    sizeMul: 1.0,
    alphaMul: 1.0,
    spacing: 0.1,
    hardness: 1,
    buildup: 0,
    // Enough to polish the contour while drawing. High smoothing pulls the
    // path toward the straight line between its ends, and a shape with no
    // area left is a shape you cannot see.
    smoothing: 0.18,
    // Width and pressure both describe a tip, and this has none: the area
    // comes from where the hand went, so every node stays nominal.
    width: { min: 1, gamma: 1 },
    alpha: { min: 1, gamma: 1 },
    vel: { width: 0, alpha: 0, texture: 0 },
    taper: { in: 0, out: 0, minScale: 1 },
    grain: null,
    edgeNoise: 0,
    nib: null,
    swatch: { widthMul: 1, alphaMul: 1, dash: null, filled: true },
  },
];

/** Ids used by earlier versions, mapped to their closest current preset. */
const LEGACY_IDS = { chalk: "soft" };

export function getBrushPreset(id) {
  const key = LEGACY_IDS[id] || id;
  return BRUSH_PRESETS.find((p) => p.id === key) || BRUSH_PRESETS[1];
}

/** Pixel limits for the size ring. A fill has no tip, so it keeps the pen's numbers unused. */
export function widthRangeFor(id) {
  return getBrushPreset(id).widthRange || getBrushPreset("pen").widthRange;
}

/** True when a medium inks the area its path encloses rather than the path. */
export function isFilledMedium(id) {
  return getBrushPreset(id).tip === TIP_FILL;
}
