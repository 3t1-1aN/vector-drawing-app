// render/type-text.js
// A note set the way the paper test sheet sets typewriter text.
//
// Special Elite, a little tracking, the #typeink ribbon filter, and a
// per-strike wobble. The wobble is the sheet's typeset(): same hash, same
// order of rolls, typeMess 0.5 and typeInk 0.6. The seed is stored on the
// element so a note does not reshuffle every frame.

import { isDarkBackground } from "../workspace/appearance.js";
import { TYPE_COLOR, TYPE_FAMILY } from "./text-style.js";

export const TYPE_SIZE = 17;
const MESS = 0.5;
const TYPE_INK = 0.6;
const LINE = 1.6;
const TRACK = 0.02;

let measureCtx = null;
let scratch = null;

function contextForMeasure() {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  return measureCtx;
}

/** One sheet reused for every note. drawImage copies the pixels before the next note. */
function scratchInk(w, h) {
  if (!scratch) scratch = document.createElement("canvas");
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  }
  const ink = scratch.getContext("2d");
  ink.setTransform(1, 0, 0, 1, 0, 0);
  ink.globalAlpha = 1;
  ink.filter = "none";
  ink.globalCompositeOperation = "source-over";
  ink.clearRect(0, 0, w, h);
  return ink;
}

/** The sheet's per-strike generator. `seed` is an integer. */
function strikeRng(seed) {
  let a = seed | 0;
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fontOf(size) {
  return `${size}px ${TYPE_FAMILY}`;
}

function tokenWidth(ctx, text, track) {
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + track;
  return w;
}

/**
 * Break a note into rows. Explicit newlines stay. A max width wraps on
 * spaces, then on letters when a single word is wider than the box.
 */
function wrapRows(ctx, text, maxWidth, track) {
  const rows = [];
  const spaceW = ctx.measureText(" ").width + track;
  for (const para of String(text || "").split("\n")) {
    if (!maxWidth || para === "") {
      rows.push(para);
      continue;
    }
    let line = "";
    let width = 0;
    for (const word of para.split(" ")) {
      const wordW = tokenWidth(ctx, word, track);
      const gap = line ? spaceW : 0;
      if (line && width + gap + wordW > maxWidth) {
        rows.push(line);
        line = "";
        width = 0;
      }
      if (!line && wordW > maxWidth) {
        let chunk = "";
        let chunkW = 0;
        for (const ch of word) {
          const cw = ctx.measureText(ch).width + track;
          if (chunk && chunkW + cw > maxWidth) {
            rows.push(chunk);
            chunk = "";
            chunkW = 0;
          }
          chunk += ch;
          chunkW += cw;
        }
        line = chunk;
        width = chunkW;
        continue;
      }
      line = line ? `${line} ${word}` : word;
      width += gap + wordW;
    }
    rows.push(line);
  }
  return rows.length ? rows : [""];
}

/** Rows a note will set, for export. */
export function wrappedRows(el, maxWidth) {
  const ctx = contextForMeasure();
  const size = el.size || TYPE_SIZE;
  ctx.font = fontOf(size);
  return wrapRows(ctx, el.text, maxWidth || 0, size * TRACK);
}

/**
 * Lay out one note in local space. Each letter takes the sheet's rolls in
 * the sheet's order, then steps by its width plus 0.02em.
 * `maxWidth` wraps and, with `align: "center"`, centers each row in that width.
 */
function layout(ctx, el, { maxWidth = 0, align = "left" } = {}) {
  const size = el.size || TYPE_SIZE;
  ctx.font = fontOf(size);
  const track = size * TRACK;
  const lineH = size * LINE;
  const rand = strikeRng(el.seed || 1);
  const lines = wrapRows(ctx, el.text, maxWidth, track);
  const strikes = [];
  let maxW = 0;
  let cursorX = 0;
  let cursorY = 0;
  lines.forEach((line, li) => {
    let x = 0;
    const y = li * lineH;
    const lineStrikes = [];
    const words = line.split(" ");
    words.forEach((word, wi) => {
      if (wi) x += ctx.measureText(" ").width + track;
      for (const ch of word) {
        const dy0 = (rand() - 0.5) * 2.2 * MESS;
        const slip = rand() < 0.04;
        const dy = dy0 + (slip ? (rand() - 0.5) * 5 * MESS : 0);
        const dx = (rand() - 0.5) * 0.8 * MESS;
        const rot = ((rand() - 0.5) * 3 * MESS * Math.PI) / 180;
        const opacity = 1 - rand() * (0.15 + 0.35 * TYPE_INK);
        lineStrikes.push({ ch, x, y, dx, dy, rot, opacity });
        x += ctx.measureText(ch).width + track;
      }
    });
    const shift = align === "center" ? ((maxWidth || x) - x) / 2 : 0;
    for (const s of lineStrikes) {
      s.x += shift;
      strikes.push(s);
    }
    const rowW = x + shift;
    if (rowW > maxW) maxW = rowW;
    cursorX = x + shift;
    cursorY = y;
  });
  const rows = Math.max(lines.length, 1);
  return {
    strikes,
    rows: lines,
    width: align === "center" && maxWidth ? maxWidth : maxW,
    height: (rows - 1) * lineH + size,
    cursorX,
    cursorY,
    size,
    lineH,
  };
}

/** World bounds of a note, with a little room for the strike wobble. */
export function textBounds(el) {
  const box = layout(contextForMeasure(), el);
  const pad = 4;
  const w = Math.max(box.width, box.size * 0.35);
  return {
    minX: el.x - pad,
    minY: el.y - pad,
    maxX: el.x + w + pad,
    maxY: el.y + box.height + pad,
  };
}

/**
 * Draw a typewriter note. The strikes are set on their own sheet first,
 * then the ribbon filter runs over the whole note. Filtering one letter at
 * a time scales the noise to that letter and eats it.
 *
 * The context is in world space. `size` is world units, CSS pixels at zoom 1.
 * `caret` blinks at the end while the note is still being typed.
 */
export function drawTypewritten(ctx, el, { caret = false, frame = null } = {}) {
  const dark = isDarkBackground();
  const color = dark ? "#e8e5dc" : (el.style?.stroke || TYPE_COLOR);
  const box = layout(
    contextForMeasure(),
    el,
    frame ? { maxWidth: frame.width, align: "center" } : {},
  );
  const pad = 10;
  const m = ctx.getTransform();
  const scale = Math.max(1, Math.hypot(m.a, m.b));
  const bw = Math.max(box.width, box.size * 0.4);
  const pixelW = Math.max(1, Math.ceil((bw + pad * 2) * scale));
  const pixelH = Math.max(1, Math.ceil((box.height + pad * 2) * scale));
  const ink = scratchInk(pixelW, pixelH);
  ink.scale(scale, scale);
  ink.translate(pad, pad);
  ink.font = fontOf(box.size);
  ink.textBaseline = "top";
  ink.textAlign = "left";
  const alpha = el.style?.opacity ?? 1;
  for (const s of box.strikes) {
    ink.save();
    ink.translate(s.x + s.dx, s.y + s.dy);
    ink.rotate(s.rot);
    ink.globalAlpha = alpha * s.opacity;
    if (!dark) {
      ink.fillStyle = "rgba(43, 41, 38, 0.35)";
      ink.fillText(s.ch, 0.35, 0.25);
    }
    ink.fillStyle = color;
    ink.fillText(s.ch, 0, 0);
    ink.restore();
  }

  ctx.save();
  if (frame) {
    ctx.translate(frame.cx, frame.cy);
    if (frame.angle) ctx.rotate(frame.angle);
    ctx.translate(-bw / 2 - pad, -box.height / 2 - pad);
  } else {
    ctx.translate(el.x - pad, el.y - pad);
  }
  if (!dark) {
    ctx.filter = "url(#typeink)";
    ctx.globalCompositeOperation = "multiply";
  }
  ctx.drawImage(scratch, 0, 0, bw + pad * 2, box.height + pad * 2);
  if (caret && Math.floor(performance.now() / 530) % 2 === 0) {
    ctx.filter = "none";
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = color;
    ctx.fillRect(
      pad + box.cursorX + 1,
      pad + box.cursorY + box.size * 0.15,
      Math.max(1, box.size * 0.06),
      box.size * 0.8,
    );
  }
  ctx.restore();
}
