// ui/color-picker.js
// Color flyout for the style wheel: HSL disk + lightness slider, RGB
// sliders + hex field, and a marker-style curated palette. The caller
// receives onChange(hex, phase) where phase is "preview" while dragging
// and "commit" on release / discrete picks, so it can batch undo steps.

// --- Color conversions ---------------------------------------------------

export function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(r, g, b) {
  const to = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return { r: f(h + 1 / 3) * 255, g: f(h) * 255, b: f(h - 1 / 3) * 255 };
}

export function hslToHex(h, s, l) {
  const { r, g, b } = hslToRgb(h, s / 100, l / 100);
  return rgbToHex(r, g, b);
}

/** Parse "#hex" or legacy "rgba(r, g, b, a)" strings to {r,g,b}. */
export function parseColor(str) {
  if (!str) return { r: 43, g: 43, b: 48 };
  if (str.startsWith("#")) return hexToRgb(str);
  const m = str.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3] };
  return { r: 43, g: 43, b: 48 };
}

// --- Marker palette (COPIC-inspired hue families, no branding) -----------

const MARKER_COLORS = (() => {
  const out = [];
  const hues = [4, 28, 48, 95, 150, 195, 225, 262, 305, 340];
  for (const h of hues) {
    for (const [s, l] of [[85, 38], [80, 55], [70, 72], [45, 86]]) {
      out.push(hslToHex(h, s, l));
    }
  }
  for (const l of [8, 22, 36, 50, 64, 78, 90, 98]) {
    out.push(hslToHex(220, 6, l));
  }
  return out;
})();

// --- Widget ---------------------------------------------------------------

const DISK_SIZE = 168;

let root = null;
let diskCanvas = null;
let diskCtx = null;
let lightnessInput = null;
let rgbInputs = null;
let hexInput = null;
let onChangeCb = null;

const state = { h: 220, s: 0.05, l: 0.18 };
let renderedDiskL = -1;

function currentHex() {
  const { r, g, b } = hslToRgb(state.h, state.s, state.l);
  return rgbToHex(r, g, b);
}

function emit(phase) {
  if (onChangeCb) onChangeCb(currentHex(), phase);
}

function buildDom() {
  root = document.createElement("div");
  root.id = "colorPicker";
  root.classList.add("hidden");
  root.innerHTML = `
    <div class="cp-tabs">
      <button data-tab="hsl" class="active">HSL</button>
      <button data-tab="rgb">RGB</button>
      <button data-tab="markers">Markers</button>
    </div>
    <div class="cp-pane" data-pane="hsl">
      <canvas class="cp-disk" width="${DISK_SIZE}" height="${DISK_SIZE}"></canvas>
      <label class="cp-slider-row">L
        <input type="range" class="cp-lightness" min="0" max="100" value="18" />
      </label>
    </div>
    <div class="cp-pane hidden" data-pane="rgb">
      <label class="cp-slider-row">R <input type="range" data-ch="r" min="0" max="255" /></label>
      <label class="cp-slider-row">G <input type="range" data-ch="g" min="0" max="255" /></label>
      <label class="cp-slider-row">B <input type="range" data-ch="b" min="0" max="255" /></label>
      <label class="cp-hex-row">Hex <input type="text" class="cp-hex" maxlength="7" spellcheck="false" /></label>
    </div>
    <div class="cp-pane hidden cp-markers" data-pane="markers"></div>
  `;
  document.body.appendChild(root);

  // Tabs
  for (const btn of root.querySelectorAll(".cp-tabs button")) {
    btn.addEventListener("click", () => {
      for (const b of root.querySelectorAll(".cp-tabs button")) {
        b.classList.toggle("active", b === btn);
      }
      for (const pane of root.querySelectorAll(".cp-pane")) {
        pane.classList.toggle("hidden", pane.dataset.pane !== btn.dataset.tab);
      }
    });
  }

  // HSL disk
  diskCanvas = root.querySelector(".cp-disk");
  diskCtx = diskCanvas.getContext("2d");
  lightnessInput = root.querySelector(".cp-lightness");
  let diskDragging = false;
  diskCanvas.addEventListener("mousedown", (e) => {
    diskDragging = true;
    pickFromDisk(e);
    e.preventDefault();
    e.stopPropagation();
  });
  window.addEventListener("mousemove", (e) => {
    if (diskDragging) pickFromDisk(e);
  });
  window.addEventListener("mouseup", () => {
    if (diskDragging) {
      diskDragging = false;
      emit("commit");
    }
  });
  lightnessInput.addEventListener("input", () => {
    state.l = lightnessInput.value / 100;
    syncUi();
    emit("preview");
  });
  lightnessInput.addEventListener("change", () => emit("commit"));

  // RGB sliders + hex
  rgbInputs = {
    r: root.querySelector('[data-ch="r"]'),
    g: root.querySelector('[data-ch="g"]'),
    b: root.querySelector('[data-ch="b"]'),
  };
  for (const input of Object.values(rgbInputs)) {
    input.addEventListener("input", () => {
      setFromRgb(+rgbInputs.r.value, +rgbInputs.g.value, +rgbInputs.b.value);
      emit("preview");
    });
    input.addEventListener("change", () => emit("commit"));
  }
  hexInput = root.querySelector(".cp-hex");
  hexInput.addEventListener("change", () => {
    const v = hexInput.value.trim();
    if (/^#?[0-9a-fA-F]{6}$/.test(v) || /^#?[0-9a-fA-F]{3}$/.test(v)) {
      const { r, g, b } = hexToRgb(v.startsWith("#") ? v : `#${v}`);
      setFromRgb(r, g, b);
      emit("commit");
    } else {
      syncUi();
    }
  });

  // Marker palette
  const markers = root.querySelector(".cp-markers");
  for (const hex of MARKER_COLORS) {
    const sw = document.createElement("button");
    sw.className = "cp-swatch";
    sw.style.background = hex;
    sw.title = hex;
    sw.addEventListener("click", () => {
      const { r, g, b } = hexToRgb(hex);
      setFromRgb(r, g, b);
      emit("commit");
    });
    markers.appendChild(sw);
  }

  // Don't let clicks inside the picker bubble to document (which closes it).
  root.addEventListener("mousedown", (e) => e.stopPropagation());
}

function setFromRgb(r, g, b) {
  const hsl = rgbToHsl(r, g, b);
  state.h = hsl.h;
  state.s = hsl.s;
  state.l = hsl.l;
  syncUi();
}

function pickFromDisk(e) {
  const rect = diskCanvas.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const dx = e.clientX - rect.left - cx;
  const dy = e.clientY - rect.top - cy;
  const radius = rect.width / 2;
  state.h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
  state.s = Math.min(1, Math.hypot(dx, dy) / radius);
  syncUi();
  emit("preview");
}

// Offscreen hue/saturation disk, cached per lightness so slider drags
// only recompute pixels when lightness actually changes.
const diskCache = document.createElement("canvas");
diskCache.width = DISK_SIZE;
diskCache.height = DISK_SIZE;

function renderDiskCache() {
  const l = state.l;
  if (Math.abs(l - renderedDiskL) < 0.005) return;
  renderedDiskL = l;
  const size = DISK_SIZE;
  const cctx = diskCache.getContext("2d");
  const img = cctx.createImageData(size, size);
  const d = img.data;
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - c;
      const dy = y - c;
      const dist = Math.hypot(dx, dy);
      const i = (y * size + x) * 4;
      if (dist > c) { d[i + 3] = 0; continue; }
      const h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
      const s = Math.min(1, dist / c);
      const rgb = hslToRgb(h, s, l);
      d[i] = rgb.r;
      d[i + 1] = rgb.g;
      d[i + 2] = rgb.b;
      d[i + 3] = 255;
    }
  }
  cctx.putImageData(img, 0, 0);
}

/** Sync all inputs + disk cursor from state. */
function syncUi() {
  renderDiskCache();
  diskCtx.clearRect(0, 0, DISK_SIZE, DISK_SIZE);
  diskCtx.drawImage(diskCache, 0, 0);
  const c = DISK_SIZE / 2;
  const ang = (state.h * Math.PI) / 180;
  const px = c + Math.cos(ang) * state.s * c;
  const py = c + Math.sin(ang) * state.s * c;
  diskCtx.beginPath();
  diskCtx.arc(px, py, 5, 0, Math.PI * 2);
  diskCtx.strokeStyle = state.l > 0.5 ? "#000" : "#fff";
  diskCtx.lineWidth = 2;
  diskCtx.stroke();

  lightnessInput.value = Math.round(state.l * 100);
  const { r, g, b } = hslToRgb(state.h, state.s, state.l);
  rgbInputs.r.value = Math.round(r);
  rgbInputs.g.value = Math.round(g);
  rgbInputs.b.value = Math.round(b);
  hexInput.value = rgbToHex(r, g, b);
}

// --- Public API -----------------------------------------------------------

export function initColorPicker(onChange) {
  onChangeCb = onChange;
  if (!root) buildDom();
}

export function openColorPicker(anchorRect, color) {
  const { r, g, b } = parseColor(color);
  setFromRgb(r, g, b);
  root.classList.remove("hidden");
  // Place to the right of the anchor, clamped to the viewport.
  const rect = root.getBoundingClientRect();
  let left = anchorRect.right + 14;
  let top = anchorRect.top + anchorRect.height / 2 - rect.height / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - rect.width - 8));
  top = Math.max(8, Math.min(top, window.innerHeight - rect.height - 8));
  root.style.left = `${left}px`;
  root.style.top = `${top}px`;
}

export function closeColorPicker() {
  if (root) root.classList.add("hidden");
}

export function isColorPickerOpen() {
  return root ? !root.classList.contains("hidden") : false;
}
