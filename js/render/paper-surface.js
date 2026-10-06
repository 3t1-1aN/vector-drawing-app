// render/paper-surface.js
// A continuous sheet of paper, evaluated in world coordinates.
//
// The grain is the locked test-sheet shader. Fibre and grain are sampled in
// world space, so panning keeps them on the page and zooming looks closer.
// Light and the edge falloff stay on the viewport.

export const paperDefaults = {
  paperColor: "#F4F0E6",
  grainIntensity: 0.08,
  grainScale: 1,
  fiberIntensity: 0.4,
  fiberScale: 0.8,
  imperfectionIntensity: 0.5,
  stains: 0.12,
  variation: 0.4,
  warmth: 0.28,
  edgeVariation: 0.3,
  lightingIntensity: 0.35,
  inkInteraction: 0.35,
  inkBleed: 0.5,
};

const TOOTH_PX = 1024;

const VERT = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAG = `
precision highp float;

uniform vec2 uRes;
uniform vec2 uSize;
uniform float uDpr;
uniform vec2 uPan;
uniform float uZoom;
uniform vec3 uColor;
uniform float uGrain;
uniform float uGrainS;
uniform float uFiber;
uniform float uFiberS;
uniform float uImp;
uniform float uStain;
uniform float uVar;
uniform float uWarm;
uniform float uEdge;
uniform float uLight;
uniform float uInk;
uniform float uBleed;
uniform float uMode;

float h12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
vec2 h22(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}
float vn(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1.0, 0.0)), u.x), mix(h12(i + vec2(0.0, 1.0)), h12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fibers(vec2 p, float cell, float prob, float extra, out float tone) {
  vec2 id = floor(p / cell);
  vec2 f = p / cell - id;
  float acc = 0.0;
  tone = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 c = id + o;
      if (h12(c + 19.1) > prob) continue;
      vec2 ctr = o + h22(c + 7.3);
      float ang = h12(c + 3.7) * 6.2832;
      float len = 0.25 + h12(c + 11.3) * 0.6;
      vec2 dir = vec2(cos(ang), sin(ang));
      vec2 d = f - ctr;
      float t = clamp(dot(d, dir), -len * 0.5, len * 0.5);
      float k = t / (len * 0.5);
      vec2 q = d - dir * t - vec2(-dir.y, dir.x) * (1.0 - k * k) * len * 0.4 * (h12(c + 5.5) - 0.5) * 2.0;
      float thPx = 0.25 + 0.4 * h12(c + 23.1);
      float dpx = length(q) * cell;
      float a = (1.0 - smoothstep(thPx * 0.5, thPx * 0.5 + 0.7 + extra, dpx)) * (0.25 + 0.75 * h12(c + 31.7)) * (1.0 - abs(k) * 0.8);
      if (a > acc) {
        acc = a;
        tone = h12(c + 41.3) < 0.3 ? 1.0 : -1.0;
      }
    }
  }
  return acc;
}
void main() {
  vec2 screen = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  vec2 w = (screen - uPan) / max(uZoom, 0.0001);
  vec3 col = uColor * (vec3(1.0) + uWarm * vec3(0.02, 0.006, -0.04));
  float low = vn(w / 420.0 + 3.1) * 0.6 + vn(w / 150.0 + 9.7) * 0.4 - 0.5;
  col += low * uVar * 0.06;
  float gs = uGrainS;
  float g = (vn(w / (1.3 * gs)) - 0.5) * 0.5 + (vn(w / (2.7 * gs) + 17.0) - 0.5) * 0.35 + (vn(w / (0.8 * gs) + 41.0) - 0.5) * 0.3;
  vec2 r = mat2(0.8, 0.6, -0.6, 0.8) * w;
  g += (vn(vec2(r.x * 0.3, r.y * 1.1) / gs + 5.0) - 0.5) * 0.35;
  g += (vn(w / 9.0 + 71.0) - 0.5) * 0.45 + (vn(w / 22.0 + 5.0) - 0.5) * 0.3;
  col += g * uGrain;
  float tone;
  float t2;
  float extra = uMode > 0.5 ? uBleed * 2.0 : 0.0;
  float fa = fibers(w, 22.0 * uFiberS, 0.3, extra, tone);
  float fb = fibers(w + 300.0, 64.0 * uFiberS, 0.09, extra, t2);
  col += (tone > 0.0 ? vec3(fa * 0.08) : -fa * vec3(0.2, 0.25, 0.34)) * uFiber;
  col += (t2 > 0.0 ? vec3(fb * 0.06) : -fb * vec3(0.16, 0.2, 0.27)) * uFiber;
  float speck = 0.0;
  float cs = 14.0;
  vec2 pid = floor(w / cs);
  if (h12(pid + 91.7) > 0.97) {
    vec2 pc = (pid + 0.2 + 0.6 * h22(pid + 13.1)) * cs;
    float rad = 0.3 + 0.3 * h12(pid + 5.9);
    speck = 1.0 - smoothstep(rad * 0.5, rad + 0.5, length(w - pc));
    col = mix(col, vec3(0.12), speck * uImp * 0.8);
  }
  vec2 fid = floor(w / 90.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = fid + vec2(float(i), float(j));
      if (h12(c + 201.3) > 0.06) continue;
      vec2 d = w - (c + 0.15 + 0.7 * h22(c + 17.7)) * 90.0;
      float ang = h12(c + 3.3) * 6.28;
      float ca = cos(ang);
      float sa = sin(ang);
      d = vec2(ca * d.x + sa * d.y, -sa * d.x + ca * d.y);
      d.y *= 1.0 + h12(c + 9.1);
      float R = (0.7 + 1.5 * h12(c + 5.9)) * (0.75 + 0.5 * vn(d * 1.3 + c));
      float a = 1.0 - smoothstep(R * 0.6, R + 0.5, length(d));
      float s = h12(c + 66.6);
      vec3 tc = s < 0.5 ? vec3(0.1) : s < 0.7 ? vec3(0.15, 0.4, 0.7) : s < 0.85 ? vec3(0.8, 0.4, 0.15) : vec3(0.45, 0.43, 0.33);
      col = mix(col, tc, a * uImp * 0.7);
    }
  }
  if (uMode > 0.5) {
    // Colour mode keeps grain faint on purpose. This mask is the ink the
    // sheet refuses. A pencil stays a flat grey unless that refusal is dense,
    // and a stretched octave turns the same mask into a screen, so the tooth
    // stays in round clumps a couple of pixels across.
    float gs = max(uGrainS, 0.001);
    float n = vn(w / (2.4 * gs) + 41.0) * 0.46;
    n += vn(w / (5.5 * gs) + 17.0) * 0.34;
    n += vn(w / (1.5 * gs) + 3.0) * 0.20;
    float skip = clamp((n - 0.36) * 2.6, 0.0, 1.0);
    float fiber = clamp(max(fa, fb), 0.0, 1.0);
    float absorb = clamp(skip * 0.82 + fiber * 0.45 + speck * 0.3, 0.0, 0.88);
    gl_FragColor = vec4(1.0, 1.0, 1.0, absorb);
    return;
  }
  float st = smoothstep(0.6, 0.82, vn(w / 60.0 + 23.0)) * smoothstep(0.5, 0.72, vn(w / 240.0 + 61.0));
  col += st * uStain * vec3(0.04, -0.015, -0.06);
  vec2 q = (screen - uSize * 0.5) / vec2(uSize.x, uSize.x * 1.6);
  float d2 = dot(q, q);
  col *= 1.0 + uLight * 0.1 * (0.3 - 1.1 * d2);
  float e = min(min(screen.x, uSize.x - screen.x), min(screen.y, uSize.y - screen.y));
  col *= 1.0 - uEdge * 0.03 * (1.0 - smoothstep(0.0, 40.0 + 30.0 * vn(w / 50.0), e));
  col += (h12(w * uZoom * uDpr + 0.5) - 0.5) / 255.0;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

function parseHex(hex) {
  const h = String(hex || "#F4F0E6").replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return [0.956, 0.941, 0.902];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function createRenderer(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const gl = canvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    antialias: false,
  });
  if (!gl) return null;

  function shader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn(gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  const vs = shader(gl.VERTEX_SHADER, VERT);
  const fs = shader(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn(gl.getProgramInfoLog(program));
    return null;
  }
  gl.useProgram(program);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 1, -1, -1, 1, 1, 1,
  ]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, "aPos");

  const uniforms = {};
  for (const name of [
    "uRes", "uSize", "uDpr", "uPan", "uZoom", "uColor",
    "uGrain", "uGrainS", "uFiber", "uFiberS", "uImp", "uStain", "uVar",
    "uWarm", "uEdge", "uLight", "uInk", "uBleed", "uMode",
  ]) {
    uniforms[name] = gl.getUniformLocation(program, name);
  }

  return { canvas, gl, program, uniforms, buf, loc };
}

let viewRenderer = null;
let bakeRenderer = null;
let toothCanvas = null;

function renderer(slot, w, h) {
  let current = slot === "view" ? viewRenderer : bakeRenderer;
  w = Math.max(1, Math.floor(w));
  h = Math.max(1, Math.floor(h));
  if (!current) {
    current = createRenderer(w, h);
    if (slot === "view") viewRenderer = current;
    else bakeRenderer = current;
    return current;
  }
  if (current.canvas.width !== w || current.canvas.height !== h) {
    current.canvas.width = w;
    current.canvas.height = h;
  }
  return current;
}

function paint(r, opts) {
  const gl = r.gl;
  const p = opts.params || paperDefaults;
  gl.bindBuffer(gl.ARRAY_BUFFER, r.buf);
  gl.enableVertexAttribArray(r.loc);
  gl.vertexAttribPointer(r.loc, 2, gl.FLOAT, false, 0, 0);
  const dpr = opts.dpr || 1;
  gl.viewport(0, 0, r.canvas.width, r.canvas.height);
  gl.useProgram(r.program);
  const u = r.uniforms;
  gl.uniform2f(u.uRes, r.canvas.width, r.canvas.height);
  gl.uniform2f(u.uSize, r.canvas.width / dpr, r.canvas.height / dpr);
  gl.uniform1f(u.uDpr, dpr);
  gl.uniform2f(u.uPan, opts.panX || 0, opts.panY || 0);
  gl.uniform1f(u.uZoom, opts.zoom || 1);
  const c = parseHex(p.paperColor);
  gl.uniform3f(u.uColor, c[0], c[1], c[2]);
  gl.uniform1f(u.uGrain, p.grainIntensity);
  gl.uniform1f(u.uGrainS, p.grainScale);
  gl.uniform1f(u.uFiber, p.fiberIntensity);
  gl.uniform1f(u.uFiberS, p.fiberScale);
  gl.uniform1f(u.uImp, p.imperfectionIntensity);
  gl.uniform1f(u.uStain, p.stains);
  gl.uniform1f(u.uVar, p.variation);
  gl.uniform1f(u.uWarm, p.warmth);
  gl.uniform1f(u.uEdge, p.edgeVariation);
  gl.uniform1f(u.uLight, p.lightingIntensity);
  gl.uniform1f(u.uInk, p.inkInteraction);
  gl.uniform1f(u.uBleed, p.inkBleed);
  gl.uniform1f(u.uMode, opts.mode || 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

/**
 * Draw the sheet into a 2D context. `destW`/`destH` are in the context's
 * current units. Returns false when WebGL is unavailable.
 */
export function paintPaper(ctx, opts) {
  const dpr = opts.bufferScale || 1;
  const bw = Math.max(1, Math.floor(opts.destW * dpr));
  const bh = Math.max(1, Math.floor(opts.destH * dpr));
  const r = renderer("view", bw, bh);
  if (!r) return false;
  paint(r, {
    params: opts.params,
    dpr,
    panX: opts.panX,
    panY: opts.panY,
    zoom: opts.zoom,
    mode: 0,
    split: opts.split,
  });
  ctx.drawImage(r.canvas, 0, 0, opts.destW, opts.destH);
  return true;
}

/** Bake a rectangle of the sheet into `target` (a 2D canvas). */
export function bakePaper(target, opts) {
  const r = renderer("bake", target.width, target.height);
  if (!r) return false;
  paint(r, {
    params: opts.params,
    dpr: opts.dpr || 1,
    panX: opts.panX || 0,
    panY: opts.panY || 0,
    zoom: opts.zoom || 1,
    mode: opts.mode || 0,
    split: false,
  });
  const ctx = target.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.drawImage(r.canvas, 0, 0);
  return true;
}

/**
 * Alpha mask of where the sheet refuses a little ink. One world pixel per
 * texel, cached. Strokes offset this so the tooth stays on the page.
 */
export function renderToothTile() {
  if (toothCanvas) return toothCanvas;
  const r = renderer("bake", TOOTH_PX, TOOTH_PX);
  if (!r) return null;
  paint(r, {
    params: paperDefaults,
    dpr: 1,
    panX: 0,
    panY: 0,
    zoom: 1,
    mode: 1,
  });
  // Read the buffer directly. drawImage from a WebGL canvas composites the
  // colour and can throw away the alpha this mask is made of.
  const gl = r.gl;
  const w = r.canvas.width;
  const h = r.canvas.height;
  const pixels = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  toothCanvas = document.createElement("canvas");
  toothCanvas.width = w;
  toothCanvas.height = h;
  const ctx = toothCanvas.getContext("2d");
  const img = ctx.createImageData(w, h);
  const row = w * 4;
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * row;
    img.data.set(pixels.subarray(src, src + row), y * row);
  }
  ctx.putImageData(img, 0, 0);
  return toothCanvas;
}

export const PAPER_TOOTH_PX = TOOTH_PX;

/** Same locked sheet for every preset. Only the base colour changes. */
export function paperParamsFor(hex) {
  return { ...paperDefaults, paperColor: hex || paperDefaults.paperColor };
}
