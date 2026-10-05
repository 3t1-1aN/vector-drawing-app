// render/ink-rev.js
// One integer the ink layer watches. Geometry and style edits bump it so a
// resting canvas can be blitted instead of redrawn, without scanning points
// to discover that nothing changed.
//
// Per-element revisions live in a WeakMap so undo snapshots (which copy
// enumerable fields) cannot revive a stale brush bitmap.

let sceneRev = 1;
const revs = new WeakMap();

function bump(el) {
  sceneRev++;
  if (el) revs.set(el, sceneRev);
}

/** Any committed-ink change: add, remove, load. */
export function touchScene() {
  bump(null);
}

/** This element's pixels changed. Also dirties the composited layer. */
export function touchElement(el) {
  if (el) bump(el);
}

export function inkSceneRev() {
  return sceneRev;
}

/**
 * Revision of one element's brush bitmap. Stable across frames until
 * `touchElement`. A first sighting records the current scene revision and
 * does not dirty the layer.
 */
export function elementRev(el) {
  let r = revs.get(el);
  if (r === undefined) {
    r = sceneRev;
    revs.set(el, r);
  }
  return r;
}
