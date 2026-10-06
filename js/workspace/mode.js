// workspace/mode.js
// Which of the two workspaces is active.
//
// The app carries a full measurement stack -- real-world units, CAD
// dimension annotations, a scale bar, artboards, double-click to type an
// exact length. All of it is essential when you are drawing a floor plan
// and all of it is noise when you are sketching. Rather than make everyone
// pay for it, the two uses are named and the measurement layer belongs to
// one of them.
//
// This is a display and interaction mode, not a document format: the scene
// is identical either way, nothing is discarded by switching, and a drawing
// made in one mode opens fine in the other. What changes is which controls
// the panel offers and which overlays the canvas draws.
// `workspace` is the open document's mode; bindWorkspace() points it there.

import { bindable } from "../core/bindable.js";

// draw     -- paper and brushes
// engineer -- adds units, dimensions, artboards and the scale bar
export const WORKSPACE_MODES = ["draw", "engineer"];

export function createWorkspaceState() {
  return { mode: "draw" };
}

const workspaceBinding = bindable(createWorkspaceState());
export const workspace = workspaceBinding.proxy;
export const bindWorkspace = workspaceBinding.bind;

/** True when the measurement layer and its controls should be present. */
export function isEngineering() {
  return workspace.mode === "engineer";
}

export function setWorkspaceMode(mode) {
  if (WORKSPACE_MODES.includes(mode)) workspace.mode = mode;
}
