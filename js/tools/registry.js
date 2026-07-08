// tools/registry.js
// Tool registry + a small Tool interface contract. Each tool is an object
// with optional hooks; the app calls them through this registry.
//
// Tool hooks (all optional, all receive `app`):
//   onActivate(app), onDeactivate(app)
//   onPointerDown(app, event), onPointerMove(app, event), onPointerUp(app, event)
//   onKeydown(app, event)         // only when this tool is active
//   getPreview(app) -> { element, recognized } | null
//   getMarquee(app) -> { x0, y0, x1, y1 } | null   (screen space)
//   getOverlay(app) -> { kind:'handles' } | null    (extra screen overlay)
//   cursor(app) -> string

const registry = new Map();
const order = [];

export function registerTool(name, tool) {
  registry.set(name, { name, ...tool });
  order.push(name);
}

export function getTool(name) {
  return registry.get(name) || null;
}

export function listTools() {
  return order.map((n) => registry.get(n));
}
