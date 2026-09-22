// tools/slice.js
// Slice (vector eraser): drag a straight "blade" across the canvas; where
// it crosses an element's outline, the crossed portion is removed and the
// remaining pieces become new path elements. Primitives are baked to a
// path first so the split is always a polyline operation. Each slice is
// one undoable command (removes the original, adds the pieces).

import { screenToWorld } from "../core/view.js";
import { bakeToPath, cloneElement, createIdElement } from "../scene/element.js";

const state = {
  active: false,
  startWorld: null,
  endWorld: null,
};

/** Segment-segment intersection; returns path parameter (i+u) or null. */
function segIntersect(p1, p2, q1, q2, pathIndex) {
  const rx = p2.x - p1.x, ry = p2.y - p1.y;
  const sx = q2.x - q1.x, sy = q2.y - q1.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((q1.x - p1.x) * sy - (q1.y - p1.y) * sx) / denom;
  const u = ((q1.x - p1.x) * ry - (q1.y - p1.y) * rx) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { param: pathIndex + u, point: { x: p1.x + t * rx, y: p1.y + t * ry } };
}

/** All intersections of slice segment with a path, sorted by path param. */
function intersections(sliceA, sliceB, points) {
  const cuts = [];
  for (let i = 0; i < points.length - 1; i++) {
    const c = segIntersect(sliceA, sliceB, points[i], points[i + 1], i);
    if (c) cuts.push(c);
  }
  cuts.sort((a, b) => a.param - b.param);
  // De-duplicate params that are essentially equal.
  const out = [];
  for (const c of cuts) {
    if (out.length === 0 || Math.abs(c.param - out[out.length - 1].param) > 1e-6) out.push(c);
  }
  return out;
}

/**
 * Split a polyline at sorted cut points. Pairs of cuts (entering+exiting
 * the blade) mark the erased arc; the head, tail, and gaps between pairs
 * are kept. A lone cut (odd count) simply cuts the stroke there.
 *
 *   cuts: [{ param, point }] sorted by param ascending.
 *   returns: array of point arrays (the kept pieces).
 */
function splitPathAtCuts(points, cuts) {
  const lastIdx = points.length - 1;
  const kept = [];

  // Head: [start .. first cut].
  kept.push(subPath(points, 0, cuts[0].param, null, cuts[0]));

  // Gaps between removed pairs: pair k = (cuts[2k], cuts[2k+1]) is removed;
  // the gap [cuts[2k+1] .. cuts[2k+2]] is kept.
  for (let k = 0; 2 * k + 1 < cuts.length; k++) {
    if (2 * k + 2 < cuts.length) {
      kept.push(subPath(points, cuts[2 * k + 1].param, cuts[2 * k + 2].param, cuts[2 * k + 1], cuts[2 * k + 2]));
    }
  }

  // Tail: [last cut .. end] (kept whether the last cut ends a pair or is lone).
  const last = cuts[cuts.length - 1];
  kept.push(subPath(points, last.param, lastIdx, last, null));

  return kept;
}

/** Build a sub-path between two path parameters, inserting cut points at the ends. */
function subPath(points, t0, t1, startCut, endCut) {
  const i0 = Math.floor(t0);
  const i1 = Math.floor(t1);
  const out = [];
  out.push(startCut ? { ...startCut.point } : { ...points[i0] });
  for (let i = i0 + 1; i <= i1; i++) out.push({ ...points[i] });
  if (endCut) out.push({ ...endCut.point });
  return out;
}

export const sliceTool = {
  cursor() { return "crosshair"; },

  onDeactivate() { state.active = false; state.startWorld = null; state.endWorld = null; },

  onPointerDown(app, event) {
    if (event.button !== 0 || app.interaction.spaceDown) return;
    state.active = true;
    state.startWorld = screenToWorld(event.clientX, event.clientY);
    state.endWorld = state.startWorld;
  },

  onPointerMove(app, event) {
    if (!state.active) return;
    state.endWorld = screenToWorld(event.clientX, event.clientY);
  },

  onPointerUp(app, event) {
    if (event.button !== 0 || !state.active) return;
    const scene = app.scene;
    const a = state.startWorld, b = state.endWorld;
    state.active = false;
    state.startWorld = null;
    state.endWorld = null;

    if (!a || !b) return;
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1) return;

    // Find every element the blade crosses with >= 1 intersection.
    const ops = []; // { removedId, pieces: [elements] }
    for (const el of scene.elements.slice()) {
      if (el.type !== "path") bakeToPath(el);
      const cuts = intersections(a, b, el.points);
      if (cuts.length < 1) continue;
      const pieces = splitPathAtCuts(el.points, cuts);
      if (pieces.length === 0) {
        // Whole stroke was erased; leave a minimal segment so the element
        // isn't silently dropped to nothing (undo will restore it).
        pieces.push([{ ...cuts[0] }, { ...(cuts[0].point ? cuts[0].point : el.points[el.points.length - 1]) }]);
      }
      const pieceEls = pieces
        .filter((pts) => pts.length >= 2)
        .map((pts) => createIdElement("path", { points: pts }));
      if (pieceEls.length === 0) continue;
      ops.push({ removedId: el.id, removedSnapshot: cloneElement(el), pieces: pieceEls });
    }

    if (ops.length === 0) return;

    // Apply: remove originals, add pieces, push one undoable command.
    for (const op of ops) {
      scene.remove(op.removedId);
      for (const p of op.pieces) scene.add(p);
    }
    app.history.push(new SliceCommand(ops));
  },

  /** The slice blade preview, drawn in screen space by the app. */
  getSlice() {
    if (!state.active || !state.startWorld || !state.endWorld) return null;
    return { a: state.startWorld, b: state.endWorld };
  },

  getPreview() { return null; },
};

/** Command: replace each sliced element with its surviving pieces. */
class SliceCommand {
  constructor(ops) {
    // Capture pieces as snapshots (already created with ids).
    this.ops = ops.map((op) => ({
      removedId: op.removedId,
      removedSnapshot: cloneElement(op.removedSnapshot),
      pieces: op.pieces.map(cloneElement),
    }));
  }
  apply(scene) {
    for (const op of this.ops) {
      scene.remove(op.removedId);
      for (const p of op.pieces) scene.add(cloneElement(p));
    }
  }
  undo(scene) {
    for (let i = this.ops.length - 1; i >= 0; i--) {
      const op = this.ops[i];
      for (const p of op.pieces) scene.remove(p.id);
      scene.add(cloneElement(op.removedSnapshot));
    }
  }
}
