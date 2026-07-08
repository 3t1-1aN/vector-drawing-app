// brush/active-brush.js
// The active brush is the style applied to every newly created element.
// The style wheel edits it; defaultStyle() in scene/element.js reads it.
// Opacity is stored separately from the stroke color so the wheel's
// opacity arc and the color picker stay independent.

export const activeBrush = {
  stroke: "#2b2b30",
  strokeWidth: 2.0,
  opacity: 1.0,
  medium: "pen", // pen | marker | pencil | chalk
};

/** Snapshot of the brush as an element style object. */
export function brushToStyle() {
  return { ...activeBrush };
}

export function setBrush(patch) {
  Object.assign(activeBrush, patch);
}
