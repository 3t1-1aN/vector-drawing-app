// ui/math-edit.js
// Quiet double-tap editor for a MathRegion. Ink stays; only the overlay changes.

import { regionAtScreen, applyUserExpression } from "../math/pipeline.js";
import { mathAssist } from "../math/settings.js";
import { placeFloatDialog, screenAvoid } from "./float-dialog.js";

let dialog = null;
let input = null;
let regionId = null;

function ensureDom() {
  if (dialog) return;
  dialog = document.getElementById("mathEditDialog");
  input = document.getElementById("mathEditInput");
  const form = document.getElementById("mathEditForm");
  const cancel = document.getElementById("mathEditCancel");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void submit();
  });
  cancel.addEventListener("click", () => closeMathEdit());
  input.addEventListener("input", () => clearMathError());
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeMathEdit();
    }
  });
}

export function isMathEditOpen() {
  return dialog && !dialog.classList.contains("hidden");
}

export function closeMathEdit() {
  if (!dialog) return;
  dialog.classList.add("hidden");
  regionId = null;
}

/**
 * Open the expression editor if a math region is under the cursor.
 * @returns {boolean}
 */
export function openMathEditAt(sx, sy) {
  if (!mathAssist.enabled) return false;
  const region = regionAtScreen(sx, sy);
  if (!region) return false;
  ensureDom();
  regionId = region.id;
  input.value = region.ascii || region.latex || "";
  clearMathError();
  placeFloatDialog(dialog, sx, sy, screenAvoid(region.bounds));
  input.focus();
  input.select();
  return true;
}

function clearMathError() {
  const note = document.getElementById("mathEditError");
  if (note) note.hidden = true;
  if (input) input.removeAttribute("aria-invalid");
}

async function submit() {
  if (!regionId) return;
  const raw = input.value.trim();
  if (!raw) {
    input.setAttribute("aria-invalid", "true");
    const note = document.getElementById("mathEditError");
    note.hidden = false;
    note.textContent = "Type an expression first.";
    return;
  }
  const ok = await applyUserExpression(regionId, raw);
  if (!ok) {
    input.setAttribute("aria-invalid", "true");
    const note = document.getElementById("mathEditError");
    note.hidden = false;
    note.textContent = "Couldn't read that. Try something like 2*x+5=15.";
    return;
  }
  closeMathEdit();
}
