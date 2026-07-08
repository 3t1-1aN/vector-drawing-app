// tools/nudge.js
// Nudge tool: drag a portion of a polyline/path to bend it locally. For
// primitives (line, rect, circle, etc.), the tool "bakes" the element to
// a path on first nudge so the segment can be deformed. Each nudge drag
// is one undoable TransformCommand.
//
// Behavior: on pointer down, find the nearest segment of the (hit-tested)
// element to the cursor within a tolerance. Bake to path if needed. Then
// on drag, move every point weighted by its distance to the grab point
// (closer points move more) — a smooth local deformation.

import { screenToWorld } from "../core/view.js";
import { bakeToPath, cloneElement, createIdElement } from "../scene/element.js";
import { TransformCommand } from "../scene/scene.js";

const PICK_TOLERANCE_PX = 10;
const FALLOFF_WORLD = 60; // influence radius in world units

const state = {
  el: null,
  grabIndex: 0,
  snapshot: null,
  active: false,
};

function nearestSegmentIndex(points, world) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const d = distToSegment(world, points[i], points[i + 1]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return { index: best, dist: bestD };
}

function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export const nudgeTool = {
  cursor() { return "crosshair"; },

  onDeactivate() { state.el = null; state.snapshot = null; state.active = false; },

  onPointerDown(app, event) {
    if (event.button !== 0 || app.interaction.spaceDown) return;
    event.preventDefault();
    const scene = app.scene;
    const world = screenToWorld(event.clientX, event.clientY);
    const tol = PICK_TOLERANCE_PX / app.view.zoom;
    const hit = scene.pick(world.x, world.y, tol);
    if (!hit) return;

    // Bake primitives to a path so we can deform segment points.
    if (hit.type !== "path") {
      bakeToPath(hit);
    }
    const pts = hit.points;
    const { index } = nearestSegmentIndex(pts, world);
    // Insert a grab point at the cursor on the chosen segment so the
    // deformation has a clean handle.
    const a = pts[index], b = pts[index + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((world.x - a.x) * dx + (world.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const grab = { x: a.x + t * dx, y: a.y + t * dy };
    pts.splice(index + 1, 0, grab);

    state.el = hit;
    state.grabIndex = index + 1;
    state.snapshot = cloneElement(hit);
    state.active = true;
    scene.select(hit.id);
  },

  onPointerMove(app, event) {
    if (!state.active || !state.el) return;
    const world = screenToWorld(event.clientX, event.clientY);
    const pts = state.el.points;
    const grab = pts[state.grabIndex];
    const dx = world.x - grab.x;
    const dy = world.y - grab.y;
    // Move the grab point fully; falloff other points by distance.
    for (let i = 0; i < pts.length; i++) {
      if (i === state.grabIndex) {
        pts[i] = { x: world.x, y: world.y };
        continue;
      }
      const d = Math.hypot(pts[i].x - grab.x, pts[i].y - grab.y);
      const w = Math.max(0, 1 - d / FALLOFF_WORLD);
      pts[i] = { x: pts[i].x + dx * w, y: pts[i].y + dy * w };
    }
  },

  onPointerUp(app, event) {
    if (event.button !== 0 || !state.active) return;
    const cmd = new TransformCommand();
    cmd.records.push({ id: state.el.id, before: state.snapshot, after: cloneElement(state.el) });
    app.history.push(cmd);
    state.el = null;
    state.snapshot = null;
    state.active = false;
  },

  getPreview() { return null; },
};
