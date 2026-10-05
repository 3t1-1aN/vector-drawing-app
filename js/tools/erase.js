// tools/erase.js
// Eraser: a disc the size of the current brush. Ink under it disappears as
// the pointer moves, and whatever is left of a stroke survives as its own
// pieces, in the style it had. A filled shape has no honest partial state,
// so touching one deletes the whole shape. One drag is still one undo step.
// Slice draws a cut with the same removal, committed when the stroke ends.

import { screenToWorld } from "../core/view.js";
import { bakeToPath, cloneElement, createIdElement, getBounds, hitTest } from "../scene/element.js";
import { isFilledMedium } from "../brush/presets.js";
import { activeBrush } from "../brush/active-brush.js";
import { samplesFrom } from "../brush/input.js";
import { onSceneMutated } from "../math/pipeline.js";

const state = {
  active: false,
  cursor: null,      // last pointer position, world space, for the cursor disc
  lastApplied: null, // end of the trail already cut into the scene
  ops: null,         // replacements accumulated for this drag's one undo step
};

/** Half the current brush size, in world units. The disc the eraser and slice draw. */
export function brushRadiusWorld(zoom) {
  return Math.max(0.5, (activeBrush.strokeWidth || 2) / 2) / Math.max(zoom, 1e-6);
}

function distToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** True when p lies within `radius` of the eraser trail. */
function nearTrail(p, trail, radius) {
  if (trail.length === 1) return Math.hypot(p.x - trail[0].x, p.y - trail[0].y) <= radius;
  for (let i = 1; i < trail.length; i++) {
    if (distToSegment(p, trail[i - 1], trail[i]) <= radius) return true;
  }
  return false;
}

/**
 * Walk a polyline in steps no coarser than `step`. Long segments (a snapped
 * line, a rectangle side) would otherwise be wholly kept or wholly lost
 * based on their endpoints alone.
 */
function densify(points, step) {
  if (points.length === 0) return [];
  const out = [{ ...points[0] }];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(len / step));
    for (let s = 1; s <= n; s++) {
      const t = s / n;
      out.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        p: a.p,
        v: a.v,
      });
    }
  }
  return out;
}

function outlineOf(el) {
  if (el.type === "path") return el.points.map((p) => ({ ...p }));
  const copy = cloneElement(el);
  bakeToPath(copy);
  return copy.points;
}

function pathIsClosed(el, points) {
  if (el.type === "circle" || el.type === "rect" || el.type === "square" || el.type === "triangle") {
    return true;
  }
  if (points.length < 3) return false;
  const a = points[0];
  const b = points[points.length - 1];
  return Math.hypot(a.x - b.x, a.y - b.y) < 1e-4;
}

/**
 * Runs of the outline the eraser did not reach, or null when it reached
 * none of them. A closed outline whose seam survived is one run split across
 * the ends of the array; those join back up.
 */
function keptPieces(points, trail, radius, closed) {
  const step = Math.max(0.75, radius * 0.35);
  const dense = densify(points, step);
  const hit = dense.map((p) => nearTrail(p, trail, radius));
  if (!hit.some(Boolean)) return null;
  const runs = [];
  let cur = null;
  for (let i = 0; i < dense.length; i++) {
    if (!hit[i]) {
      if (!cur) cur = [];
      cur.push(dense[i]);
    } else if (cur) {
      runs.push(cur);
      cur = null;
    }
  }
  if (cur) runs.push(cur);
  if (closed && runs.length >= 2 && !hit[0] && !hit[dense.length - 1]) {
    const tail = runs.pop();
    runs[0] = tail.concat(runs[0]);
  }
  return runs.filter((r) => r.length >= 2);
}

/** A fill is all or nothing: the disc touching it anywhere removes it. */
function fillTouched(el, trail, radius) {
  const samples = densify(trail, Math.max(1, radius * 0.5));
  for (const p of samples) {
    if (hitTest(el, p.x, p.y, radius)) return true;
  }
  return false;
}

/** Cheap reject before measuring every point of a long stroke. */
function withinReach(el, trail, radius) {
  const b = getBounds(el);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of trail) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return !(
    b.maxX < minX - radius || b.minX > maxX + radius ||
    b.maxY < minY - radius || b.minY > maxY + radius
  );
}

/**
 * Remove whatever `trail` covers. `radiusFor(el)` is the reach, in world
 * units, around the trail. Returns the replacements it made; the caller
 * decides when they become an undo step, so a drag can cut on every move
 * and still undo as one gesture.
 */
function applyErase(scene, trail, radiusFor) {
  if (!trail || trail.length === 0) return [];
  const ops = [];
  for (const el of scene.elements.slice()) {
    const radius = radiusFor(el);
    if (!(radius > 0) || !withinReach(el, trail, radius)) continue;
    if (isFilledMedium(el.style?.medium)) {
      if (!fillTouched(el, trail, radius)) continue;
      ops.push({ removedId: el.id, removedSnapshot: cloneElement(el), pieces: [] });
      continue;
    }
    const outline = outlineOf(el);
    if (outline.length < 2) continue;
    const pieces = keptPieces(outline, trail, radius, pathIsClosed(el, outline));
    if (!pieces) continue;
    const pieceEls = pieces.map((pts) =>
      createIdElement("path", { points: pts, style: { ...el.style } }),
    );
    ops.push({ removedId: el.id, removedSnapshot: cloneElement(el), pieces: pieceEls });
  }
  for (const op of ops) {
    scene.remove(op.removedId);
    for (const p of op.pieces) scene.add(p);
  }
  return ops;
}

/** Remove whatever `trail` covers and push one undo step. */
export function commitErase(app, trail, radiusFor) {
  const ops = applyErase(app.scene, trail, radiusFor);
  if (ops.length === 0) return false;
  app.history.push(new EraseCommand(ops));
  onSceneMutated(app);
  return true;
}

/** Cut the new bit of trail into the scene and remember it for one undo. */
function eraseStep(app, trail) {
  if (!trail || trail.length === 0) return;
  const ops = applyErase(app.scene, trail, () => brushRadiusWorld(app.view.zoom));
  if (ops.length === 0) return;
  if (!state.ops) state.ops = [];
  state.ops.push(...ops);
}

function finishGesture(app) {
  if (state.ops && state.ops.length && app) {
    app.history.push(new EraseCommand(state.ops));
    onSceneMutated(app);
  }
  state.ops = null;
  state.active = false;
  state.lastApplied = null;
}

/**
 * Take one sample. Returns a world point when it extends the trail far
 * enough to be worth cutting, otherwise null (the cursor still moves).
 */
function takeSample(sample) {
  const w = screenToWorld(sample.x, sample.y);
  state.cursor = w;
  if (!state.active) return null;
  const last = state.lastApplied;
  if (last && Math.hypot(w.x - last.x, w.y - last.y) < 0.4) return null;
  return w;
}

export const eraserTool = {
  cursor() { return "crosshair"; },

  onDeactivate(app) {
    finishGesture(app);
    state.cursor = null;
  },

  onPointerDown(app, event) {
    if (event.button !== 0 || app.interaction.spaceDown) return;
    state.active = true;
    state.ops = [];
    state.lastApplied = null;
    const fresh = [];
    for (const s of samplesFrom(event)) {
      const w = takeSample(s);
      if (w) fresh.push(w);
    }
    if (fresh.length === 0) return;
    eraseStep(app, fresh);
    state.lastApplied = fresh[fresh.length - 1];
  },

  onPointerMove(app, event) {
    const fresh = [];
    for (const s of samplesFrom(event)) {
      const w = takeSample(s);
      if (w) fresh.push(w);
    }
    if (!state.active || fresh.length === 0) return;
    const trail = state.lastApplied ? [state.lastApplied, ...fresh] : fresh;
    eraseStep(app, trail);
    state.lastApplied = fresh[fresh.length - 1];
  },

  onPointerUp(app, event) {
    if (event.button !== 0 || !state.active) return;
    const fresh = [];
    for (const s of samplesFrom(event)) {
      const w = takeSample(s);
      if (w) fresh.push(w);
    }
    if (fresh.length) {
      const trail = state.lastApplied ? [state.lastApplied, ...fresh] : fresh;
      eraseStep(app, trail);
      state.lastApplied = fresh[fresh.length - 1];
    }
    finishGesture(app);
  },

  /** The disc under the pointer. The ink it covers is already gone. */
  getEraser(app) {
    if (!state.cursor) return null;
    return { x: state.cursor.x, y: state.cursor.y, r: brushRadiusWorld(app.view.zoom) };
  },
};

/** Command: replace each erased element with whatever of it survived. */
class EraseCommand {
  constructor(ops) {
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
