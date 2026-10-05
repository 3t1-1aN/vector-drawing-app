// math/fingerprint.js
// Cache key for a stroke cluster: same ink → skip re-recognition.

/** FNV-1a over quantized path samples of the given elements. */
export function fingerprintElements(elements) {
  const parts = elements
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((el) => {
      if (el.type !== "path" || !el.points?.length) return el.id;
      const q = [];
      const step = Math.max(1, Math.floor(el.points.length / 24));
      for (let i = 0; i < el.points.length; i += step) {
        const p = el.points[i];
        q.push(`${Math.round(p.x * 2)},${Math.round(p.y * 2)}`);
      }
      return `${el.id}:${q.join(";")}`;
    });
  return fnv1a(parts.join("|"));
}

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
