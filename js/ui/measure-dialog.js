// ui/measure-dialog.js
// Floating dialog for typing real-world measurements on double-clicked
// elements. Positions near the cursor; Enter applies, Escape cancels.

import { getEditableFields, applyMeasurements } from "../precision/measure-edit.js";
import { unitLabel } from "../precision/scale.js";
import { cloneElement } from "../scene/element.js";
import { TransformCommand } from "../scene/scene.js";

let dialog = null;
let fieldsEl = null;
let titleEl = null;
let onClose = null;

function ensureDom() {
  if (dialog) return;
  dialog = document.getElementById("measureDialog");
  fieldsEl = document.getElementById("measureFields");
  titleEl = document.getElementById("measureTitle");
  const form = document.getElementById("measureForm");
  const cancelBtn = document.getElementById("measureCancel");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    submit();
  });
  cancelBtn.addEventListener("click", () => closeMeasureDialog());
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); closeMeasureDialog(); }
  });
}

/**
 * Open the measurement editor for `el` at screen position (sx, sy).
 * `app` needs scene + history. Returns false if the element isn't editable.
 */
export function openMeasureDialog(app, el, sx, sy) {
  ensureDom();
  const fields = getEditableFields(el);
  if (!fields || fields.length === 0) return false;

  app.scene.select(el.id);
  titleEl.textContent = `Edit ${el.type}`;
  fieldsEl.innerHTML = "";
  const unit = unitLabel();

  for (const f of fields) {
    const row = document.createElement("div");
    row.className = "measure-row";
    const label = document.createElement("label");
    label.textContent = f.label;
    label.htmlFor = `mf_${f.key}`;
    const wrap = document.createElement("div");
    wrap.className = "measure-input-wrap";
    const input = document.createElement("input");
    input.type = "number";
    input.id = `mf_${f.key}`;
    input.name = f.key;
    input.step = "any";
    input.min = "0.0001";
    input.value = f.value.toFixed(2);
    const span = document.createElement("span");
    span.className = "measure-unit";
    span.textContent = unit;
    wrap.append(input, span);
    row.append(label, wrap);
    fieldsEl.appendChild(row);
  }

  // Position near cursor, clamped inside the viewport.
  dialog.classList.remove("hidden");
  const pad = 12;
  const rect = dialog.getBoundingClientRect();
  let left = sx + 12;
  let top = sy + 12;
  if (left + rect.width > window.innerWidth - pad) left = sx - rect.width - 12;
  if (top + rect.height > window.innerHeight - pad) top = sy - rect.height - 12;
  left = Math.max(pad, left);
  top = Math.max(pad, top);
  dialog.style.left = `${left}px`;
  dialog.style.top = `${top}px`;

  const firstInput = fieldsEl.querySelector("input");
  if (firstInput) {
    firstInput.focus();
    firstInput.select();
  }

  onClose = null;
  dialog._targetEl = el;
  dialog._app = app;
  return true;
}

function submit() {
  const el = dialog._targetEl;
  const app = dialog._app;
  if (!el || !app) { closeMeasureDialog(); return; }

  const values = {};
  for (const input of fieldsEl.querySelectorAll("input")) {
    const v = parseFloat(input.value);
    if (!Number.isFinite(v) || v <= 0) return;
    values[input.name] = v;
  }

  const before = cloneElement(el);
  applyMeasurements(el, values);
  const after = cloneElement(el);

  const cmd = new TransformCommand();
  cmd.records = [{ id: el.id, before, after }];
  app.history.push(cmd);

  closeMeasureDialog();
}

export function closeMeasureDialog() {
  if (!dialog) return;
  dialog.classList.add("hidden");
  dialog._targetEl = null;
  dialog._app = null;
  if (onClose) onClose();
}

export function isOpen() {
  return dialog && !dialog.classList.contains("hidden");
}
