function athanorSetConstant(chain, value) {
  // Athanor scriptlet `set-constant` (clean-room; uBlock-compatible name and arguments).
  // Makes `chain` (e.g. "ytInitialPlayerResponse.playerAds") read as a constant. Works even if the page creates the
  // owning objects later: intermediate properties are watched until they appear.
  if (typeof chain !== 'string' || chain === '') return;
  const constants = {
    undefined: undefined, false: false, true: true, null: null, emptyStr: '', "''": '', '': '', emptyArr: [], emptyObj: {},
    noopFunc: function () {}, trueFunc: function () { return true; }, falseFunc: function () { return false; },
    noopPromiseResolve: function () { return Promise.resolve({}); }, noopPromiseReject: function () { return Promise.reject(); },
  };
  let constant;
  if (Object.prototype.hasOwnProperty.call(constants, value)) constant = constants[value];
  else if (/^-?\d{1,15}$/.test(String(value))) constant = Number(value);
  else return;
  const parts = chain.split('.');
  const isObject = (candidate) => candidate !== null && (typeof candidate === 'object' || typeof candidate === 'function');
  const apply = (owner, index) => {
    const key = parts[index];
    if (index === parts.length - 1) {
      try { Object.defineProperty(owner, key, { configurable: true, enumerable: true, get() { return constant; }, set() {} }); } catch (_e) { /* not configurable */ }
      return;
    }
    const existing = Object.getOwnPropertyDescriptor(owner, key);
    // Another rule already watches this owner/key: join its list instead of replacing the accessor.
    if (existing && existing.set && existing.set.athanorHandlers) {
      existing.set.athanorHandlers.push((next) => apply(next, index + 1));
      const present = owner[key];
      if (isObject(present)) apply(present, index + 1);
      return;
    }
    const current = owner[key];
    if (isObject(current)) { apply(current, index + 1); return; }
    let stored = current;
    const handlers = [(next) => apply(next, index + 1)];
    const setter = function (next) { stored = next; if (isObject(next)) for (const handler of handlers) handler(next); };
    setter.athanorHandlers = handlers;
    try {
      Object.defineProperty(owner, key, { configurable: true, enumerable: true, get() { return stored; }, set: setter });
    } catch (_e) { /* not configurable */ }
  };
  apply(globalThis, 0);
}
