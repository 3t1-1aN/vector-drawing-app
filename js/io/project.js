// io/project.js
// JSON project format (.vda): serialize the view state, scale settings,
// artboards, and elements. Load restores them. History is not persisted.

import { cloneElement, createIdElement } from "../scene/element.js";
import { scaleSettings } from "../precision/scale.js";
import { view } from "../core/view.js";
import { appearance } from "../workspace/appearance.js";
import { workspace, setWorkspaceMode } from "../workspace/mode.js";
import { activeBrush } from "../brush/active-brush.js";

const FORMAT_VERSION = 2;

export function serializeProject(scene) {
  return {
    format: "vda",
    version: FORMAT_VERSION,
    view: { panX: view.panX, panY: view.panY, zoom: view.zoom },
    scale: { ...scaleSettings },
    appearance: { ...appearance },
    workspace: { ...workspace },
    brush: { ...activeBrush },
    artboards: scene.artboards.map((a) => ({ ...a })),
    elements: scene.elements.map((el) => cloneElement(el)),
  };
}

export function deserializeProject(data, scene) {
  if (!data || data.format !== "vda") throw new Error("Not a .vda project file");
  const v = data.view || {};
  view.panX = v.panX || 0;
  view.panY = v.panY || 0;
  view.zoom = v.zoom || 1;
  const s = data.scale || {};
  if (s.unit) scaleSettings.unit = s.unit;
  if (s.unitsPerWorldUnit != null) scaleSettings.unitsPerWorldUnit = s.unitsPerWorldUnit;
  if (s.dimensionMode) scaleSettings.dimensionMode = s.dimensionMode;
  else if (s.showDimensions != null) scaleSettings.dimensionMode = s.showDimensions ? "cad" : "off";
  // Version 1 files have no appearance/brush blocks; keep current settings.
  if (data.appearance) Object.assign(appearance, data.appearance);
  if (data.brush) Object.assign(activeBrush, data.brush);
  // Files saved before the two workspaces existed still say whether they
  // were drawn against measurements, so honour that rather than dropping
  // an engineering drawing into Draw and hiding all of its dimensions.
  if (data.workspace && data.workspace.mode) setWorkspaceMode(data.workspace.mode);
  else if (data.artboards?.length || scaleSettings.dimensionMode !== "off") {
    setWorkspaceMode("engineer");
  }
  scene.artboards = (data.artboards || []).map((a) => ({ ...a }));
  scene.elements = (data.elements || []).map((el) => createIdElement(el.type, stripId(el)));
  scene.clearSelection();
}

// Re-hydrate an element from saved data without letting it keep a stale id
// (createIdElement assigns a fresh one). We keep style too.
function stripId(el) {
  const { id, ...rest } = el;
  return rest;
}

/** Open a file picker and resolve with the selected File. */
export function pickFile(accept) {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => {
      if (input.files && input.files[0]) resolve(input.files[0]);
      else reject(new Error("No file selected"));
    };
    input.click();
  });
}

export function readFileText(file) {
  return file.text();
}
