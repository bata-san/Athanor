function athanorJsonPrune(rawPrunePaths, rawNeedlePaths) {
  // Athanor scriptlet `json-prune` (clean-room; uBlock-compatible name and arguments).
  // Removes the listed property paths (space separated, `*` or `[]` for "every key / element") from JSON the page
  // parses (`JSON.parse`) or reads from a fetch response, but only when every path in the second argument exists.
  const prune = String(rawPrunePaths || '').split(/\s+/).filter(Boolean);
  if (prune.length === 0) return;
  const needles = String(rawNeedlePaths || '').split(/\s+/).filter(Boolean);
  const isObject = (candidate) => candidate !== null && typeof candidate === 'object';
  const targets = (root, path, visit) => {
    const segments = path.split('.');
    const walk = (node, index) => {
      if (!isObject(node)) return;
      const key = segments[index];
      const last = index === segments.length - 1;
      const keys = key === '*' || key === '[]' ? Object.keys(node) : (key in node ? [key] : []);
      for (const name of keys) { if (last) visit(node, name); else walk(node[name], index + 1); }
    };
    walk(root, 0);
  };
  const exists = (root, path) => { let found = false; targets(root, path, () => { found = true; }); return found; };
  const clean = (value) => {
    if (!isObject(value)) return value;
    if (needles.length && !needles.every((path) => exists(value, path))) return value;
    for (const path of prune) targets(value, path, (owner, name) => { try { delete owner[name]; } catch (_e) { /* frozen */ } });
    return value;
  };
  if (globalThis.__athanorJsonPrune) { globalThis.__athanorJsonPrune.push(clean); return; }
  const cleaners = [clean];
  Object.defineProperty(globalThis, '__athanorJsonPrune', { value: cleaners, configurable: true });
  const run = (value) => { for (const fn of cleaners) { try { fn(value); } catch (_e) { /* never break the page */ } } return value; };
  const nativeParse = JSON.parse;
  JSON.parse = function (...args) { return run(nativeParse.apply(this, args)); };
  if (typeof Response !== 'undefined') {
    const nativeJson = Response.prototype.json;
    Response.prototype.json = function () { return nativeJson.call(this).then(run); };
  }
}
