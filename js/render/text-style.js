// render/text-style.js
// Type from the paper test sheet.
//
// Body ink is the serif used for the sheet's headings and paragraphs.
// Short notes (measurements, names, the scale) use the typewriter face.
// Both sit under the sheet's SVG filters, which rough the edge the way
// the ink and the ribbon do. On a dark sheet the filters and the multiply
// colour would disappear, so those fall back to a light face.

import { isDarkBackground } from "../workspace/appearance.js";

export const INK_FAMILY = 'Georgia, "Iowan Old Style", "Times New Roman", serif';
export const TYPE_FAMILY = '"Special Elite", "Courier Prime", "Courier New", Courier, monospace';

export const INK_COLOR = "#2e2e2e";
export const TYPE_COLOR = "#2b2926";
const DARK_INK = "#e8e5dc";

export function inkFont(px, weight = 400) {
  return `${weight} ${px}px ${INK_FAMILY}`;
}

export function typeFont(px) {
  return `${px}px ${TYPE_FAMILY}`;
}

/**
 * Point the context at sheet ink or typewriter ink.
 * Returns a restore function. The filter is the sheet's #ink / #typeink.
 */
export function useSheetText(ctx, { typewriter = false, px = 13, weight = 400 } = {}) {
  const dark = isDarkBackground();
  const prevFilter = ctx.filter;
  const prevFill = ctx.fillStyle;
  const prevSpacing = ctx.letterSpacing;
  ctx.font = typewriter ? typeFont(px) : inkFont(px, weight);
  ctx.filter = dark ? "none" : (typewriter ? "url(#typeink)" : "url(#ink)");
  ctx.fillStyle = dark ? DARK_INK : (typewriter ? TYPE_COLOR : INK_COLOR);
  if (typewriter && "letterSpacing" in ctx) ctx.letterSpacing = "0.02em";
  return () => {
    ctx.filter = prevFilter;
    ctx.fillStyle = prevFill;
    if ("letterSpacing" in ctx) ctx.letterSpacing = prevSpacing;
  };
}
