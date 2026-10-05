// precision/measure-edit.js
// Double-click measurement editing: describe editable dimensions per
// element type and apply typed real-world values back to geometry.

import { getRectCorners, lineLength, rectSize, transformElement } from "../scene/element.js";
import { touchElement } from "../render/ink-rev.js";
import { worldToReal, realToWorld } from "./scale.js";
import { edgeLengths } from "./recognize.js";

/**
 * Editable measurement fields for an element. Each field:
 *   { key, label, value }  — value is in the current real-world unit.
 * Returns null if the element has no editable measurements.
 */
export function getEditableFields(el) {
  switch (el.type) {
    case "line":
      return [{ key: "length", label: "Length", value: worldToReal(lineLength(el)) }];
    case "circle":
      return [{ key: "diameter", label: "Diameter", value: worldToReal(el.r * 2) }];
    case "square": {
      const { w } = rectSize(el);
      return [{ key: "side", label: "Side", value: worldToReal(w) }];
    }
    case "rect": {
      const { w, h } = rectSize(el);
      return [
        { key: "width", label: "Width", value: worldToReal(w) },
        { key: "height", label: "Height", value: worldToReal(h) },
      ];
    }
    case "triangle": {
      const s = el.sides || edgeLengths(el.corners);
      return [
        { key: "side0", label: "Side A", value: worldToReal(s[0]) },
        { key: "side1", label: "Side B", value: worldToReal(s[1]) },
        { key: "side2", label: "Side C", value: worldToReal(s[2]) },
      ];
    }
    default:
      return null;
  }
}

/** Apply one or more field values (real-world units) to an element in place. */
export function applyMeasurements(el, values) {
  switch (el.type) {
    case "line":
      if (values.length != null) setLineLength(el, realToWorld(values.length));
      break;
    case "circle":
      if (values.diameter != null) el.r = Math.max(1e-3, realToWorld(values.diameter) / 2);
      break;
    case "square":
      if (values.side != null) setSquareSide(el, realToWorld(values.side));
      break;
    case "rect":
      setRectDimensions(
        el,
        values.width != null ? realToWorld(values.width) : null,
        values.height != null ? realToWorld(values.height) : null
      );
      break;
    case "triangle":
      applyTriangleSide(el, values);
      break;
  }
  touchElement(el);
}

function setLineLength(el, worldLen) {
  const len = lineLength(el);
  if (len < 1e-6) return;
  const t = worldLen / len;
  el.endX = el.startX + (el.endX - el.startX) * t;
  el.endY = el.startY + (el.endY - el.startY) * t;
}

function rectCentroid(el) {
  const c = getRectCorners(el);
  return {
    x: (c[0].x + c[1].x + c[2].x + c[3].x) / 4,
    y: (c[0].y + c[1].y + c[2].y + c[3].y) / 4,
  };
}

function setSquareSide(el, worldSide) {
  const cen = rectCentroid(el);
  const c = getRectCorners(el);
  const current = Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y);
  if (current < 1e-6) return;
  const fx = worldSide / current;
  transformElement(el, cen.x, cen.y, fx, fx, 0);
  if (el.type === "rect") el.type = "square";
  el.side = worldSide;
  el.w = worldSide;
  el.h = worldSide;
}

function setRectDimensions(el, worldW, worldH) {
  if (!el.corners) el.corners = getRectCorners(el);
  const c = el.corners;
  const cx = (c[0].x + c[1].x + c[2].x + c[3].x) / 4;
  const cy = (c[0].y + c[1].y + c[2].y + c[3].y) / 4;
  const ex = { x: c[1].x - c[0].x, y: c[1].y - c[0].y };
  const ey = { x: c[3].x - c[0].x, y: c[3].y - c[0].y };
  let w = Math.hypot(ex.x, ex.y);
  let h = Math.hypot(ey.x, ey.y);
  if (w < 1e-6 || h < 1e-6) return;
  if (worldW != null) w = worldW;
  if (worldH != null) h = worldH;
  const ux = ex.x / Math.hypot(ex.x, ex.y), uy = ex.y / Math.hypot(ex.x, ex.y);
  const vx = ey.x / Math.hypot(ey.x, ey.y), vy = ey.y / Math.hypot(ey.x, ey.y);
  const hw = w / 2, hh = h / 2;
  el.corners = [
    { x: cx - hw * ux - hh * vx, y: cy - hw * uy - hh * vy },
    { x: cx + hw * ux - hh * vx, y: cy + hw * uy - hh * vy },
    { x: cx + hw * ux + hh * vx, y: cy + hw * uy + hh * vy },
    { x: cx - hw * ux + hh * vx, y: cy - hw * uy + hh * vy },
  ];
  el.w = w;
  el.h = h;
  // Keep tool-form props in sync when present.
  if (el.startX != null) {
    el.startX = el.corners[0].x;
    el.startY = el.corners[0].y;
    el.endX = el.corners[2].x;
    el.endY = el.corners[2].y;
  }
}

/**
 * Resize one triangle side while keeping the opposite angle vertex fixed
 * and preserving the triangle's orientation.
 */
function applyTriangleSide(el, values) {
  const corners = el.corners;
  const sides = el.sides || edgeLengths(corners);
  const keys = ["side0", "side1", "side2"];
  let edgeIdx = -1;
  let newWorld = null;
  for (let i = 0; i < 3; i++) {
    if (values[keys[i]] != null) {
      edgeIdx = i;
      newWorld = realToWorld(values[keys[i]]);
      break;
    }
  }
  if (edgeIdx < 0 || sides[edgeIdx] < 1e-6) return;

  const i0 = edgeIdx;
  const i1 = (edgeIdx + 1) % 3;
  const i2 = (edgeIdx + 2) % 3;
  const a = corners[i0];
  const b = corners[i1];
  const c = corners[i2];
  const scale = newWorld / sides[edgeIdx];
  // Move vertex i1 along the edge direction from i0.
  b.x = a.x + (b.x - a.x) * scale;
  b.y = a.y + (b.y - a.y) * scale;
  el.sides = edgeLengths(corners);
}
