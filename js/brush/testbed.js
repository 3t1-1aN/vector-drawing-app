// brush/testbed.js
// Development harness for comparing the brushes. Not part of the UI: it adds
// no controls and does nothing unless asked, via `?brushtest` in the URL or
// `brushTest()` in the console.
//
// It exists because the brushes have to be distinguishable on the same simple
// stroke, and hand-drawing five lines to check that is not repeatable. Each
// case synthesises the points a real pointer would have produced -- including
// the pressure and speed the tracker would have measured -- and commits them
// as ordinary path elements. Nothing here bypasses the engine, so what it
// draws is exactly what drawing by hand produces.

import { BRUSH_PRESETS } from "./presets.js";
import { createIdElement } from "../scene/element.js";

const RUN = 260;        // length of the reference line, world units
const CASE_GAP = 62;    // vertical step between cases
const PRESET_GAP = 360; // horizontal step between presets

/**
 * One synthetic stroke.
 *
 * @param at     (t) -> { x, y } for t in 0..1
 * @param press  (t) -> pressure 0..1
 * @param speed  (t) -> normalised speed 0..1
 * @param steps  stored points, standing in for the capture rate
 */
function stroke(at, press, speed, steps = 90) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const { x, y } = at(t);
    pts.push({ x, y, p: press(t), v: speed(t) });
  }
  return pts;
}

const flat = (v) => () => v;
const line = (x, y, len) => (t) => ({ x: x + len * t, y });

/** The behaviours worth checking, each as one or two strokes at (x, y). */
function cases(x, y) {
  const mid = flat(0.65);
  return [
    { name: "baseline", pts: stroke(line(x, y, RUN), mid, flat(0.35)) },
    { name: "slow", pts: stroke(line(x, y, RUN), mid, flat(0.1)) },
    // Fewer stored points as well as a higher speed: that is what a fast
    // stroke actually looks like coming out of the tracker.
    { name: "fast", pts: stroke(line(x, y, RUN), mid, flat(0.95), 26) },
    { name: "light", pts: stroke(line(x, y, RUN), flat(0.15), flat(0.35)) },
    { name: "heavy", pts: stroke(line(x, y, RUN), flat(1), flat(0.35)) },
    {
      // Pressure swelling through the middle: the clearest read on how a
      // preset maps force to width and to darkness.
      name: "ramp",
      pts: stroke(line(x, y, RUN), (t) => 0.08 + 0.92 * Math.sin(t * Math.PI), flat(0.3)),
    },
    {
      // Right-angle reversal: nib direction response, and whether resampling
      // holds together where the tangent flips.
      name: "direction",
      pts: stroke((t) => (t < 0.5
        ? { x: x + RUN * 0.6 * (t * 2), y }
        : { x: x + RUN * 0.6, y: y + 40 * (t - 0.5) * 2 }), mid, flat(0.4)),
    },
    {
      // Sine: how the nib shades through continuously changing direction.
      name: "curve",
      pts: stroke((t) => ({ x: x + RUN * t, y: y + Math.sin(t * Math.PI * 2) * 14 }),
                  mid, flat(0.4)),
    },
    { name: "short", pts: stroke(line(x, y, 22), mid, flat(0.3), 10) },
    {
      // Crossing passes, to read opacity accumulation between strokes.
      name: "overlap",
      pts: stroke(line(x, y, RUN), mid, flat(0.35)),
      extra: stroke((t) => ({ x: x + RUN * 0.45 + 70 * t, y: y - 22 + 44 * t }),
                    mid, flat(0.35)),
    },
  ];
}

/**
 * Lay out every preset (across) against every case (down) and commit the
 * result. Existing work is untouched; the grid goes below it.
 *
 * `repeat` stacks extra copies of the grid, which is how the renderer's cost
 * per committed stroke gets measured -- one grid is not enough scene to tell
 * whether the cache is doing its job.
 */
function runBrushTest(app, { baseWidth = 6, repeat = 1 } = {}) {
  const bounds = app.scene.unionBounds();
  const x0 = bounds ? bounds.minX : 140;
  const y0 = bounds ? bounds.maxY + 120 : 140;
  const made = [];

  const add = (pts, presetId) => {
    const el = createIdElement("path", { points: pts });
    el.style.medium = presetId;
    el.style.strokeWidth = baseWidth;
    app.scene.add(el);
    made.push(el);
  };

  const gridH = cases(0, 0).length * CASE_GAP + 60;
  for (let g = 0; g < Math.max(1, repeat); g++) {
    BRUSH_PRESETS.forEach((preset, col) => {
      const x = x0 + col * PRESET_GAP;
      cases(x, y0 + g * gridH).forEach((c, row) => {
        const dy = row * CASE_GAP;
        const shift = (p) => ({ ...p, y: p.y + dy });
        add(c.pts.map(shift), preset.id);
        if (c.extra) add(c.extra.map(shift), preset.id);
      });
    });
  }

  console.table(cases(0, 0).map((c, i) => ({ row: i + 1, case: c.name })));
  console.log(
    `brush test: ${made.length} strokes. Columns left to right: ` +
    BRUSH_PRESETS.map((p) => `${p.id} (${p.tip})`).join(", "),
  );
  return made;
}

export function installBrushTestbed(app) {
  let made = [];
  const clear = () => {
    for (const el of made) app.scene.remove(el.id);
    made = [];
  };
  const run = (opts) => {
    clear();
    made = runBrushTest(app, opts);
    return made.length;
  };
  // Console handles, deliberately not wired to any on-screen control.
  window.brushTest = run;
  window.brushTestClear = clear;
  if (new URLSearchParams(location.search).has("brushtest")) run();
  return { run, clear };
}
