// scene/scene.js
// Scene holds the ordered element list + the current selection, and owns
// the mutate-with-history entry points the tools call into.

import {
  createIdElement,
  cloneElement,
  hitTest,
  intersectsBounds,
  getBounds,
} from "./element.js";

export class Scene {
  constructor() {
    /** @type {Array} world-space elements in draw order. */
    this.elements = [];
    /** @type {Set<string>} selected element ids. */
    this.selected = new Set();
    /** Artboards: {id, name, x, y, w, h}. */
    this.artboards = [];
  }

  getAll() {
    return this.elements;
  }

  getById(id) {
    return this.elements.find((e) => e.id === id) || null;
  }

  add(el) {
    this.elements.push(el);
    return el;
  }

  remove(id) {
    const i = this.elements.findIndex((e) => e.id === id);
    if (i !== -1) this.elements.splice(i, 1);
    this.selected.delete(id);
  }

  // --- Selection --------------------------------------------------
  select(id) {
    this.selected.clear();
    if (id) this.selected.add(id);
  }

  toggle(id) {
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
  }

  addToSelection(id) {
    if (id) this.selected.add(id);
  }

  clearSelection() {
    this.selected.clear();
  }

  isSelected(id) {
    return this.selected.has(id);
  }

  getSelected() {
    return this.elements.filter((e) => this.selected.has(e.id));
  }

  hasSelection() {
    return this.selected.size > 0;
  }

  /**
   * Pick the topmost element under a world point within a tolerance
   * (world units). Returns the element or null.
   */
  pick(worldX, worldY, toleranceWorld) {
    for (let i = this.elements.length - 1; i >= 0; i--) {
      const el = this.elements[i];
      if (hitTest(el, worldX, worldY, toleranceWorld)) return el;
    }
    return null;
  }

  /** All elements whose bounds intersect the given world rectangle. */
  pickInBounds(bounds) {
    const result = [];
    for (const el of this.elements) {
      if (intersectsBounds(el, bounds)) result.push(el);
    }
    return result;
  }

  /** Union bounds of all elements (for "fit all"); null if empty. */
  unionBounds() {
    if (this.elements.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of this.elements) {
      const b = getBounds(el);
      if (b.minX < minX) minX = b.minX;
      if (b.minY < minY) minY = b.minY;
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.maxY > maxY) maxY = b.maxY;
    }
    return { minX, minY, maxX, maxY };
  }
}

// ------------------------------------------------------------------
// History — command-pattern undo/redo over element snapshots.
// ------------------------------------------------------------------

export class History {
  constructor() {
    this.undoStack = [];
    this.redoStack = [];
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  /** Push a command (must have apply() and undo()). */
  push(cmd) {
    this.undoStack.push(cmd);
    this.redoStack = [];
  }

  undo(scene) {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    cmd.undo(scene);
    this.redoStack.push(cmd);
    return true;
  }

  redo(scene) {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.apply(scene);
    this.undoStack.push(cmd);
    return true;
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }
}

/** Snapshot an element's geometry (shallow-ish deep copy). */
function snap(el) {
  return cloneElement(el);
}

/** Command: add a new element. The element is added to the scene by the
 *  caller BEFORE pushing (mirrors the mutate-then-push convention used by
 *  the transform commands); this command only powers undo/redo. */
export class AddElementCommand {
  constructor(el) {
    this.el = cloneElement(el);
  }
  apply(scene) { scene.add(cloneElement(this.el)); }
  undo(scene) { scene.remove(this.el.id); }
}

/** Command: remove an existing element. Caller removes before push. */
export class RemoveElementsCommand {
  constructor(elements) {
    this.snapshots = elements.map(snap);
  }
  apply(scene) {
    for (const s of this.snapshots) scene.remove(s.id);
  }
  undo(scene) {
    for (const s of this.snapshots) scene.add(cloneElement(s));
  }
}

/**
 * Command: transform a set of elements. Records before/after snapshots
 * of each element; undo restores before, redo applies after.
 */
export class TransformCommand {
  constructor() {
    this.records = []; // { id, before, after }
  }

  /** Capture the pre-transform state of these elements. */
  begin(elements) {
    this.records = elements.map((el) => ({ id: el.id, before: snap(el) }));
  }

  /** Capture the post-transform state (call after mutating the elements). */
  end(elements) {
    for (const rec of this.records) {
      const el = elements.find((e) => e.id === rec.id);
      if (el) rec.after = snap(el);
    }
  }

  apply(scene) {
    for (const r of this.records) {
      if (!r.after) continue;
      const el = scene.getById(r.id);
      if (el) Object.assign(el, cloneElement(r.after));
    }
  }

  undo(scene) {
    for (const r of this.records) {
      if (!r.before) continue;
      const el = scene.getById(r.id);
      if (el) Object.assign(el, cloneElement(r.before));
    }
  }
}

/**
 * Command: restyle a set of elements. Mirrors TransformCommand's
 * begin/mutate/end convention but snapshots only the style objects, so a
 * whole slider drag collapses into one undo step.
 */
export class StyleCommand {
  constructor() {
    this.records = []; // { id, before, after }
  }

  begin(elements) {
    this.records = elements.map((el) => ({ id: el.id, before: { ...el.style } }));
  }

  end(elements) {
    for (const rec of this.records) {
      const el = elements.find((e) => e.id === rec.id);
      if (el) rec.after = { ...el.style };
    }
  }

  /** True if any style actually changed (skip pushing no-op commands). */
  changed() {
    return this.records.some((r) => {
      if (!r.after) return false;
      const keys = new Set([...Object.keys(r.before), ...Object.keys(r.after)]);
      for (const k of keys) if (r.before[k] !== r.after[k]) return true;
      return false;
    });
  }

  apply(scene) {
    for (const r of this.records) {
      if (!r.after) continue;
      const el = scene.getById(r.id);
      if (el) el.style = { ...r.after };
    }
  }

  undo(scene) {
    for (const r of this.records) {
      const el = scene.getById(r.id);
      if (el) el.style = { ...r.before };
    }
  }
}

export { createIdElement, cloneElement };
