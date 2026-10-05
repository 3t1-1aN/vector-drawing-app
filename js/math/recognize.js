// math/recognize.js
// Region PNG → Pix2Text backend → LaTeX. Silence when the service is down
// or the crop is not a formula. Ink is never rewritten.

import { rasterizeRegion } from "./raster.js";
import { mathAssist } from "./settings.js";

/**
 * @param {object[]} elements
 * @returns {Promise<{ascii:string, latex:string, confidence:number}|null>}
 */
export async function recognizeElements(elements) {
  const raster = rasterizeRegion(elements);
  if (!raster) return null;

  try {
    const res = await fetch(`${mathAssist.apiBase}/math/recognize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: raster.dataUrl }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const latex = String(data.latex || data.ascii || "").trim();
    if (!latex) return null;
    const confidence = typeof data.confidence === "number" ? data.confidence : 0.8;
    if (confidence < 0.2) return null;
    return { ascii: latex, latex, confidence };
  } catch (err) {
    console.warn("[math] recognize unavailable", err);
    return null;
  }
}
