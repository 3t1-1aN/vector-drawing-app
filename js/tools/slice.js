// tools/slice.js
// Slice: the destructive eraser, drawn like any other stroke. The path you
// drag is the cut — it is not a straight blade — and when you let go, every
// stroke it crossed loses that part of itself. Width comes from the size
// slider. A filled shape touched by the cut is deleted whole. One stroke is
// one undo step. The ordinary eraser does the same removal, but live, while
// the pointer is still down.

import { screenToWorld } from "../core/view.js";
import { samplesFrom } from "../brush/input.js";
import { brushRadiusWorld, commitErase } from "./erase.js";

const state = {
  active: false,
  points: null,
};

function remember(sample) {
  const w = screenToWorld(sample.x, sample.y);
  const last = state.points[state.points.length - 1];
  if (last && Math.hypot(w.x - last.x, w.y - last.y) < 0.4) return;
  state.points.push(w);
}

export const sliceTool = {
  cursor() { return "crosshair"; },

  onDeactivate() { state.active = false; state.points = null; },

  onPointerDown(app, event) {
    if (event.button !== 0 || app.interaction.spaceDown) return;
    state.active = true;
    state.points = [];
    for (const s of samplesFrom(event)) remember(s);
  },

  onPointerMove(app, event) {
    if (!state.active) return;
    for (const s of samplesFrom(event)) remember(s);
  },

  onPointerUp(app, event) {
    if (event.button !== 0 || !state.active) return;
    for (const s of samplesFrom(event)) remember(s);
    const trail = state.points;
    state.active = false;
    state.points = null;
    if (!trail || trail.length === 0) return;
    const radius = brushRadiusWorld(app.view.zoom);
    commitErase(app, trail, () => radius);
  },

  /** The cut being drawn, shown until the button comes up and it is applied. */
  getSlice(app) {
    if (!state.active || !state.points || state.points.length === 0) return null;
    return { points: state.points, r: brushRadiusWorld(app.view.zoom) };
  },

  getPreview() { return null; },
};
