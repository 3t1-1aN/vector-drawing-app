// brush/physics.js
// Stage 2 of the brush pipeline, in two halves that run at different times.
//
// CAPTURE TIME - PressureTracker smooths the incoming pointer, measures
// velocity and resolves pressure (real or synthesised). It emits the points
// that get stored on the element: { x, y, p, v }.
//
// RENDER TIME - buildNodes() turns those stored points into evenly spaced
// nodes carrying width, alpha and direction. It is pure: the same points and
// preset always produce the same nodes, which is what lets the renderer cache
// a stroke and lets a reloaded file look identical to when it was drawn.
//
// The split exists because velocity cannot be recovered from geometry alone.
// Rather than persist timestamps, we bake the measurements the renderer needs
// into each point at capture time.

// Speed treated as "fast", in screen px per ms. A brisk stroke sits near 1.
const REF_SPEED = 1.8;
// Pointer noise below this is hand tremor, not intent.
const MIN_STORE_DIST = 1.5;
// Dense polyline step before even-spacing resampling, in device px.
const DENSIFY_STEP = 2;
// Closest two stamps ever get, in device px. Below this the cost climbs with
// no visible gain.
const MIN_STEP = 0.75;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

/** Pressure -> value along a preset's min..1 curve. */
function response(pressure, curve) {
  return curve.min + (1 - curve.min) * Math.pow(pressure, curve.gamma);
}

// --- Capture time ----------------------------------------------------------

export class PressureTracker {
  /**
   * @param preset  brush preset (supplies its own smoothing floor)
   * @param userSmoothing  the wheel's smoothing setting, 0..1
   */
  constructor(preset, userSmoothing = 0) {
    this.preset = preset;
    // Presets set a floor because a fine-liner needs a steadier line than a
    // pencil even when the user has smoothing off.
    this.amount = clamp(preset.smoothing + userSmoothing * 0.75, 0, 0.9);
    this.sx = 0;
    this.sy = 0;
    this.lastT = 0;
    this.speed = 0;
    this.pressure = 0.5;
    this.started = false;
    this.emittedX = 0;
    this.emittedY = 0;
  }

  /** Seed from the first sample. Returns the first point to store. */
  begin(s) {
    this.sx = s.x;
    this.sy = s.y;
    this.lastT = s.t;
    this.speed = 0;
    this.started = true;
    // A pen barely in contact reads near 0; starting from its own value
    // rather than a constant keeps a deliberate light entry light.
    this.pressure = s.pressure != null ? s.pressure : 0.5;
    this.emittedX = s.x;
    this.emittedY = s.y;
    return { x: s.x, y: s.y, p: this.resolvePressure(s), v: 0 };
  }

  /**
   * Feed one raw sample. Returns a point to store, or null when the sample
   * was too close to the last stored one to carry information.
   */
  push(s) {
    if (!this.started) return this.begin(s);

    const dt = Math.max(1, s.t - this.lastT);
    this.lastT = s.t;

    // One-pole position filter. The floor keeps the cursor from lagging so
    // far behind the hand that the stroke stops feeling connected.
    const k = 1 - Math.min(0.88, this.amount * 0.88);
    const prevX = this.sx;
    const prevY = this.sy;
    this.sx += (s.x - this.sx) * k;
    this.sy += (s.y - this.sy) * k;

    // Velocity from the filtered path, itself low-passed: raw per-event speed
    // is far too spiky to drive width with.
    const inst = Math.hypot(this.sx - prevX, this.sy - prevY) / dt;
    this.speed += (inst - this.speed) * 0.25;

    if (s.pressure != null) {
      this.pressure += (s.pressure - this.pressure) * 0.35;
    }

    const moved = Math.hypot(this.sx - this.emittedX, this.sy - this.emittedY);
    if (moved < MIN_STORE_DIST) return null;
    this.emittedX = this.sx;
    this.emittedY = this.sy;
    return {
      x: this.sx,
      y: this.sy,
      p: this.resolvePressure(s),
      v: clamp(this.speed / REF_SPEED, 0, 1),
    };
  }

  /**
   * Real force when the device reports it, otherwise inferred from speed:
   * pressing harder and slowing down are the same gesture, so a mouse that
   * slows into a curve thickens there the way a stylus would.
   */
  resolvePressure(s) {
    if (s.pressure != null) return clamp(this.pressure, 0.02, 1);
    const v = clamp(this.speed / REF_SPEED, 0, 1);
    return clamp(0.82 - 0.42 * v, 0.18, 1);
  }
}

// --- Render time -----------------------------------------------------------

/**
 * Knot spacing for centripetal parameterisation, floored so the duplicated
 * control points at an open stroke's ends cannot collapse a knot interval and
 * divide by zero.
 */
function knot(a, b, prev) {
  return prev + Math.max(1e-4, Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)));
}

/** Centripetal Catmull-Rom. alpha=0.5 is what keeps corners from overshooting. */
function crSegment(p0, p1, p2, p3, t, out) {
  const t0 = 0;
  const t1 = knot(p0, p1, t0);
  const t2 = knot(p1, p2, t1);
  const t3 = knot(p2, p3, t2);
  const tt = t1 + (t2 - t1) * t;

  const a1 = lerpPt(p0, p1, (tt - t0) / (t1 - t0));
  const a2 = lerpPt(p1, p2, (tt - t1) / (t2 - t1));
  const a3 = lerpPt(p2, p3, (tt - t2) / (t3 - t2));
  const b1 = lerpPt(a1, a2, (tt - t0) / (t2 - t0));
  const b2 = lerpPt(a2, a3, (tt - t1) / (t3 - t1));
  out.x = b1.x + (b2.x - b1.x) * ((tt - t1) / (t2 - t1));
  out.y = b1.y + (b2.y - b1.y) * ((tt - t1) / (t2 - t1));
  return out;
}

function lerpPt(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * Stored points -> dense polyline through a Catmull-Rom spline.
 *
 * Interpolating rather than connecting the stored points is what removes the
 * faceting you get from a plain polyline at sparse input rates, without the
 * corner-rounding that heavier smoothing would cost.
 */
function densify(pts, closed) {
  if (pts.length < 3) return pts.slice();
  const at = (i) => {
    if (closed) return pts[(i + pts.length) % pts.length];
    return pts[clamp(i, 0, pts.length - 1)];
  };
  const dense = [pts[0]];
  const scratch = { x: 0, y: 0 };
  const last = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < last; i++) {
    const p1 = at(i);
    const p2 = at(i + 1);
    const chord = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const steps = clamp(Math.ceil(chord / DENSIFY_STEP), 1, 24);
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      crSegment(at(i - 1), p1, p2, at(i + 2), t, scratch);
      dense.push({
        x: scratch.x,
        y: scratch.y,
        p: p1.p + (p2.p - p1.p) * t,
        v: p1.v + (p2.v - p1.v) * t,
      });
    }
  }
  return dense;
}

/**
 * Build renderable nodes from stored points.
 *
 * @param pts    points in canvas px, each { x, y, p, v }
 * @param preset brush preset
 * @param opts   { baseWidth, closed, exact }  baseWidth in canvas px.
 *               `exact` marks geometry that is already the final outline --
 *               a snapped or recognised primitive -- rather than sampled
 *               input, so it is walked straight instead of splined.
 * @returns { nodes, length } nodes carry x, y, dir, width, alpha, p, v, s
 */
export function buildNodes(pts, preset, { baseWidth, closed = false, exact = false }) {
  const clean = dedupe(pts);
  if (clean.length === 0) return { nodes: [], length: 0 };
  if (clean.length === 1) {
    const p = clean[0];
    return {
      nodes: [node(p.x, p.y, 0, dynWidth(p, preset, baseWidth) * preset.taper.minScale,
                    dynAlpha(p, preset), p.p, p.v, 0)],
      length: 0,
    };
  }

  // A rectangle's sides are straight because it is a rectangle. Splining it
  // would round the corners it was just recognised for, and the curve bows
  // outside the corner bounds the caller sized its mask from, which clips the
  // sides away entirely. Sampled input is the only thing that wants a spline.
  // Walking the ring straight still needs the closing edge spelled out, which
  // densify() would otherwise have added by wrapping.
  const dense = exact
    ? (closed ? clean.concat([clean[0]]) : clean)
    : densify(clean, closed);
  const nodes = [];
  let carry = 0;
  let travelled = 0;

  // Even spacing in arc length is the whole reason strokes do not blotch when
  // the hand slows: stamp density stops depending on how fast you drew.
  emit(dense[0], 0, dense[1], dense[0]);
  carry = stepFor(dense[0]);
  for (let i = 1; i < dense.length; i++) {
    const a = dense[i - 1];
    const b = dense[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg <= 1e-6) continue;
    let pos = carry;
    while (pos < seg) {
      const t = pos / seg;
      const here = {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        p: a.p + (b.p - a.p) * t,
        v: a.v + (b.v - a.v) * t,
      };
      emit(here, travelled + pos, b, a);
      pos += stepFor(here);
    }
    carry = pos - seg;
    travelled += seg;
  }
  // An open stroke needs its exact endpoint; a closed one already has it as
  // node 0 and would seam if we emitted it twice.
  if (!closed) {
    const tail = dense[dense.length - 1];
    emit(tail, travelled, tail, dense[dense.length - 2]);
  }

  function stepFor(p) {
    const w = dynWidth(p, preset, baseWidth);
    // Filled tips only need enough nodes to keep the outline smooth; stamped
    // tips need the preset's spacing or the trail breaks up. The floor stops
    // a thin brush from asking for several stamps per pixel.
    const frac = preset.tip === "round" ? preset.spacing : 0.25;
    return Math.max(MIN_STEP, w * frac);
  }

  function emit(p, s, ahead, behind) {
    const dx = ahead.x - behind.x;
    const dy = ahead.y - behind.y;
    const dir = dx === 0 && dy === 0 ? 0 : Math.atan2(dy, dx);
    const n = node(p.x, p.y, dir, dynWidth(p, preset, baseWidth),
                   dynAlpha(p, preset), p.p, p.v, s);
    // The renderer corrects per-stamp alpha for overlap, so it needs the step
    // actually taken here — not the preset's nominal spacing, which the floor
    // above may have overridden.
    n.step = stepFor(p);
    nodes.push(n);
  }

  applyCurvature(nodes, preset);
  if (!closed) applyTaper(nodes, travelled, preset);
  return { nodes, length: travelled };
}

function node(x, y, dir, width, alpha, p, v, s) {
  return { x, y, dir, width, alpha, p, v, s, curve: 0, step: MIN_STEP };
}

function dedupe(pts) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-4 && Math.abs(last.y - p.y) < 1e-4) continue;
    out.push({ x: p.x, y: p.y, p: p.p ?? 0.65, v: p.v ?? 0.25 });
  }
  return out;
}

function dynWidth(p, preset, baseWidth) {
  const w = baseWidth * response(p.p, preset.width) * (1 + preset.vel.width * p.v);
  return Math.max(0.35, w);
}

function dynAlpha(p, preset) {
  const a = response(p.p, preset.alpha) * (1 + preset.vel.alpha * p.v);
  return clamp(a, 0, 1);
}

/**
 * Turn rate per node, used by the nib to swell through direction changes the
 * way a real nib does when the hand rotates it against the paper.
 */
function applyCurvature(nodes, preset) {
  if (!preset.nib || nodes.length < 3) return;
  for (let i = 1; i < nodes.length - 1; i++) {
    let d = nodes[i + 1].dir - nodes[i - 1].dir;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    nodes[i].curve = Math.min(1, Math.abs(d) / (Math.PI / 3));
  }
}

/**
 * Entry and exit ramps. Ramp lengths are quoted in tip diameters so a 40px
 * brush tapers over a proportionally longer run than a 2px one; when the
 * whole stroke is shorter than the two ramps they share it instead of
 * fighting, which is what keeps a flick from turning into a blob.
 */
function applyTaper(nodes, length, preset) {
  if (nodes.length < 2 || length <= 0) return;
  const t = preset.taper;
  let lin = t.in * nodes[0].width * 2;
  let lout = t.out * nodes[nodes.length - 1].width * 2;
  const total = lin + lout;
  if (total > length) {
    const k = length / total;
    lin *= k;
    lout *= k;
  }
  for (const n of nodes) {
    const fromEnd = length - n.s;
    let scale = 1;
    if (lin > 0 && n.s < lin) {
      scale = Math.min(scale, t.minScale + (1 - t.minScale) * smoothstep(n.s / lin));
    }
    if (lout > 0 && fromEnd < lout) {
      scale = Math.min(scale, t.minScale + (1 - t.minScale) * smoothstep(fromEnd / lout));
    }
    if (scale >= 1) continue;
    n.width *= scale;
    // Alpha follows the taper but only half as far: ink thins at the ends,
    // it does not disappear.
    n.alpha *= 0.5 + 0.5 * scale;
  }
}
