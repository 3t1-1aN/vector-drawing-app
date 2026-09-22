// brush/input.js
// Stage 1 of the brush pipeline: turn PointerEvents into raw samples.
//
// Two things matter here and nowhere else in the engine:
//
//  - Sub-frame resolution. The browser merges pointer moves it could not
//    deliver in time; getCoalescedEvents() hands those back, which is the
//    difference between a corner sampled at 60Hz and one sampled at 240Hz.
//
//  - Whether pressure is real. A mouse reports a flat 0.5 while held and a
//    pen that is barely touching also passes through 0.5, so the value on
//    its own tells us nothing. We decide from pointerType and let the
//    physics stage synthesise pressure when there is none to read.

/** Raw sample in screen coordinates. `pressure` is null when unavailable. */
function sample(event) {
  return {
    x: event.clientX,
    y: event.clientY,
    t: event.timeStamp,
    pressure: hasRealPressure(event) ? clamp01(event.pressure) : null,
  };
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * True when the device actually measures force. Mice report a constant
 * 0.5 and trackpads report 0 or 1, neither of which is a force reading.
 */
function hasRealPressure(event) {
  if (event.pointerType === "pen") return true;
  // Touch reports contact area as pressure on most platforms. It is coarse
  // but real, and better than the velocity fallback.
  if (event.pointerType === "touch") return event.pressure > 0 && event.pressure !== 0.5;
  return false;
}

/**
 * Every sample behind one pointer event, oldest first.
 *
 * Coalesced events carry their own coordinates and pressures but the list
 * excludes the dispatched event itself on some engines and includes it on
 * others, so we key off the last entry's timestamp rather than trusting
 * either behaviour.
 */
export function samplesFrom(event) {
  if (typeof event.getCoalescedEvents !== "function") return [sample(event)];
  let merged;
  try {
    merged = event.getCoalescedEvents();
  } catch {
    return [sample(event)];
  }
  if (!merged || merged.length === 0) return [sample(event)];
  const out = merged.map(sample);
  if (out[out.length - 1].t < event.timeStamp) out.push(sample(event));
  return out;
}
