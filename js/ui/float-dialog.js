// Shared placement for the measurement and expression editors.
// Sits beside the thing being edited, clear of its bounds, and flips
// when that side would leave the viewport.

import { worldToScreen } from "../core/view.js";

const PAD = 12;
const GAP = 16;

/** Screen rectangle around a world box, padded so callouts stay clear. */
export function screenAvoid(bounds, pad = 78) {
  if (!bounds) return null;
  const tl = worldToScreen(bounds.minX, bounds.minY);
  const br = worldToScreen(bounds.maxX, bounds.maxY);
  return {
    left: Math.min(tl.x, br.x) - pad,
    top: Math.min(tl.y, br.y) - pad,
    right: Math.max(tl.x, br.x) + pad,
    bottom: Math.max(tl.y, br.y) + pad,
  };
}

export function placeFloatDialog(dialog, sx, sy, avoid) {
  dialog.classList.remove("hidden");
  const size = dialog.getBoundingClientRect();
  const w = size.width;
  const h = size.height;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const spots = [];
  if (avoid) {
    spots.push([avoid.right + GAP, sy - h / 2]);
    spots.push([avoid.left - w - GAP, sy - h / 2]);
    spots.push([sx - w / 2, avoid.bottom + GAP]);
    spots.push([sx - w / 2, avoid.top - h - GAP]);
  }
  spots.push([sx + GAP, sy + GAP]);
  spots.push([sx - w - GAP, sy + GAP]);
  spots.push([sx + GAP, sy - h - GAP]);
  spots.push([sx - w - GAP, sy - h - GAP]);

  let best = null;
  let bestScore = Infinity;
  for (const [rawLeft, rawTop] of spots) {
    const left = clamp(rawLeft, PAD, vw - w - PAD);
    const top = clamp(rawTop, PAD, vh - h - PAD);
    const overlap = avoid && intersects(left, top, w, h, avoid) ? 1 : 0;
    const pushed =
      rawLeft < PAD || rawTop < PAD || rawLeft + w > vw - PAD || rawTop + h > vh - PAD;
    const dist = Math.hypot(left + w / 2 - sx, top + h / 2 - sy);
    const score = overlap * 100000 + (pushed ? 10000 : 0) + dist;
    if (score < bestScore) {
      bestScore = score;
      best = { left, top };
    }
  }

  dialog.style.left = `${best.left}px`;
  dialog.style.top = `${best.top}px`;
}

function clamp(value, min, max) {
  if (max < min) return min;
  return Math.max(min, Math.min(value, max));
}

function intersects(left, top, w, h, box) {
  return left < box.right && left + w > box.left && top < box.bottom && top + h > box.top;
}
