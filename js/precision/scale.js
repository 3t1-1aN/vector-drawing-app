// precision/scale.js
// Real-world drawing scale: maps world units to a chosen engineering unit
// (m, mm, cm, ft, in). `unitsPerWorldUnit` says how many of the chosen
// unit one world unit represents (e.g. unit 'm', scale 1 => 1 wu = 1 m).

export const UNITS = {
  m: { label: "m", factor: 1.0 },
  mm: { label: "mm", factor: 1000.0 },
  cm: { label: "cm", factor: 100.0 },
  ft: { label: "ft", factor: 3.28084 },
  in: { label: "in", factor: 39.3701 },
};

export const scaleSettings = {
  unit: "m",
  unitsPerWorldUnit: 1.0,
  // 'cad' = extension-line annotations, 'labels' = centroid pills, 'off' = none.
  dimensionMode: "cad",
};

export function setUnit(unit) {
  if (UNITS[unit]) scaleSettings.unit = unit;
}

export function setUnitsPerWorldUnit(value) {
  scaleSettings.unitsPerWorldUnit = Math.max(1e-6, Number(value) || 1);
}

export function setDimensionMode(mode) {
  if (mode === "cad" || mode === "labels" || mode === "off") {
    scaleSettings.dimensionMode = mode;
  }
}

/** @deprecated use dimensionMode */
export function setShowDimensions(on) {
  scaleSettings.dimensionMode = on ? "cad" : "off";
}

/** Convert a world-unit length to a numeric value in the current unit. */
export function worldToReal(world) {
  const u = UNITS[scaleSettings.unit];
  return world * scaleSettings.unitsPerWorldUnit * u.factor;
}

/** Convert a numeric value in the current unit to world units. */
export function realToWorld(real) {
  const u = UNITS[scaleSettings.unit];
  return real / (scaleSettings.unitsPerWorldUnit * u.factor);
}

/** Unit label for the current scale setting, e.g. "m". */
export function unitLabel() {
  return UNITS[scaleSettings.unit].label;
}

/** Convert a world-unit length to a formatted measurement string. */
export function formatLength(world) {
  const u = UNITS[scaleSettings.unit];
  const value = world * scaleSettings.unitsPerWorldUnit * u.factor;
  return `${value.toFixed(2)} ${u.label}`;
}

/**
 * A human-friendly scale-bar length in world units for the current zoom:
 * pick a "nice" round real-world length whose on-screen width lands near
 * `targetPx`. Returns { world, label }.
 */
export function niceScaleBarLength(targetPx, zoom) {
  const u = UNITS[scaleSettings.unit];
  // Convert target screen px -> world units -> real units.
  const worldTarget = targetPx / zoom;
  const realTarget = worldTarget * scaleSettings.unitsPerWorldUnit * u.factor;
  const niceReal = niceNumber(realTarget);
  const world = niceReal / (scaleSettings.unitsPerWorldUnit * u.factor);
  return { world, label: `${niceReal} ${u.label}` };
}

function niceNumber(x) {
  if (x <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(x)));
  const n = x / pow;
  let nice;
  if (n < 1.5) nice = 1;
  else if (n < 3) nice = 2;
  else if (n < 7) nice = 5;
  else nice = 10;
  return nice * pow;
}
