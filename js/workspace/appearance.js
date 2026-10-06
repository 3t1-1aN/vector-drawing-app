// workspace/appearance.js
// Paper and grid for the open document. Render modules read `appearance`
// every frame; the panel and project I/O mutate it. The object is a binding:
// each document owns a record from createAppearance(), and bindAppearance()
// points the binding at that record so the choice stays with the document.

import { bindable } from "../core/bindable.js";

export const BACKGROUNDS = {
  "paper-warm":  { label: "Warm",      color: "#F4F0E6", grain: 10 },
  "paper-cool":  { label: "Cool",      color: "#f2f4f6", grain: 8 },
  "paper-cream": { label: "Cream",     color: "#faf3e6", grain: 12 },
  "blueprint":   { label: "Blueprint", color: "#1a3a5c", grain: 12 },
  "darkprint":   { label: "Dark",      color: "#1e1e22", grain: 8 },
  "transparent": { label: "Clear",     color: null,      grain: 0 },
  "custom":      { label: "Custom",    color: null,      grain: 8 },
};

export const GRID_TYPES = ["graph", "dot", "lined", "isometric"];

export function createAppearance() {
  return {
    background: "paper-warm",
    backgroundColor: "#F4F0E6", // used when background === "custom"
    // Paper grain. Off leaves the flat base colour, which is what you want
    // for clean export-style output and on low-contrast displays where the
    // tooth reads as dirt. The preset's colour is unchanged either way.
    paperTexture: true,
    // New drawings start with the grid off. Turning it on writes this record.
    gridVisible: false,
    gridType: "graph", // graph | dot | lined | isometric
    gridOpacity: 0.45,
    gridColor: null, // hex string, or null = auto-contrast with background
  };
}

const appearanceBinding = bindable(createAppearance());
export const appearance = appearanceBinding.proxy;
export const bindAppearance = appearanceBinding.bind;

/** Resolved base color of the current background (hex); null = transparent. */
export function getBackgroundBaseColor() {
  if (appearance.background === "custom") return appearance.backgroundColor;
  const preset = BACKGROUNDS[appearance.background];
  return preset ? preset.color : "#1e1e22";
}

/** True when overlays should stay light to contrast with the background. */
export function isDarkBackground() {
  const hex = getBackgroundBaseColor();
  if (!hex) return true; // transparent checker is dark-themed
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}

export function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
