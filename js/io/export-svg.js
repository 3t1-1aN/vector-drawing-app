// io/export-svg.js
// Export the scene (optionally bounded by an artboard) to an SVG string
// that opens correctly in browsers/Illustrator. Coordinates are written
// in world units; the SVG viewBox maps world space directly.

import { getRectCorners } from "../scene/element.js";
import { scaleSettings, UNITS } from "../precision/scale.js";
import { getMedium } from "../brush/mediums.js";

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function ptsToStr(points) {
  return points.map((p) => `${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join(" ");
}

// SVG can't reproduce the canvas jitter texture, so each medium is
// approximated with stroke-opacity / width / dasharray tweaks. pen is the
// faithful baseline; marker is broad and translucent; pencil is thin and
// faint with a fine broken dash; chalk is a coarser broken dash.
function mediumSvgAttrs(el) {
  const m = getMedium(el.style.medium || "pen");
  const baseOpacity = el.style.opacity ?? 1;
  const width = (el.style.strokeWidth || 2) * m.widthMul;
  const opacity = baseOpacity * m.alphaMul;
  let attrs = `fill="none" stroke="${el.style.stroke || "#888"}" stroke-width="${width.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="${opacity.toFixed(3)}"`;
  if (m.dash) {
    attrs += ` stroke-dasharray="${m.dash.map((d) => (d * width).toFixed(2)).join(" ")}"`;
  }
  return attrs;
}

function elementToSvg(el) {
  const common = mediumSvgAttrs(el);
  switch (el.type) {
    case "line":
      return `  <line ${common} x1="${el.startX}" y1="${el.startY}" x2="${el.endX}" y2="${el.endY}" />`;
    case "rect":
    case "square": {
      const c = getRectCorners(el);
      return `  <polygon ${common} points="${ptsToStr(c)}" />`;
    }
    case "circle":
      return `  <circle ${common} cx="${el.cx}" cy="${el.cy}" r="${el.r}" />`;
    case "triangle":
      return `  <polygon ${common} points="${ptsToStr(el.corners)}" />`;
    case "path":
      if (el.points.length < 2) return "";
      const d = "M " + el.points.map((p) => `${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join(" L ");
      return `  <path ${common} d="${d}" />`;
    default:
      return "";
  }
}

/**
 * Build an SVG string for the scene. If `artboard` is given, the viewBox
 * is set to the artboard's world rect; otherwise to the scene union bounds.
 * Embeds real-world scale metadata as SVG <metadata>.
 */
export function exportSvg(scene, view, artboard = null) {
  let bounds;
  if (artboard) {
    bounds = { minX: artboard.x, minY: artboard.y, maxX: artboard.x + artboard.w, maxY: artboard.y + artboard.h };
  } else {
    bounds = scene.unionBounds() || { minX: 0, minY: 0, maxX: 800, maxY: 600 };
  }
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const body = scene.elements.map(elementToSvg).filter(Boolean).join("\n");
  const u = UNITS[scaleSettings.unit];
  const meta = {
    format: "vda-svg",
    unit: scaleSettings.unit,
    unitsPerWorldUnit: scaleSettings.unitsPerWorldUnit,
    worldUnitsPerMeter: 1 / scaleSettings.unitsPerWorldUnit,
    label: `1 world unit = ${scaleSettings.unitsPerWorldUnit} ${u.label}`,
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.minX} ${bounds.minY} ${w} ${h}" width="${w}" height="${h}">
  <metadata>${esc(JSON.stringify(meta))}</metadata>
  <rect x="${bounds.minX}" y="${bounds.minY}" width="${w}" height="${h}" fill="#1e1e22" />
${body}
</svg>
`;
}

/** Trigger a browser download of a text blob. */
export function downloadText(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
