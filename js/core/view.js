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
}

/**
 * Zoom around a screen-space anchor so the world point under it stays
 * fixed. Skips the pan correction when clamping pins zoom (no drift).
 */
export function zoomAt(screenX, screenY, factor) {
  const world = screenToWorld(screenX, screenY);
  const newZoom = clamp(view.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  if (newZoom === view.zoom) return;
  view.zoom = newZoom;
  view.panX = screenX - world.x * view.zoom;
  view.panY = screenY - world.y * view.zoom;
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
}
