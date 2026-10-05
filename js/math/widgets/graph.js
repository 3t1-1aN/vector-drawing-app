// math/widgets/graph.js
// Opt-in graph widget: small world-space frame near the expression.
// Axes are drawn through the data origin (0,0), not the frame center.

import { sampleFunction } from "../eval.js";
import { nextMathId } from "../store.js";
import { worldToScreen } from "../../core/view.js";

const FRAME_W = 220;
const FRAME_H = 160;
const PAD = 24;

export function createGraphWidget(region) {
  const b = region.bounds;
  const expr =
    region.mathObject?.expr ||
    region.ascii?.replace(/^y=/i, "") ||
    "x";
  return {
    id: nextMathId("mw"),
    regionId: region.id,
    type: "graph2d",
    bounds: {
      minX: b.maxX + PAD,
      minY: b.minY,
      maxX: b.maxX + PAD + FRAME_W,
      maxY: b.minY + FRAME_H,
    },
    state: {
      expr,
      x0: -5,
      x1: 5,
      points: null,
      loading: true,
    },
  };
}

export async function ensureGraphSamples(widget) {
  if (widget.state.points && !widget.state.loading) return;
  widget.state.loading = true;
  try {
    const pts = await sampleFunction(
      widget.state.expr,
      widget.state.x0,
      widget.state.x1,
      100
    );
    widget.state.points = pts;
  } catch {
    widget.state.points = [];
  }
  widget.state.loading = false;
}

/** Draw all graph widgets in screen space (stable stroke width). */
export function drawGraphWidgets(ctx, widgets, view) {
  for (const w of widgets) {
    if (w.type !== "graph2d") continue;
    drawOne(ctx, w, view);
  }
}

function drawOne(ctx, w, view) {
  const a = worldToScreen(w.bounds.minX, w.bounds.minY);
  const b = worldToScreen(w.bounds.maxX, w.bounds.maxY);
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const width = Math.abs(b.x - a.x);
  const height = Math.abs(b.y - a.y);
  if (width < 40 || height < 30) return;

  ctx.save();
  ctx.fillStyle = "rgba(18, 20, 26, 0.78)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, width, height, 8);
  ctx.fill();
  ctx.stroke();

  const inset = 10;
  const gx = x + inset;
  const gy = y + inset;
  const gw = width - inset * 2;
  const gh = height - inset * 2 - 14;

  const pts = w.state.points;
  const x0 = w.state.x0;
  const x1 = w.state.x1;

  if (!pts || pts.length < 2) {
    // Placeholder axes (origin unknown until samples land).
    strokeAxes(ctx, gx, gy, gw, gh, 0.5, 0.5);
    ctx.fillStyle = "rgba(230, 230, 235, 0.55)";
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    ctx.fillText(w.state.loading ? "…" : "no plot", gx, gy + gh / 2);
  } else {
    let minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    // Always include y=0 so the x-axis is meaningful for polynomials like x²−4.
    if (minY > 0) minY = 0;
    if (maxY < 0) maxY = 0;
    const pad = Math.max((maxY - minY) * 0.08, 0.5);
    minY -= pad;
    maxY += pad;
    if (maxY - minY < 1e-9) {
      minY -= 1;
      maxY += 1;
    }

    // Axes through data origin (0, 0), not the frame midpoint.
    const originX = (0 - x0) / (x1 - x0);
    const originY = (0 - minY) / (maxY - minY);
    strokeAxes(ctx, gx, gy, gw, gh, originX, 1 - originY);

    ctx.strokeStyle = "rgba(130, 200, 255, 0.95)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < pts.length; i++) {
      const px = gx + ((pts[i].x - x0) / (x1 - x0)) * gw;
      const py = gy + gh - ((pts[i].y - minY) / (maxY - minY)) * gh;
      // Break the path across gaps (e.g. asymptotes later).
      if (!Number.isFinite(px) || !Number.isFinite(py)) {
        started = false;
        continue;
      }
      if (!started) {
        ctx.moveTo(px, py);
        started = true;
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(220, 224, 232, 0.7)";
  ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.fillText(truncate(`y = ${w.state.expr}`, 28), gx, y + height - 6);
  ctx.restore();
}

/** originFracX/Y in 0..1 plot space (y grows downward for canvas). */
function strokeAxes(ctx, gx, gy, gw, gh, originFracX, originFracY) {
  const ox = gx + clamp01(originFracX) * gw;
  const oy = gy + clamp01(originFracY) * gh;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(gx, oy);
  ctx.lineTo(gx + gw, oy);
  ctx.moveTo(ox, gy);
  ctx.lineTo(ox, gy + gh);
  ctx.stroke();
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function truncate(s, n) {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Hit-test close button area (top-right of widget) in screen coords. */
export function hitGraphClose(widget, view, sx, sy) {
  const a = worldToScreen(widget.bounds.minX, widget.bounds.minY);
  const b = worldToScreen(widget.bounds.maxX, widget.bounds.maxY);
  const x = Math.max(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return sx >= x - 22 && sx <= x - 4 && sy >= y + 4 && sy <= y + 20;
}
