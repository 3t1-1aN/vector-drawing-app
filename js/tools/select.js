// tools/select.js
// Select tool (Concepts "Select"): click/marquee selection, move, and
// scale/rotate via bounding-box handles. Each finished gesture pushes a
// single undoable TransformCommand (or selection-only change, which is
// not undoable).

import { screenToWorld, worldToScreen } from "../core/view.js";
import {
  getBounds, cloneElement, translateElement, transformElement,
} from "../scene/element.js";
import { TransformCommand } from "../scene/scene.js";
import { pickHandle } from "../render/select.js";

const PICK_TOLERANCE_PX = 6;

const state = {
  mode: "idle", // idle | move | marquee | scale | rotate
  startScreen: null,
  startWorld: null,
  lastWorld: null,
  handleId: null,
  anchorWorld: null,
  centerWorld: null,
  startAngle: 0,
  initialBounds: null,
  snapshots: null, // [{ id, el }] pre-transform clones for recompute
  marquee: null,   // { x0, y0, x1, y1 } screen
  shiftHeld: false,
};

function reset() {
  state.mode = "idle";
  state.startScreen = null;
  state.startWorld = null;
  state.lastWorld = null;
  state.handleId = null;
  state.anchorWorld = null;
  state.centerWorld = null;
  state.initialBounds = null;
  state.snapshots = null;
  state.marquee = null;
}

function selectionBounds(scene) {
  const sel = scene.getSelected();
  if (sel.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of sel) {
    const b = getBounds(el);
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  return { minX, minY, maxX, maxY };
}

/** Opposite anchor world point + which axes a handle scales. */
function anchorForHandle(bounds, id) {
  const midX = (bounds.minX + bounds.maxX) / 2;
  const midY = (bounds.minY + bounds.maxY) / 2;
  const map = {
    nw: { x: bounds.maxX, y: bounds.maxY, fx: true, fy: true },
    n:  { x: midX, y: bounds.maxY, fx: false, fy: true },
    ne: { x: bounds.minX, y: bounds.maxY, fx: true, fy: true },
    e:  { x: bounds.minX, y: midY, fx: true, fy: false },
    se: { x: bounds.minX, y: bounds.minY, fx: true, fy: true },
    s:  { x: midX, y: bounds.minY, fx: false, fy: true },
    sw: { x: bounds.maxX, y: bounds.minY, fx: true, fy: true },
    w:  { x: bounds.maxX, y: midY, fx: true, fy: false },
  };
  return map[id];
}

function restoreSnapshots(scene) {
  for (const rec of state.snapshots) {
    const el = scene.getById(rec.id);
    if (el) Object.assign(el, cloneElement(rec.el));
  }
}

export const selectTool = {
  cursor() { return "default"; },

  onDeactivate() { reset(); },

  onPointerDown(app, event) {
    if (event.button !== 0 || app.interaction.spaceDown) return;
    event.preventDefault();
    const scene = app.scene;
    const sx = event.clientX, sy = event.clientY;
    const world = screenToWorld(sx, sy);
    state.shiftHeld = event.shiftKey;
    state.startScreen = { x: sx, y: sy };
    state.startWorld = world;

    // 1. Handle drag on the current selection bbox?
    const bounds = selectionBounds(scene);
    if (bounds && scene.hasSelection()) {
      const h = pickHandle(app.view, bounds, sx, sy);
      if (h) {
        state.mode = h === "rot" ? "rotate" : "scale";
        state.handleId = h;
        state.initialBounds = bounds;
        state.centerWorld = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
        if (h !== "rot") state.anchorWorld = anchorForHandle(bounds, h);
        state.snapshots = scene.getSelected().map((el) => ({ id: el.id, el: cloneElement(el) }));
        state.startAngle = Math.atan2(sy - worldToScreen(state.centerWorld.x, state.centerWorld.y).y,
                                      sx - worldToScreen(state.centerWorld.x, state.centerWorld.y).x);
        return;
      }
    }

    // 2. Pick an element.
    const tol = PICK_TOLERANCE_PX / app.view.zoom;
    const hit = scene.pick(world.x, world.y, tol);
    if (hit) {
      if (state.shiftHeld) {
        scene.toggle(hit.id);
      } else if (!scene.isSelected(hit.id)) {
        scene.select(hit.id);
      }
      // Begin a move of the (possibly updated) selection.
      state.mode = "move";
      state.lastWorld = world;
      state.snapshots = scene.getSelected().map((el) => ({ id: el.id, el: cloneElement(el) }));
      return;
    }

    // 3. Empty space → marquee (or plain deselect).
    if (!state.shiftHeld) scene.clearSelection();
    state.mode = "marquee";
    state.marquee = { x0: sx, y0: sy, x1: sx, y1: sy };
  },

  onPointerMove(app, event) {
    const scene = app.scene;
    const world = screenToWorld(event.clientX, event.clientY);

    if (state.mode === "move") {
      const dx = world.x - state.lastWorld.x;
      const dy = world.y - state.lastWorld.y;
      for (const rec of state.snapshots) {
        const el = scene.getById(rec.id);
        if (el) translateElement(el, dx, dy);
      }
      state.lastWorld = world;
      return;
    }

    if (state.mode === "marquee") {
      state.marquee.x1 = event.clientX;
      state.marquee.y1 = event.clientY;
      return;
    }

    if (state.mode === "scale") {
      restoreSnapshots(scene);
      const b = state.initialBounds;
      const oldW = Math.max(1e-6, b.maxX - b.minX);
      const oldH = Math.max(1e-6, b.maxY - b.minY);
      const a = state.anchorWorld;
      let fx = 1, fy = 1;
      if (a.fx) {
        const sign = (state.handleId === "e" || state.handleId === "ne" || state.handleId === "se") ? 1 : -1;
        const newW = sign * (world.x - a.x);
        fx = newW / oldW;
      }
      if (a.fy) {
        const sign = (state.handleId === "s" || state.handleId === "se" || state.handleId === "sw") ? 1 : -1;
        const newH = sign * (world.y - a.y);
        fy = newH / oldH;
      }
      // Avoid zero/negative collapse.
      fx = Math.max(1e-3, fx);
      fy = Math.max(1e-3, fy);
      if (event.shiftKey) {
        // Uniform: use the dominant axis factor.
        if (Math.abs(fx) > Math.abs(fy)) fy = fx; else fx = fy;
      }
      for (const rec of state.snapshots) {
        const el = scene.getById(rec.id);
        if (el) transformElement(el, a.x, a.y, fx, fy, 0);
      }
      return;
    }

    if (state.mode === "rotate") {
      restoreSnapshots(scene);
      const c = state.centerWorld;
      const cs = worldToScreen(c.x, c.y);
      const ang = Math.atan2(event.clientY - cs.y, event.clientX - cs.x) - state.startAngle;
      const snapped = event.shiftKey ? snapAngle(ang) : ang;
      for (const rec of state.snapshots) {
        const el = scene.getById(rec.id);
        if (el) transformElement(el, c.x, c.y, 1, 1, snapped);
      }
      return;
    }
  },

  onPointerUp(app, event) {
    if (event.button !== 0) return;
    const scene = app.scene;

    if (state.mode === "move" || state.mode === "scale" || state.mode === "rotate") {
      // Build a TransformCommand from snapshots(before) -> current(after).
      const cmd = new TransformCommand();
      let changed = false;
      for (const rec of state.snapshots) {
        const el = scene.getById(rec.id);
        if (!el) continue;
        const before = rec.el;
        const after = cloneElement(el);
        if (!elementEqual(before, after)) changed = true;
        cmd.records.push({ id: rec.id, before, after });
      }
      if (changed) app.history.push(cmd);
      reset();
      return;
    }

    if (state.mode === "marquee") {
      const m = state.marquee;
      const left = Math.min(m.x0, m.x1), right = Math.max(m.x0, m.x1);
      const top = Math.min(m.y0, m.y1), bottom = Math.max(m.y0, m.y1);
      // Only count as a marquee if there was real drag; a bare click already
      // deselected on pointer down.
      if (Math.abs(right - left) > 3 || Math.abs(bottom - top) > 3) {
        const wbl = screenToWorld(left, top);
        const wbr = screenToWorld(right, bottom);
        const bounds = { left: wbl.x, top: wbl.y, right: wbr.x, bottom: wbr.y };
        const hits = scene.pickInBounds(bounds);
        if (!state.shiftHeld) scene.clearSelection();
        for (const el of hits) scene.addToSelection(el.id);
      }
      reset();
      return;
    }

    reset();
  },

  onKeydown(app, event) {
    if (event.code === "Escape") {
      app.scene.clearSelection();
      reset();
    }
  },

  getMarquee() {
    return state.mode === "marquee" ? state.marquee : null;
  },

  /** The select tool requests the handles overlay when something is selected. */
  getOverlay(app) {
    const b = selectionBounds(app.scene);
    return b && app.scene.hasSelection() ? { kind: "handles", bounds: b } : null;
  },
};

function snapAngle(ang) {
  const step = Math.PI / 12; // 15°
  return Math.round(ang / step) * step;
}

/** Shallow geometry equality to detect no-op transforms. */
function elementEqual(a, b) {
  if (a.type !== b.type) return false;
  const ka = Object.keys(a).filter((k) => k !== "style");
  const kb = Object.keys(b).filter((k) => k !== "style");
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    const va = a[k], vb = b[k];
    if (Array.isArray(va)) {
      if (!Array.isArray(vb) || va.length !== vb.length) return false;
      for (let i = 0; i < va.length; i++) {
        if (typeof va[i] === "number") { if (va[i] !== vb[i]) return false; }
        else if (va[i].x !== vb[i].x || va[i].y !== vb[i].y) return false;
      }
    } else if (typeof va === "number") {
      if (va !== vb) return false;
    }
  }
  return true;
}
