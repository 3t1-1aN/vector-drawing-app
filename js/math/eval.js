// math/eval.js
// Local math understanding — no CDN. Arithmetic + simple linear equations.
// Graph intent is detected; widgets stay opt-in.

import {
  normalizeAscii,
  looksLikeArithmetic,
  looksLikeEquation,
  looksLikeFunction,
  primaryUnknown,
} from "./parse.js";

/**
 * @param {string} raw
 * @returns {Promise<{kind:string, ascii:string, mathObject:object, overlay:object}|null>}
 */
export async function understand(raw) {
  const ascii = normalizeAscii(raw);
  if (!ascii || ascii.length < 1) return null;

  try {
    if (looksLikeEquation(ascii)) {
      const solved = solveLinearEquation(ascii);
      if (solved) return solved;
    }
    if (looksLikeFunction(ascii) || isPlottable(ascii)) {
      const expr = functionExpr(ascii);
      if (!expr || !isSafeExpr(expr)) return null;
      return {
        kind: "function",
        ascii,
        mathObject: { kind: "function1d", of: "x", latex: ascii, expr },
        overlay: { primary: null, actions: ["graph"], placement: "below-right" },
      };
    }
    if (looksLikeArithmetic(ascii) || canEvaluate(ascii)) {
      const value = evaluateArithmetic(ascii);
      if (value == null) return null;
      return arithmeticResult(ascii, value);
    }
    const value = evalNumeric(ascii);
    if (value != null && !hasFreeVariable(ascii)) {
      return arithmeticResult(ascii, value);
    }
  } catch {
    return null;
  }
  return null;
}

function arithmeticResult(ascii, value) {
  return {
    kind: "arithmetic",
    ascii,
    mathObject: { kind: "arithmetic", expr: ascii, value },
    overlay: {
      primary: formatResult(value),
      actions: [],
      placement: "below-right",
    },
  };
}

function hasFreeVariable(ascii) {
  const stripped = ascii.replace(/\b(sin|cos|tan|log|ln|sqrt)\b/gi, "");
  return /[a-zA-Z]/.test(stripped);
}

function isPlottable(ascii) {
  const e = functionExpr(ascii);
  return e && /x/i.test(e) && !looksLikeEquation(ascii);
}

function functionExpr(ascii) {
  return ascii.replace(/^y=/i, "").replace(/^=/, "") || null;
}

function canEvaluate(ascii) {
  return /^[\d.+\-*/^()xX]+$/.test(ascii);
}

/** Only digits, operators, x, and known function names. */
function isSafeExpr(expr) {
  const s = expr.replace(/\s+/g, "");
  if (!s) return false;
  if (/[^0-9a-zA-Z+\-*/^().,_]/.test(s)) return false;
  // Disallow statements / access
  if (/[;=`]|import|Function|eval|window|document|globalThis/i.test(s)) return false;
  return true;
}

function evaluateArithmetic(ascii) {
  // Bare x between digits already normalized to *; remaining x → *
  const expr = ascii.replace(/x/gi, "*").replace(/\*{2,}/g, "*");
  if (!/^[\d.+\-*/^()]+$/.test(expr)) return null;
  return evalNumeric(expr);
}

function solveLinearEquation(ascii) {
  const parts = ascii.split("=");
  if (parts.length !== 2) return null;
  const [lhs, rhs] = parts;
  if (!lhs || !rhs) return null;
  const unk = primaryUnknown(ascii);
  const diff = `(${lhs})-(${rhs})`;
  if (!isSafeExpr(diff.replace(new RegExp(unk, "gi"), "x"))) return null;

  const f0 = evalWithX(diff, unk, 0);
  const f1 = evalWithX(diff, unk, 1);
  if (f0 == null || f1 == null) return null;
  const slope = f1 - f0;
  if (Math.abs(slope) < 1e-12) {
    if (Math.abs(f0) < 1e-9) {
      return {
        kind: "equation",
        ascii,
        mathObject: { kind: "equation", unknowns: [unk], solutions: ["all real"] },
        overlay: { primary: "identity", actions: [], placement: "below-right" },
      };
    }
    return null;
  }
  const sol = -f0 / slope;
  if (!Number.isFinite(sol)) return null;
  return {
    kind: "equation",
    ascii,
    mathObject: { kind: "equation", unknowns: [unk], solutions: [sol] },
    overlay: {
      primary: `${unk} = ${formatResult(sol)}`,
      actions: [],
      placement: "below-right",
    },
  };
}

function evalWithX(expr, unk, value) {
  // Rewrite unknown to x, then evaluate with scope.
  const re = new RegExp(unk, "gi");
  let e = expr.replace(re, "x");
  // Implicit multiply already in normalize; ^ → **
  e = toJsExpr(e);
  if (!isSafeExpr(e.replace(/\*\*/g, "^"))) return null;
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function("x", `with(Math){return (${e});}`);
    const v = fn(value);
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

function evalNumeric(expr) {
  const e = toJsExpr(expr);
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(`with(Math){return (${e});}`);
    const v = fn();
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

function toJsExpr(expr) {
  // ^ power → ** ; map common math names already on Math
  return expr
    .replace(/\^/g, "**")
    .replace(/\blog\(/gi, "log10(")
    .replace(/\bln\(/gi, "log(");
}

export function formatResult(v) {
  if (typeof v !== "number") return String(v);
  if (Number.isInteger(v)) return String(v);
  const r = Math.round(v * 1e8) / 1e8;
  return String(r);
}

export async function sampleFunction(expr, x0, x1, n = 80) {
  if (!isSafeExpr(expr)) return [];
  const e = toJsExpr(expr);
  let fn;
  try {
    // eslint-disable-next-line no-new-func
    fn = new Function("x", `with(Math){return (${e});}`);
  } catch {
    return [];
  }
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + (x1 - x0) * (i / n);
    try {
      const y = fn(x);
      if (typeof y === "number" && Number.isFinite(y)) pts.push({ x, y });
    } catch {
      /* skip */
    }
  }
  return pts;
}
