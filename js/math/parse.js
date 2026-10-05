// math/parse.js
// Normalize OCR / latex-ish strings into evaluable ASCII.

const MUL_CHARS = /[×·⋅✕✖]/g;
const DIV_CHARS = /[÷]/g;
const MINUS_CHARS = /[−–—]/g;
const POW_CHARS = /[¹²³]/g;

/** Strip OCR / LaTeX noise and normalize operators. */
export function normalizeAscii(raw) {
  if (!raw) return "";
  let s = latexToInfix(String(raw))
    .replace(/\s+/g, "")
    .replace(MUL_CHARS, "*")
    .replace(DIV_CHARS, "/")
    .replace(MINUS_CHARS, "-")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/[“”"']/g, "")
    .replace(/,/g, "");

  // OCR often reads × as x between digits: 12x8 → 12*8
  s = s.replace(/(\d)\s*[xX]\s*(\d)/g, "$1*$2");
  // Implicit multiply: 2x → 2*x, 2( → 2*(
  s = s.replace(/(\d)\s*([a-zA-Z(])/g, "$1*$2");
  s = s.replace(/\)\s*([a-zA-Z(\d])/g, ")*$1");
  // Squared: x2 at end of identifier often means x^2 in handwriting OCR
  s = s.replace(/([a-zA-Z])2(?![0-9a-zA-Z])/g, "$1^2");
  return s;
}

export function looksLikeEquation(ascii) {
  if (!ascii.includes("=")) return false;
  const [lhs, rhs] = ascii.split("=");
  // y = f(x) is a plot definition, not an equation to solve for y.
  if (/^[yY]$/.test(lhs || "") && /[xX]/.test(rhs || "")) return false;
  return /[a-zA-Z]/.test(ascii);
}

export function looksLikeFunction(ascii) {
  const [lhs, rhs] = ascii.split("=");
  if (/^[yY]$/.test(lhs || "") && /[xX]/.test(rhs || "")) return true;
  if (/^(sin|cos|tan|log|ln)\s*\(/i.test(ascii)) return true;
  if (/^sqrt\s*\(/i.test(ascii) && /[xX]/.test(ascii)) return true;
  if (!ascii.includes("=") && /[xX]/.test(ascii) && /[\^*/+\-]/.test(ascii)) return true;
  return false;
}

export function looksLikeArithmetic(ascii) {
  if (!ascii || looksLikeEquation(ascii)) return false;
  if (/[a-zA-Z]/.test(ascii.replace(/x/gi, ""))) return false;
  // pure numeric expression
  return /^[\d.+\-*/^()]+$/.test(ascii) && /[\d]/.test(ascii);
}

/** Pull a single unknown letter from an equation. */
export function primaryUnknown(ascii) {
  const m = ascii.match(/[a-zA-Z]/g);
  if (!m) return "x";
  const counts = {};
  for (const c of m) {
    const k = c.toLowerCase();
    if (k === "e") continue;
    counts[k] = (counts[k] || 0) + 1;
  }
  const keys = Object.keys(counts);
  if (!keys.length) return "x";
  keys.sort((a, b) => counts[b] - counts[a]);
  return keys[0];
}

/** Common Pix2Text LaTeX → infix the local evaluator understands. */
function latexToInfix(src) {
  let s = src
    .replace(/\$+/g, "")
    .replace(/\\left|\\right/g, "")
    .replace(/\\,/g, "")
    .replace(/\\times|\\cdot|\\ast/g, "*")
    .replace(/\\div/g, "/")
    .replace(/\\pm/g, "+")
    .replace(/[{}]/g, (ch) => ch); // braces handled below

  s = replaceBraced(s, "\\frac", (a, b) => `(${a})/(${b})`);
  s = replaceBraced(s, "\\sqrt", (a) => `sqrt(${a})`);
  s = replaceBraced(s, "\\mathrm", (a) => a);
  s = replaceBraced(s, "\\mathbf", (a) => a);
  s = replaceBraced(s, "\\mathit", (a) => a);
  s = replaceBraced(s, "\\text", (a) => a);
  s = s.replace(/\^\{([^{}]+)\}/g, "^($1)");
  s = s.replace(/_\{([^{}]+)\}/g, "");
  s = s.replace(/\\(sin|cos|tan|log|ln|sqrt)/g, "$1");
  s = s.replace(/\\[a-zA-Z]+/g, "");
  s = s.replace(/[{}]/g, "");
  return s;
}

/** Apply `cmd{a}` or `cmd{a}{b}` using balanced braces. */
function replaceBraced(src, cmd, build) {
  let s = src;
  let guard = 0;
  while (guard++ < 32) {
    const i = s.indexOf(cmd);
    if (i === -1) break;
    let pos = i + cmd.length;
    while (s[pos] === " ") pos++;
    const first = readBrace(s, pos);
    if (!first) break;
    if (build.length >= 2) {
      let pos2 = first.end;
      while (s[pos2] === " ") pos2++;
      const second = readBrace(s, pos2);
      if (!second) break;
      s = s.slice(0, i) + build(first.body, second.body) + s.slice(second.end);
    } else {
      s = s.slice(0, i) + build(first.body) + s.slice(first.end);
    }
  }
  return s;
}

function readBrace(s, i) {
  if (s[i] !== "{") return null;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === "{") depth++;
    else if (s[j] === "}") {
      depth--;
      if (depth === 0) return { body: s.slice(i + 1, j), end: j + 1 };
    }
  }
  return null;
}
