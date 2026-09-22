// tools/slice.js
// Slice deletes whole objects. Drag across a stroke and the entire thing
// greys out — that is the promise that letting go will remove it, not just
// the bit you crossed. Width of the swipe comes from the size slider, so a
// wider slice reaches ink it only grazes. One drag is one undo step.

import { screenToWorld } from "../core/view.js";
import { samplesFrom } from "../brush/input.js";
import { brushRadiusWorld } from "./erase.js";
import { hitTest } from "../scene/element.js";
import { RemoveElementsCommand } from "../scene/scene.js";

const state = {
  active: false,
  points: null,
  marked: null,   // ids greyed out, deleted on release
  scanned: 0,     // how much of the trail has already been tested
};

function remember(sample) {
  const w = screenToWorld(sample.x, sample.y);
  const last = state.points[state.points.length - 1];
  if (last && Math.hypot(w.x - last.x, w.y - last.y) < 0.4) return;
  state.points.push(w);
}

/** True when the swipe reaches this element's ink, not merely its bounding box. */
function touches(el, x, y, zoom) {
  const ink = (el.style?.strokeWidth || 2) / 2 / Math.max(zoom, 1e-6);
  return hitTest(el, x, y, brushRadiusWorld(zoom) + ink);
}

/** Points along the new part of the swipe, dense enough not to jump a thin stroke. */
function freshSamples(zoom) {
  const pts = state.points;
  const from = Math.max(0, state.scanned - 1);
  state.scanned = pts.length;
  const step = Math.max(0.75, brushRadiusWorld(zoom) * 0.5);
  const out = [];
  for (let i = from; i < pts.length; i++) {
    const a = pts[i];
    out.push(a);
    const b = pts[i + 1];
    if (!b) continue;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.floor(dist / step);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

function markTouched(app) {
  const zoom = app.view.zoom;
  const samples = freshSamples(zoom);
  if (samples.length === 0) return;
  for (const el of app.scene.elements) {
    if (state.marked.has(el.id)) continue;
    for (const p of samples) {
      if (touches(el, p.x, p.y, zoom)) {
        state.marked.add(el.id);
        break;
      }
    }
  }
}

export const sliceTool = {
  cursor() { return "crosshair"; },

  onDeactivate() {
    state.active = false;
    state.points = null;
    state.marked = null;
    state.scanned = 0;
  },

  onPointerDown(app, event) {
    if (event.button !== 0 || app.interaction.spaceDown) return;
    state.active = true;
    state.points = [];
    state.marked = new Set();
    state.scanned = 0;
    for (const s of samplesFrom(event)) remember(s);
    markTouched(app);
  },

  onPointerMove(app, event) {
    if (!state.active) return;
    for (const s of samplesFrom(event)) remember(s);
    markTouched(app);
  },

  onPointerUp(app, event) {
    if (event.button !== 0 || !state.active) return;
    for (const s of samplesFrom(event)) remember(s);
    markTouched(app);
    const doomed = [];
    for (const id of state.marked) {
      const el = app.scene.getById(id);
      if (el) doomed.push(el);
    }
    state.active = false;
    state.points = null;
    state.marked = null;
    state.scanned = 0;
    if (doomed.length === 0) return;
    app.history.push(new RemoveElementsCommand(doomed));
    for (const el of doomed) app.scene.remove(el.id);
  },

  /** The swipe being drawn, shown until the button comes up. */
  getSlice(app) {
    if (!state.active || !state.points || state.points.length === 0) return null;
    return { points: state.points, r: brushRadiusWorld(app.view.zoom) };
  },

  /** Ids of objects the swipe has crossed. The renderer greys these out. */
  getDoomed() {
    return state.active ? state.marked : null;
  },

  getPreview() { return null; },
};
