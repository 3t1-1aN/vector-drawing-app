// math/settings.js
// Soft toggle for the invisible math assist layer. Default on — the paper
// understands quietly; users who want a pure sketch can turn it off.

export const mathAssist = {
  enabled: true,
  apiBase: "http://127.0.0.1:8787",
};

export function setMathAssistEnabled(on) {
  mathAssist.enabled = !!on;
}
