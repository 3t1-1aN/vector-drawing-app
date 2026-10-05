// math/store.js
// MathRegion + MathWidget store. Parallel to scene.elements — never owns ink.

let _id = 1;
export function nextMathId(prefix = "mr") {
  return `${prefix}_${_id++}`;
}

export function createMathStore() {
  return {
    regions: /** @type {MathRegion[]} */ ([]),
    widgets: /** @type {MathWidget[]} */ ([]),
    /** @type {Map<string, number>} regionId → job generation */
    jobGen: new Map(),
  };
}

/**
 * @typedef {object} MathRegion
 * @property {string} id
 * @property {string[]} strokeIds
 * @property {{minX:number,minY:number,maxX:number,maxY:number}} bounds
 * @property {"idle"|"pending"|"ready"|"error"|"stale"} status
 * @property {string} fingerprint
 * @property {string|null} ascii
 * @property {string|null} latex
 * @property {number} confidence
 * @property {string} kind
 * @property {object|null} mathObject
 * @property {{primary:string|null, actions:string[], placement:string}|null} overlay
 * @property {number} revisedAt
 */

/**
 * @typedef {object} MathWidget
 * @property {string} id
 * @property {string} regionId
 * @property {"graph2d"} type
 * @property {{minX:number,minY:number,maxX:number,maxY:number}} bounds
 * @property {object} state
 */

export function findRegionByStroke(store, strokeId) {
  return store.regions.find((r) => r.strokeIds.includes(strokeId)) || null;
}

export function findRegionAtScreen(store, view, sx, sy, hitPads) {
  // Prefer action chips; overlay hit-testing is done in overlay.js.
  void store; void view; void sx; void sy; void hitPads;
  return null;
}

/** Drop regions whose strokes vanished; mark moved ones stale via caller. */
export function reconcileRegions(store, scene) {
  const alive = new Set(scene.elements.map((e) => e.id));
  store.regions = store.regions.filter((r) => {
    r.strokeIds = r.strokeIds.filter((id) => alive.has(id));
    return r.strokeIds.length > 0;
  });
  store.widgets = store.widgets.filter((w) =>
    store.regions.some((r) => r.id === w.regionId)
  );
}

export function upsertRegion(store, region) {
  const i = store.regions.findIndex((r) => r.id === region.id);
  if (i === -1) store.regions.push(region);
  else store.regions[i] = region;
  return region;
}

export function removeRegion(store, id) {
  store.regions = store.regions.filter((r) => r.id !== id);
  store.widgets = store.widgets.filter((w) => w.regionId !== id);
}

export function addWidget(store, widget) {
  store.widgets.push(widget);
  return widget;
}

export function removeWidget(store, id) {
  store.widgets = store.widgets.filter((w) => w.id !== id);
}

export function serializeMath(store) {
  return {
    regions: store.regions.map((r) => ({ ...r, mathObject: r.mathObject })),
    widgets: store.widgets.map((w) => ({ ...w, state: { ...w.state } })),
  };
}

export function deserializeMath(store, data) {
  store.regions = (data?.regions || []).map((r) => ({ ...r }));
  store.widgets = (data?.widgets || []).map((w) => ({ ...w, state: { ...w.state } }));
  store.jobGen.clear();
}
