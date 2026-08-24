// tools/draw.js
// The three snap-to-grid shape tools (line, rect, circle) plus the
// freeform pen with hold-to-recognize. They share a common drag pattern:
// pointer down starts an element, move updates it, up commits it through
// history. Pen additionally arms a 700ms hold timer that runs the
// recognizer mid-stroke.

import { screenToWorld, worldToScreen } from "../core/view.js";
import { createIdElement, isDegenerate } from "../scene/element.js";
import { AddElementCommand } from "../scene/scene.js";
import { recognizeShape } from "../precision/recognize.js";
import { activeBrush } from "../brush/active-brush.js";

const PEN_SAMPLE_DIST_PX = 2;
const HOLD_MOVE_THRESHOLD_PX = 5;
const HOLD_TRIGGER_MS = 700;

// Each tool keeps transient state on a per-tool object so switching tools
// doesn't leak state. We store the in-progress element + pen hold timer.
function makeState() {
  return {
    element: null,
    recognized: false,
    holdTimerId: null,
    holdAnchorX: 0,
    holdAnchorY: 0,
    smooth: null, // EMA cursor while a pen stroke is in flight
  };
}

const shared = makeState();

function clearHold() {
  if (shared.holdTimerId !== null) {
    clearTimeout(shared.holdTimerId);
    shared.holdTimerId = null;
  }
}

function startLine(app, event) {
  const raw = screenToWorld(event.clientX, event.clientY);
  const s = app.snap(raw.x, raw.y);
  shared.element = createIdElement("line", {
    startX: s.x, startY: s.y, endX: s.x, endY: s.y,
  });
}

function startRect(app, event) {
  const raw = screenToWorld(event.clientX, event.clientY);
  const s = app.snap(raw.x, raw.y);
  shared.element = createIdElement("rect", {
    startX: s.x, startY: s.y, endX: s.x, endY: s.y,
  });
}

function startCircle(app, event) {
  const raw = screenToWorld(event.clientX, event.clientY);
  const c = app.snap(raw.x, raw.y);
  shared.element = createIdElement("circle", { cx: c.x, cy: c.y, r: 0 });
}

function startPen(app, event) {
  const raw = screenToWorld(event.clientX, event.clientY);
  shared.element = createIdElement("path", { points: [{ x: raw.x, y: raw.y }] });
  shared.smooth = { x: raw.x, y: raw.y }; // EMA cursor for smoothing
  armHoldTimer(app, event.clientX, event.clientY);
}

// Exponential moving average toward the raw pointer. smoothing 0 = raw input,
// approaching 1 = heavy lag that irons out hand jitter.
function smoothPoint(raw, amount) {
  if (amount <= 0) return raw;
  const k = 1 - Math.min(0.92, amount * 0.92); // keep a floor so it stays responsive
  shared.smooth.x += (raw.x - shared.smooth.x) * k;
  shared.smooth.y += (raw.y - shared.smooth.y) * k;
  return { x: shared.smooth.x, y: shared.smooth.y };
}

// Chaikin corner-cutting, run once on commit for a clean final curve at
// higher smoothing values. Iterations scale with the smoothing amount.
function chaikin(points, iterations) {
  let pts = points;
  for (let it = 0; it < iterations; it++) {
    if (pts.length < 3) break;
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

function armHoldTimer(app, sx, sy) {
  clearHold();
  shared.holdAnchorX = sx;
  shared.holdAnchorY = sy;
  shared.holdTimerId = setTimeout(() => onHoldTriggered(app), HOLD_TRIGGER_MS);
}

function onHoldTriggered(app) {
  shared.holdTimerId = null;
  const el = shared.element;
  if (!el || el.type !== "path" || shared.recognized) return;
  const primitive = recognizeShape(el.points, app.view.zoom);
  if (primitive) {
    // Replace the live element with the recognized primitive (keep id+style).
    const id = el.id;
    const style = el.style;
    shared.element = createIdElement(primitive.type, { ...primitive, style });
    shared.element.id = id; // keep the same id for the in-progress element
    shared.recognized = true;
  }
}

function commit(app) {
  clearHold();
  const el = shared.element;
  if (el && !isDegenerate(el)) {
    // Final pass of Chaikin corner-cutting for smoothed freehand strokes,
    // so the committed path is clean rather than the raw EMA trace.
    if (el.type === "path" && !shared.recognized && activeBrush.smoothing > 0.05) {
      const iterations = 1 + Math.round(activeBrush.smoothing * 2);
      el.points = chaikin(el.points, iterations);
    }
    app.scene.add(el);
    app.history.push(new AddElementCommand(el));
    app.scene.clearSelection();
  }
  shared.element = null;
  shared.smooth = null;
  shared.recognized = false;
}

function makeShapeTool(kind) {
  const start = kind === "line" ? startLine : kind === "rect" ? startRect : startCircle;
  return {
    onDeactivate() { clearHold(); shared.element = null; shared.recognized = false; },
    onPointerDown(app, event) {
      if (event.button !== 0 || app.interaction.spaceDown) return;
      event.preventDefault();
      shared.recognized = false;
      start(app, event);
    },
    onPointerMove(app, event) {
      const el = shared.element;
      if (!el) return;
      const raw = screenToWorld(event.clientX, event.clientY);
      if (el.type === "line" || el.type === "rect") {
        const s = app.snap(raw.x, raw.y);
        el.endX = s.x; el.endY = s.y;
      } else if (el.type === "circle") {
        const s = app.snap(raw.x, raw.y);
        el.r = Math.hypot(s.x - el.cx, s.y - el.cy);
      }
      // If a pen stroke was recognized into a line/circle, this same tool
      // branch lets the user fine-tune the endpoint/radius before release.
    },
    onPointerUp(app, event) {
      if (event.button !== 0) return;
      commit(app);
    },
    getPreview() {
      if (!shared.element) return null;
      return { element: shared.element, recognized: shared.recognized };
    },
  };
}

export const lineTool = makeShapeTool("line");
export const rectTool = makeShapeTool("rect");
export const circleTool = makeShapeTool("circle");

export const penTool = {
  onDeactivate() { clearHold(); shared.element = null; shared.recognized = false; },
  onPointerDown(app, event) {
    if (event.button !== 0 || app.interaction.spaceDown) return;
    event.preventDefault();
    shared.recognized = false;
    startPen(app, event);
  },
  onPointerMove(app, event) {
    const el = shared.element;
    if (!el) return;
    if (el.type === "path") {
      const raw = screenToWorld(event.clientX, event.clientY);
      const pt = smoothPoint(raw, activeBrush.smoothing);
      const last = el.points[el.points.length - 1];
      const lastScreen = worldToScreen(last.x, last.y);
      const moved = Math.hypot(event.clientX - lastScreen.x, event.clientY - lastScreen.y);
      if (moved >= PEN_SAMPLE_DIST_PX) el.points.push(pt);
      const movedFromAnchor = Math.hypot(
        event.clientX - shared.holdAnchorX,
        event.clientY - shared.holdAnchorY
      );
      if (movedFromAnchor >= HOLD_MOVE_THRESHOLD_PX) {
        armHoldTimer(app, event.clientX, event.clientY);
      }
    } else {
      // Recognized into a line/circle — let the user fine-tune it.
      const raw = screenToWorld(event.clientX, event.clientY);
      if (el.type === "line") {
        const s = app.snap(raw.x, raw.y);
        el.endX = s.x; el.endY = s.y;
      } else if (el.type === "circle") {
        const s = app.snap(raw.x, raw.y);
        el.r = Math.hypot(s.x - el.cx, s.y - el.cy);
      }
    }
  },
  onPointerUp(app, event) {
    if (event.button !== 0) return;
    commit(app);
  },
  getPreview() {
    if (!shared.element) return null;
    return { element: shared.element, recognized: shared.recognized };
  },
};
