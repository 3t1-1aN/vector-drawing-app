// scene/document.js
// One in-memory drawing. Paper, grid, scale, and workspace mode live here
// so they follow this document for the session. Nothing is written to disk;
// a future save would store this object.

import { createAppearance } from "../workspace/appearance.js";
import { createScaleSettings } from "../precision/scale.js";
import { createWorkspaceState } from "../workspace/mode.js";

// World space is CSS pixels at zoom 1 (see core/view.js). Millimetres use
// the CSS reference pixel: 1in = 96px, so 1mm = 96/25.4 px. A4 portrait
// (210 × 297 mm) is about 794 × 1123 world units.
export const PX_PER_MM = 96 / 25.4;
export const A4_WIDTH_MM = 210;
export const A4_HEIGHT_MM = 297;

/** CSS-pixel size of a notebook page that fills the window at zoom 1. */
export function notebookPageSize() {
  return {
    width: Math.max(1, window.innerWidth || 1),
    height: Math.max(1, window.innerHeight || 1),
  };
}

export function createNotebookPage(width, height) {
  return {
    x: 0,
    y: 0,
    width,
    height,
    elements: [],
    math: null,
  };
}

/** Lined paper, grain, and no math. The pencil itself is applied by the app. */
export function applyClassicLook(doc) {
  doc.classic = true;
  doc.mathAssist = false;
  const look = doc.appearance;
  look.background = "paper-warm";
  look.backgroundColor = "#F4F0E6";
  look.paperTexture = true;
  look.gridVisible = true;
  look.gridType = "lined";
  look.gridOpacity = 0.45;
  look.gridColor = null;
}

export function createDocument(kind, options = {}) {
  const notebook = kind === "notebook";
  const doc = {
    kind: notebook ? "notebook" : "infinite",
    pages: [],
    pageIndex: 0,
    classic: false,
    appearance: createAppearance(),
    scale: createScaleSettings(),
    workspace: createWorkspaceState(),
    mathAssist: true,
  };
  if (notebook) {
    const size = notebookPageSize();
    const width = options.pageWidth || size.width;
    const height = options.pageHeight || size.height;
    doc.pages.push(createNotebookPage(width, height));
    if (options.classic) applyClassicLook(doc);
  }
  return doc;
}
