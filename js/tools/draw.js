// tools/draw.js
// The three snap-to-grid shape tools (line, rect, circle) plus the
// freeform pen with hold-to-recognize. They share a common drag pattern:
// pointer down starts an element, move updates it, up commits it through
// history. Pen additionally arms a 700ms hold timer that runs the
// recognizer mid-stroke.

import { screenToWorld } from "../core/view.js";
import { createIdElement, isDegenerate } from "../scene/element.js";
import { AddElementCommand } from "../scene/scene.js";
import { recognizeShape } from "../precision/recognize.js";
import { activeBrush } from "../brush/active-brush.js";
import { getBrushPreset } from "../brush/presets.js";
import { PressureTracker } from "../brush/physics.js";
import { samplesFrom } from "../brush/input.js";
import { onStrokeCommitted } from "../math/pipeline.js";

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
    tracker: null, // PressureTracker while a freehand stroke is in flight
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

/**
 * Store a point in world space, keeping the pressure and speed the tracker
 * measured in screen space. Those two numbers are what let the brush engine
 * reproduce the stroke's dynamics later without persisting timestamps.
 */
function storePoint(el, s) {
  const w = screenToWorld(s.x, s.y);
  el.points.push({ x: w.x, y: w.y, p: s.p, v: s.v });
}

function startPen(app, event) {
  shared.tracker = new PressureTracker(
    getBrushPreset(activeBrush.medium),
    activeBrush.smoothing,
  );
  shared.element = createIdElement("path", { points: [] });
  const samples = samplesFrom(event);
  storePoint(shared.element, shared.tracker.begin(samples[samples.length - 1]));
  armHoldTimer(app, event.clientX, event.clientY);
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
    // No post-smoothing pass here any more: the engine interpolates the
    // stored points through a spline at render time, so an extra corner-cut
    // would only round away detail the tracker already filtered.
    app.scene.add(el);
    app.history.push(new AddElementCommand(el));
    app.scene.clearSelection();
    if (el.type === "path") onStrokeCommitted(app, el);
  }
  shared.element = null;
  shared.tracker = null;
  shared.recognized = false;
}

function makeShapeTool(kind) {
  const start = kind === "line" ? startLine : kind === "rect" ? startRect : startCircle;
  return {
    onDeactivate() { clearHold(); shared.element = null; shared.recognized = false; },
    onPointerDown(app, event) {
      if (event.button !== 0 || app.interaction.spaceDown) return;
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
    shared.recognized = false;
    startPen(app, event);
  },
  onPointerMove(app, event) {
    const el = shared.element;
    if (!el) return;
    if (el.type === "path") {
      // Every sample behind this event, not just the one that got delivered.
      // At speed the browser merges moves, and those merged samples are
      // exactly the ones that describe a fast corner.
      for (const s of samplesFrom(event)) {
        const pt = shared.tracker.push(s);
        if (pt) storePoint(el, pt);
      }
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
