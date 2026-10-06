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

export function createDocument(kind) {
  const notebook = kind === "notebook";
  const doc = {
    kind: notebook ? "notebook" : "infinite",
    // Further pages append here. Only pages[0] is shown until page-flip exists.
    pages: [],
    appearance: createAppearance(),
    scale: createScaleSettings(),
    workspace: createWorkspaceState(),
    mathAssist: true,
  };
  if (notebook) {
    doc.pages.push({
      x: 0,
      y: 0,
      width: A4_WIDTH_MM * PX_PER_MM,
      height: A4_HEIGHT_MM * PX_PER_MM,
    });
  }
  return doc;
}
