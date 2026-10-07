// core/view.js
// View transform state + math. No canvas/ctx dependency — pure state and
// coordinate conversions so it can be unit-tested and shared.

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 10.0;
export const ZOOM_STEP = 0.1;

/** Mutable view state: pan in CSS px, zoom is a unitless scale. */
export const view = {
  panX: 0,
  panY: 0,
  zoom: 1.0,
};

/** CSS pixels of desk kept around a notebook page. Cover fit uses none. */
export const PAGE_MARGIN = 48;

// Null on the infinite canvas. A notebook sets the page rectangle so pan and
// zoom stay on that sheet instead of traveling into empty space.
// Cover fit scales the sheet until it meets every edge of the window.
let pageConstraint = null;
let pageCover = false;

function viewportSize() {
  return { w: window.innerWidth, h: window.innerHeight };
}

function axisMargin(viewSize) {
  if (pageCover) return 0;
  return Math.min(PAGE_MARGIN, Math.max(0, viewSize / 2 - 1));
}

/** `page` is {x, y, width, height} in world units, or null to clear.
 *  `options.cover` fits the sheet so it fills the window, with no desk. */
export function setPageConstraint(page, options = {}) {
  if (!page) {
    pageConstraint = null;
    pageCover = false;
    return;
  }
  pageCover = options.cover === true;
  pageConstraint = {
    minX: page.x,
    minY: page.y,
    maxX: page.x + page.width,
    maxY: page.y + page.height,
  };
}

function pageMinZoom() {
  const { w, h } = viewportSize();
  const b = pageConstraint;
  const pw = Math.max(1, b.maxX - b.minX);
  const ph = Math.max(1, b.maxY - b.minY);
  const availW = Math.max(1, w - axisMargin(w) * 2);
  const availH = Math.max(1, h - axisMargin(h) * 2);
  const fit = pageCover
    ? Math.max(availW / pw, availH / ph)
    : Math.min(availW / pw, availH / ph);
  return clamp(fit, ZOOM_MIN, ZOOM_MAX);
}

// When the page fits, hold it centered so the desk is only the margin around
// the sheet. When it is zoomed larger than the viewport, allow at most
// `margin` of desk past an edge — pan moves across the page, not off it.
function clampAxis(pan, minWorld, maxWorld, zoom, viewSize) {
  const margin = axisMargin(viewSize);
  const pageSize = (maxWorld - minWorld) * zoom;
  const atStart = margin - minWorld * zoom;
  const atEnd = viewSize - margin - maxWorld * zoom;
  if (pageSize <= viewSize - margin * 2) return (atStart + atEnd) / 2;
  return clamp(pan, Math.min(atStart, atEnd), Math.max(atStart, atEnd));
}

export function constrainView() {
  if (!pageConstraint) return;
  const { w, h } = viewportSize();
  const minZoom = pageMinZoom();
  if (view.zoom < minZoom) {
    view.zoom = minZoom;
    const b = pageConstraint;
    view.panX = w / 2 - ((b.minX + b.maxX) / 2) * view.zoom;
    view.panY = h / 2 - ((b.minY + b.maxY) / 2) * view.zoom;
  } else if (view.zoom > ZOOM_MAX) {
    view.zoom = ZOOM_MAX;
  }
  const b = pageConstraint;
  view.panX = clampAxis(view.panX, b.minX, b.maxX, view.zoom, w);
  view.panY = clampAxis(view.panY, b.minY, b.maxY, view.zoom, h);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** screen = world * zoom + pan  =>  world = (screen - pan) / zoom */
export function screenToWorld(screenX, screenY) {
  return {
    x: (screenX - view.panX) / view.zoom,
    y: (screenY - view.panY) / view.zoom,
  };
}

export function worldToScreen(worldX, worldY) {
  return {
    x: worldX * view.zoom + view.panX,
    y: worldY * view.zoom + view.panY,
  };
}

/** Visible world extents at the current view. */
export function getVisibleWorldBounds() {
  const cssW = window.innerWidth;
  const cssH = window.innerHeight;
  return {
    left: -view.panX / view.zoom,
    top: -view.panY / view.zoom,
    right: (cssW - view.panX) / view.zoom,
    bottom: (cssH - view.panY) / view.zoom,
  };
}

/** Pan by a screen-pixel delta (feels 1:1 regardless of zoom). */
export function panBy(dxScreen, dyScreen) {
  view.panX += dxScreen;
  view.panY += dyScreen;
  constrainView();
}

/**
 * Zoom around a screen-space anchor so the world point under it stays
 * fixed. Skips the pan correction when clamping pins zoom (no drift).
 */
export function zoomAt(screenX, screenY, factor) {
  const world = screenToWorld(screenX, screenY);
  const minZoom = pageConstraint ? pageMinZoom() : ZOOM_MIN;
  const newZoom = clamp(view.zoom * factor, minZoom, ZOOM_MAX);
  if (newZoom === view.zoom) return;
  view.zoom = newZoom;
  view.panX = screenX - world.x * view.zoom;
  view.panY = screenY - world.y * view.zoom;
  constrainView();
}

/** Set view so the given world bounds fit centered in the viewport. */
export function fitToBounds(bounds, padding = 40) {
  const cssW = window.innerWidth;
  const cssH = window.innerHeight;
  const w = Math.max(1, bounds.maxX - bounds.minX);
  const h = Math.max(1, bounds.maxY - bounds.minY);
  const zoom = clamp(
    Math.min((cssW - padding * 2) / w, (cssH - padding * 2) / h),
    ZOOM_MIN,
    ZOOM_MAX
  );
  view.zoom = zoom;
  view.panX = cssW / 2 - ((bounds.minX + bounds.maxX) / 2) * zoom;
  view.panY = cssH / 2 - ((bounds.minY + bounds.maxY) / 2) * zoom;
  constrainView();
}
