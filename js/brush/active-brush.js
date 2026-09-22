// brush/active-brush.js
// ActiveStyleState — the single source of truth for how the next stroke
// will look and which tool is active. The hub, tool ring, property ring and
// color wheel all subscribe to it; none of them poke each other directly.
// Elements stamp a concrete copy of this style at creation time (vector
// inheritance), so committed strokes never change when the hub changes.

export const activeBrush = {
  stroke: "#2b2b30",
  strokeWidth: 2.0,
  opacity: 1.0,
  medium: "pen",      // brush preset id, see brush/presets.js
  toolType: "line",   // select | line | rect | circle | pen | nudge | slice | eraser
  smoothing: 0,       // 0..1, pen stroke smoothing
};

const listeners = new Set();

/** Subscribe to style changes. fn(patch) is called with the changed keys. */
export function subscribeStyle(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(patch) {
  for (const fn of listeners) {
    try { fn(patch); } catch (e) { console.error(e); }
  }
}

/** Mutate the active style and notify subscribers. */
export function setBrush(patch) {
  Object.assign(activeBrush, patch);
  emit(patch);
}

/** Read a single style value. */
export function getStyle(key) {
  return activeBrush[key];
}

/** Snapshot of the brush as an element style object (stamped on creation). */
export function brushToStyle() {
  return {
    stroke: activeBrush.stroke,
    strokeWidth: activeBrush.strokeWidth,
    opacity: activeBrush.opacity,
    medium: activeBrush.medium,
  };
}
