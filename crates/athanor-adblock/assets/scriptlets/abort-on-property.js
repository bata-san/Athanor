function athanorAbortOnProperty(chain, mode) {
  // Athanor scriptlets `abort-on-property-read` / `abort-on-property-write` (clean-room; uBlock-compatible).
  // Throws a ReferenceError when the page reads (mode "read") or assigns (mode "write") `chain`, which stops the
  // script that tried to. `mode` is added by the two thin wrappers below.
  if (typeof chain !== 'string' || chain === '') return;
  const parts = chain.split('.');
  const message = String.fromCharCode(97 + Math.floor(Math.random() * 26)) + Math.random().toString(36).slice(2, 9);
  const isObject = (candidate) => candidate !== null && (typeof candidate === 'object' || typeof candidate === 'function');
  const hook = (owner, index) => {
    const key = parts[index];
    const last = index === parts.length - 1;
    let stored = owner[key];
    try {
      Object.defineProperty(owner, key, {
        configurable: true, enumerable: true,
        get() { if (last && mode === 'read') throw new ReferenceError(message); return stored; },
        set(next) { if (last && mode === 'write') throw new ReferenceError(message); stored = next; if (!last && isObject(next)) hook(next, index + 1); },
      });
    } catch (_e) { /* not configurable */ }
    if (!last && isObject(stored)) hook(stored, index + 1);
  };
  hook(globalThis, 0);
}
