// io/export-svg.js
// Export the scene (optionally bounded by an artboard) to an SVG string
// that opens correctly in browsers/Illustrator. Coordinates are written
// in world units; the SVG viewBox maps world space directly.

import { getRectCorners } from "../scene/element.js";
import { labelFrame } from "../render/text-frame.js";
import { wrappedRows } from "../render/type-text.js";
import { scaleSettings, UNITS } from "../precision/scale.js";
import { getBrushPreset, isFilledMedium } from "../brush/presets.js";

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function ptsToStr(points) {
  return points.map((p) => `${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join(" ");
}

// SVG has no equivalent of a stamped, textured brush, so each preset exports
// as a plain stroke using the same weight and translucency the wheel shows in
// its previews. The export is a faithful outline, not a picture of the brush;
// anything else would mean emitting thousands of filled polygons per stroke.
function brushSvgAttrs(el) {
  const preset = getBrushPreset(el.style.medium || "pen");
  const sw = preset.swatch;
  const baseOpacity = el.style.opacity ?? 1;
  // A fill is the one medium SVG can reproduce exactly, down to the winding
  // rule, so it exports as the shape it is rather than as an outline.
  if (isFilledMedium(el.style.medium)) {
    const opacity = baseOpacity * sw.alphaMul;
    return `fill="${el.style.stroke || "#888"}" fill-rule="evenodd" fill-opacity="${opacity.toFixed(3)}" stroke="none"`;
  }
  const width = (el.style.strokeWidth || 2) * sw.widthMul;
  const opacity = baseOpacity * sw.alphaMul;
  let attrs = `fill="none" stroke="${el.style.stroke || "#888"}" stroke-width="${width.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="${opacity.toFixed(3)}"`;
  if (sw.dash) {
    attrs += ` stroke-dasharray="${sw.dash.map((d) => (d * width).toFixed(2)).join(" ")}"`;
  }
  return attrs;
}

function labelSvg(el) {
  if (!el.label?.text?.trim()) return "";
  const frame = labelFrame(el);
  if (!frame) return "";
  const size = el.label.size || 17;
  const rows = wrappedRows({ text: el.label.text, size }, frame.width);
  const lineH = size * 1.6;
  const fill = el.style?.stroke || "#2b2926";
  const y0 = frame.cy - ((rows.length - 1) * lineH) / 2;
  const deg = (frame.angle || 0) * 180 / Math.PI;
  const spin = Math.abs(deg) > 0.05
    ? ` transform="rotate(${deg.toFixed(2)} ${frame.cx.toFixed(2)} ${frame.cy.toFixed(2)})"`
    : "";
  const tspans = rows.map((row, i) =>
    `<tspan x="${frame.cx.toFixed(2)}" dy="${i === 0 ? 0 : lineH.toFixed(2)}">${esc(row) || " "}</tspan>`,
  ).join("");
  return `  <text${spin} y="${y0.toFixed(2)}" text-anchor="middle" dominant-baseline="middle" font-family="Special Elite, Courier New, monospace" font-size="${size}" fill="${fill}">${tspans}</text>`;
}

function elementToSvg(el) {
  const common = brushSvgAttrs(el);
  let body = "";
  switch (el.type) {
    case "line":
      body = `  <line ${common} x1="${el.startX}" y1="${el.startY}" x2="${el.endX}" y2="${el.endY}" />`;
      break;
    case "rect":
    case "square": {
      const c = getRectCorners(el);
      body = `  <polygon ${common} points="${ptsToStr(c)}" />`;
      break;
    }
    case "circle":
      body = `  <circle ${common} cx="${el.cx}" cy="${el.cy}" r="${el.r}" />`;
      break;
    case "triangle":
      body = `  <polygon ${common} points="${ptsToStr(el.corners)}" />`;
      break;
    case "text":
      body = `  <text x="${el.x.toFixed(3)}" y="${el.y.toFixed(3)}" font-family="Special Elite, Courier New, monospace" font-size="${el.size || 17}" fill="${el.style?.stroke || "#2b2926"}" dominant-baseline="hanging">${esc(el.text || "")}</text>`;
      break;
    case "path":
      if (el.points.length >= 2) {
        const d = "M " + el.points.map((p) => `${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join(" L ");
        // The renderer closes a fill back to its start; the export has to spell
        // that edge out or the shape opens up outside the app.
        const close = isFilledMedium(el.style.medium) ? " Z" : "";
        body = `  <path ${common} d="${d}${close}" />`;
      }
      break;
    default:
      break;
  }
  const label = labelSvg(el);
  return [body, label].filter(Boolean).join("\n");
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
