// tools/text.js
// Click to plant a typewriter note, then type. Enter breaks a line.
// Escape, a click elsewhere, or leaving the tool sets the note on the page.
// An empty note is dropped rather than left as a bare caret.
//
// Double-tap a box, circle, or triangle to type in its center. The label
// stays centered in the shape, wrapping to the inside of the outline.
// The size ring, while this tool is active or a note is selected, sets the
// type size.

import { screenToWorld } from "../core/view.js";
import { activeBrush } from "../brush/active-brush.js";
import {
  createIdElement, cloneElement, hitTest, hitTestBody, holdsCenteredText, isDegenerate,
} from "../scene/element.js";
import { AddElementCommand, RemoveElementsCommand, TransformCommand } from "../scene/scene.js";
import { touchElement } from "../render/ink-rev.js";
import { TYPE_SIZE } from "../render/type-text.js";
import { labelFrame } from "../render/text-frame.js";

export const TEXT_SIZE_RANGE = { min: 11, max: 72, step: 1, presets: [14, 20, 32, 56] };

const state = {
  element: null,       // the note being typed; may already live in the scene
  host: null,          // shape whose centered label is being typed
  beforeLabel: null,   // label snapshot before this edit, or null
  beforeElement: null, // clone of a committed note before this edit
};

let preferredSize = TYPE_SIZE;
let handledDoubleAt = 0;

export function preferredTextSize() {
  return preferredSize;
}

export function isEditingText() {
  return !!state.element;
}

export function editingTextElement() {
  return state.element;
}

/**
 * Type size the wheel should show. While the text tool is up and nothing is
 * being typed, this is the size the next note will use — not a note that
 * merely happens to be selected.
 */
export function displayedTextSize(selected, toolIsText) {
  if (state.element) return state.element.size || preferredSize;
  if (!toolIsText && selected?.type === "text") return selected.size || TYPE_SIZE;
  return preferredSize;
}

export function setTextSize(size) {
  const next = Math.round(Math.max(TEXT_SIZE_RANGE.min, Math.min(TEXT_SIZE_RANGE.max, size)));
  preferredSize = next;
  if (state.element) state.element.size = next;
  return next;
}

function commit(app) {
  const el = state.element;
  const host = state.host;
  const beforeLabel = state.beforeLabel;
  const beforeElement = state.beforeElement;
  state.element = null;
  state.host = null;
  state.beforeLabel = null;
  state.beforeElement = null;
  if (!el || !app) return;

  if (host) {
    const next = isDegenerate(el) ? null : { text: el.text, size: el.size, seed: el.seed };
    const changed = !sameLabel(beforeLabel, next);
    if (next) host.label = next;
    else delete host.label;
    if (changed) {
      touchElement(host);
      app.history.push(new LabelCommand(host.id, beforeLabel, next));
    }
    return;
  }

  if (beforeElement) {
    if (isDegenerate(el)) {
      app.history.push(new RemoveElementsCommand([beforeElement]));
      app.scene.remove(el.id);
      return;
    }
    if (beforeElement.text !== el.text || beforeElement.size !== el.size) {
      const cmd = new TransformCommand();
      cmd.records = [{ id: el.id, before: beforeElement, after: cloneElement(el) }];
      app.history.push(cmd);
      touchElement(el);
    }
    return;
  }

  if (isDegenerate(el)) return;
  app.scene.add(el);
  app.history.push(new AddElementCommand(el));
  app.scene.clearSelection();
}

function sameLabel(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.text === b.text && a.size === b.size;
}

function editCommitted(app, el) {
  commit(app);
  if (!app.scene.getById(el.id)) return;
  state.beforeElement = cloneElement(el);
  state.element = el;
  app.scene.select(el.id);
}

function editShape(app, shape) {
  if (state.host === shape) return;
  commit(app);
  const label = shape.label || null;
  state.host = shape;
  state.beforeLabel = label ? { ...label } : null;
  state.element = {
    type: "text",
    text: label?.text || "",
    size: label?.size || preferredSize,
    seed: label?.seed ?? Math.floor(Math.random() * 1e6),
    style: shape.style,
    x: 0,
    y: 0,
  };
  // Leave the shape drawn as ink. Selecting it would swap the stroke for the
  // selection outline while the label is being typed.
  app.scene.clearSelection();
}

function targetAt(app, clientX, clientY) {
  const world = screenToWorld(clientX, clientY);
  const tol = 8 / app.view.zoom;
  const els = app.scene.elements;
  for (let i = els.length - 1; i >= 0; i--) {
    const el = els[i];
    if (el.type === "text" && hitTest(el, world.x, world.y, tol)) return { kind: "text", el };
    if ((holdsCenteredText(el) || el.label) && hitTestBody(el, world.x, world.y, tol)) {
      return { kind: "shape", el };
    }
    if (hitTest(el, world.x, world.y, tol)) return null;
  }
  return null;
}

/**
 * The second tap of a quick pair on a note or a closed shape.
 * Returns true when the tap was used, so the active tool must not also start a stroke.
 */
export function handleDoubleTap(app, event) {
  if (event.button !== 0 || app.interaction.spaceDown) return false;
  const now = performance.now();
  const prev = handleDoubleTap.last;
  handleDoubleTap.last = { t: now, x: event.clientX, y: event.clientY };
  if (!prev) return false;
  if (now - prev.t > 450) return false;
  if (Math.hypot(event.clientX - prev.x, event.clientY - prev.y) > 22) return false;
  const target = targetAt(app, event.clientX, event.clientY);
  if (!target) return false;
  handledDoubleAt = now;
  handleDoubleTap.last = null;
  if (target.kind === "text") editCommitted(app, target.el);
  else editShape(app, target.el);
  return true;
}

/** True briefly after a double-tap opened a note, so the measure dialog stays out of it. */
export function doubleTapConsumed() {
  return performance.now() - handledDoubleAt < 600;
}

class LabelCommand {
  constructor(id, before, after) {
    this.id = id;
    this.before = before ? { ...before } : null;
    this.after = after ? { ...after } : null;
  }

  _set(scene, label) {
    const el = scene.getById(this.id);
    if (!el) return;
    if (label) el.label = { ...label };
    else delete el.label;
    touchElement(el);
  }

  apply(scene) { this._set(scene, this.after); }
  undo(scene) { this._set(scene, this.before); }
}

export const textTool = {
  cursor() { return "text"; },

  onDeactivate(app) { commit(app); },

  onPointerDown(app, event) {
    if (event.button !== 0 || app.interaction.spaceDown) return;
    const w = screenToWorld(event.clientX, event.clientY);
    const tol = 8 / app.view.zoom;
    if (state.host && hitTestBody(state.host, w.x, w.y, tol)) return;
    if (state.element && !state.host && hitTest(state.element, w.x, w.y, tol)) return;

    const hit = app.scene.pick(w.x, w.y, tol);
    if (hit?.type === "text") {
      editCommitted(app, hit);
      return;
    }
    commit(app);
    app.scene.clearSelection();
    state.element = createIdElement("text", {
      x: w.x,
      y: w.y,
      text: "",
      size: preferredSize,
      seed: Math.floor(Math.random() * 1e6),
    });
  },

  /**
   * True when the key was used for the note, so the app does not also pan
   * on space or delete a selection on backspace.
   */
  onKeydown(app, event) {
    const el = state.element;
    if (!el) return false;
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    if (event.key === "Escape") {
      commit(app);
      return true;
    }
    if (event.key === "Enter") {
      el.text += "\n";
      return true;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      el.text = el.text.slice(0, -1);
      return true;
    }
    if (event.key.length === 1) {
      el.text += event.key;
      return true;
    }
    return false;
  },

  getPreview() {
    if (!state.element) return null;
    if (!state.host && !state.beforeElement && state.element.style) {
      state.element.style.stroke = activeBrush.stroke;
      state.element.style.opacity = activeBrush.opacity;
    }
    return {
      element: state.element,
      caret: true,
      frame: state.host ? labelFrame(state.host) : null,
      hostId: state.host?.id || null,
      editingId: state.beforeElement ? state.element.id : null,
    };
  },
};
