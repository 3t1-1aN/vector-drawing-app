// core/canvas.js
// Canvas setup + DPR-aware transform helpers. Owns the 2D context and
// provides screen-space / world-space baseline transforms.

export function getCanvas() {
  return document.getElementById("stage");
}

export function getContext() {
  const canvas = getCanvas();
  const ctx = canvas.getContext("2d");
  return ctx;
}

/**
 * Resize the drawing buffer to match the viewport in device pixels so the
 * canvas never gets stretched/blurred by the browser.
 */
export function resizeCanvas() {
  const canvas = getCanvas();
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = window.innerWidth;
  const cssHeight = window.innerHeight;
  canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
  canvas.height = Math.max(1, Math.floor(cssHeight * dpr));
  canvas.style.width = cssWidth + "px";
  canvas.style.height = cssHeight + "px";
}

/** DPR-scaled identity: 1 CSS pixel == dpr device pixels. */
export function resetToScreenSpace(ctx) {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/**
 * World transform on top of the DPR baseline: translate (pan in CSS px)
 * then scale (zoom). After this, all drawing is in world coordinates.
 */
export function applyViewTransform(ctx, view) {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(view.panX, view.panY);
  ctx.scale(view.zoom, view.zoom);
}
