// math/pipeline.js
// Orchestrates: pause → cluster → likeness → recognize → understand → overlay.
// Ink is never modified.

import { mathAssist } from "./settings.js";
import {
  createMathStore,
  nextMathId,
  upsertRegion,
  reconcileRegions,
  addWidget,
  removeWidget,
  findRegionByStroke,
} from "./store.js";
import {
  MATH_PAUSE_MS,
  clusterPathElements,
  unionBoundsOf,
  mathLikeness,
} from "./cluster.js";
import { fingerprintElements } from "./fingerprint.js";
import { recognizeElements } from "./recognize.js";
import { understand } from "./eval.js";
import { drawMathOverlays, hitOverlayAction } from "./overlay.js";
import { worldToScreen } from "../core/view.js";
import {
  createGraphWidget,
  ensureGraphSamples,
  drawGraphWidgets,
} from "./widgets/graph.js";

const LIKENESS_MIN = 0.4;

const store = createMathStore();
let settleTimer = null;
let lastOverlayHits = [];
let processing = false;

export function getMathStore() {
  return store;
}

/** Call after a path stroke is committed to the scene. */
export function onStrokeCommitted(app, element) {
  if (!mathAssist.enabled) return;
  if (!element || element.type !== "path") return;
  scheduleSettle(app);
}

/** Call after erase / slice / transform / undo / delete / load. */
export function onSceneMutated(app) {
  if (!mathAssist.enabled) {
    store.regions = [];
    store.widgets = [];
    return;
  }
  reconcileRegions(store, app.scene);
  // Refresh bounds for surviving regions; mark fingerprint mismatches stale.
  for (const region of store.regions) {
    const els = region.strokeIds
      .map((id) => app.scene.getById(id))
      .filter(Boolean);
    if (!els.length) continue;
    region.bounds = unionBoundsOf(els);
    const fp = fingerprintElements(els);
    if (fp !== region.fingerprint) {
      region.status = "stale";
      region.fingerprint = fp;
      region.overlay = null;
    }
  }
  scheduleSettle(app);
}

export function setEnabled(app, on) {
  mathAssist.enabled = on;
  if (!on) {
    clearTimeout(settleTimer);
    settleTimer = null;
    store.regions = [];
    store.widgets = [];
  } else {
    scheduleSettle(app);
  }
}

function scheduleSettle(app) {
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    settleTimer = null;
    void settle(app);
  }, MATH_PAUSE_MS);
}

async function settle(app) {
  if (!mathAssist.enabled || processing) {
    if (processing) scheduleSettle(app);
    return;
  }
  processing = true;
  try {
    reconcileRegions(store, app.scene);
    const paths = app.scene.elements.filter((e) => e.type === "path");
    const clusters = clusterPathElements(paths, app.view.zoom);

    const liveKeys = new Set(
      clusters.map((els) => els.map((e) => e.id).sort().join(","))
    );
    store.regions = store.regions.filter((r) =>
      liveKeys.has([...r.strokeIds].sort().join(","))
    );
    store.widgets = store.widgets.filter((w) =>
      store.regions.some((r) => r.id === w.regionId)
    );

    for (const els of clusters) {
      const likeness = mathLikeness(els, app.view.zoom);
      if (likeness < LIKENESS_MIN) continue;

      const fp = fingerprintElements(els);
      const ids = els.map((e) => e.id);
      let region = store.regions.find((r) => sameIds(r.strokeIds, ids));

      if (region && region.fingerprint === fp && region.status === "ready") {
        region.bounds = unionBoundsOf(els);
        continue;
      }

      if (!region) {
        region = {
          id: nextMathId("mr"),
          strokeIds: ids,
          bounds: unionBoundsOf(els),
          status: "pending",
          fingerprint: fp,
          ascii: null,
          latex: null,
          confidence: 0,
          kind: "unknown",
          mathObject: null,
          overlay: null,
          revisedAt: Date.now(),
        };
        upsertRegion(store, region);
      } else {
        region.strokeIds = ids;
        region.bounds = unionBoundsOf(els);
        region.fingerprint = fp;
        region.status = "pending";
        region.overlay = null;
        region.revisedAt = Date.now();
      }

      const gen = (store.jobGen.get(region.id) || 0) + 1;
      store.jobGen.set(region.id, gen);
      await runJob(app, region, els, gen);
    }
  } finally {
    processing = false;
  }
}

async function runJob(app, region, els, gen) {
  try {
    const recognized = await recognizeElements(els);
    if (store.jobGen.get(region.id) !== gen) return;
    if (!recognized) {
      // Keep the region so a double-tap can type the expression. No overlay.
      region.status = "ready";
      region.overlay = null;
      region.bounds = unionBoundsOf(els);
      return;
    }

    const understood = await understand(recognized.ascii);
    if (store.jobGen.get(region.id) !== gen) return;
    if (!understood) {
      region.status = "ready";
      region.ascii = recognized.ascii;
      region.latex = recognized.latex;
      region.confidence = recognized.confidence;
      region.overlay = null;
      region.bounds = unionBoundsOf(els);
      return;
    }

    region.ascii = understood.ascii;
    region.latex = recognized.latex;
    region.confidence = recognized.confidence;
    region.kind = understood.kind;
    region.mathObject = understood.mathObject;
    region.overlay = understood.overlay;
    region.status = "ready";
    region.bounds = unionBoundsOf(els);
    upsertRegion(store, region);
  } catch (err) {
    console.warn("[math] job failed", err);
    if (store.jobGen.get(region.id) === gen) {
      store.regions = store.regions.filter((r) => r.id !== region.id);
    }
  }
}

function sameIds(a, b) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((id, i) => id === sb[i]);
}

export function drawMathLayer(ctx, view) {
  if (!mathAssist.enabled) {
    lastOverlayHits = [];
    return;
  }
  lastOverlayHits = drawMathOverlays(ctx, store, view) || [];
  drawGraphWidgets(ctx, store.widgets, view);
}

export function serializeMathState() {
  return {
    enabled: mathAssist.enabled,
    regions: store.regions.map((r) => ({ ...r })),
    widgets: store.widgets.map((w) => ({
      ...w,
      state: { ...w.state, points: null, loading: true },
    })),
  };
}

export function deserializeMathState(data, app) {
  if (!data) return;
  if (data.enabled != null) mathAssist.enabled = !!data.enabled;
  store.regions = (data.regions || []).map((r) => ({ ...r }));
  store.widgets = (data.widgets || []).map((w) => ({
    ...w,
    state: { ...w.state, points: null, loading: true },
  }));
  store.jobGen.clear();
  for (const w of store.widgets) void ensureGraphSamples(w);
  if (app) onSceneMutated(app);
}

/** @returns {boolean} true if the click was consumed by math UI */
export function handleMathPointerDown(app, event) {
  if (!mathAssist.enabled) return false;
  if (event.button !== 0) return false;

  const hit = hitOverlayAction(lastOverlayHits, event.clientX, event.clientY);
  if (hit && hit.action === "graph") {
    const region = store.regions.find((r) => r.id === hit.regionId);
    if (!region) return true;
    // One graph per region.
    const existing = store.widgets.find(
      (w) => w.regionId === region.id && w.type === "graph2d"
    );
    if (existing) {
      removeWidget(store, existing.id);
      return true;
    }
    const widget = createGraphWidget(region);
    addWidget(store, widget);
    void ensureGraphSamples(widget);
    return true;
  }
  return false;
}

export { findRegionByStroke };

/** Topmost math region whose world bounds contain the screen point. */
export function regionAtScreen(sx, sy) {
  for (let i = store.regions.length - 1; i >= 0; i--) {
    const r = store.regions[i];
    const tl = worldToScreen(r.bounds.minX, r.bounds.minY);
    const br = worldToScreen(r.bounds.maxX, r.bounds.maxY);
    const x0 = Math.min(tl.x, br.x);
    const y0 = Math.min(tl.y, br.y);
    const x1 = Math.max(tl.x, br.x);
    const y1 = Math.max(tl.y, br.y);
    if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) return r;
  }
  return null;
}

/** Replace a region's expression from a typed correction. Ink stays. */
export async function applyUserExpression(regionId, raw) {
  const region = store.regions.find((r) => r.id === regionId);
  if (!region) return false;
  const understood = await understand(raw);
  if (!understood) {
    region.ascii = raw;
    region.latex = raw;
    region.overlay = null;
    region.status = "ready";
    return false;
  }
  region.ascii = understood.ascii;
  region.latex = raw;
  region.kind = understood.kind;
  region.mathObject = understood.mathObject;
  region.overlay = understood.overlay;
  region.status = "ready";
  region.confidence = 1;
  const stale = store.widgets.filter((w) => w.regionId === region.id);
  for (const w of stale) removeWidget(store, w.id);
  return true;
}
