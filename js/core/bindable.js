// core/bindable.js
// A stable object whose properties are whatever record is currently bound.
// Renderers and panels keep importing one binding; each document owns the
// record, so a new drawing does not inherit or wipe another one's settings.

export function bindable(initial) {
  let current = initial;
  const proxy = new Proxy({}, {
    get(_target, key) {
      if (key === "toJSON") return () => ({ ...current });
      return current[key];
    },
    set(_target, key, value) {
      current[key] = value;
      return true;
    },
    has(_target, key) {
      return key in current;
    },
    ownKeys() {
      return Reflect.ownKeys(current);
    },
    getOwnPropertyDescriptor(_target, key) {
      if (!(key in current)) return undefined;
      return {
        configurable: true,
        enumerable: true,
        writable: true,
        value: current[key],
      };
    },
  });
  return {
    proxy,
    bind(next) {
      current = next;
    },
  };
}
