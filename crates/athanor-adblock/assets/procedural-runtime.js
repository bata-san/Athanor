(() => {
  "use strict";

  const trimQuotes = (value) => {
    const text = String(value || "").trim();
    return text.length > 1 && ((text[0] === '"' && text.at(-1) === '"') || (text[0] === "'" && text.at(-1) === "'"))
      ? text.slice(1, -1)
      : text;
  };

  const safePattern = (value) => {
    const text = trimQuotes(value);
    if (text.length > 260) return null;
    const match = text.match(/^\/([\s\S]*)\/([dgimsuvy]*)$/);
    if (!match) return { test: (subject) => String(subject).includes(text) };
    if (match[1].length > 160 || /\\[1-9]|\\k<|\(\?[=!<]|\([^)]*[|+*][^)]*\)(?:[+*]|\{)/.test(match[1])) return null;
    const flags = [...new Set(match[2].replace(/[^imu]/g, ""))].join("");
    try {
      const regex = new RegExp(match[1], flags);
      return { test: (subject) => { regex.lastIndex = 0; return regex.test(String(subject)); } };
    } catch (_) {
      return null;
    }
  };

  const splitAttrMatcher = (arg) => {
    const index = String(arg).indexOf("=");
    return index < 0
      ? { name: String(arg).trim(), matcher: null }
      : { name: String(arg).slice(0, index).trim(), matcher: safePattern(String(arg).slice(index + 1)) };
  };

  const applyFilter = (filter) => {
    if (!filter || !Array.isArray(filter.selector) || filter.selector.length > 32) return;
    let current = [];
    let started = false;
    const doc = document;
    const unique = (items) => [...new Set(items)].filter((item) => item && item.nodeType === 1);

    for (const op of filter.selector) {
      if (!op || typeof op.type !== "string") return;
      const arg = String(op.arg || "");
      if (op.type === "css-selector") {
        try {
          if (!started) current = [...doc.querySelectorAll(arg)];
          else {
            const found = [];
            for (const parent of current) found.push(...parent.querySelectorAll(arg));
            current = found;
          }
          started = true;
        } catch (_) {
          return;
        }
        continue;
      }
      if (!started) {
        if (!doc.documentElement) return;
        current = [doc.documentElement];
        started = true;
      }
      const matcher = safePattern(arg);
      switch (op.type) {
        case "has-text":
          if (!matcher) return;
          current = current.filter((element) => matcher.test(element.textContent || ""));
          break;
        case "matches-attr": {
          const test = splitAttrMatcher(arg);
          if (!test.name || (test.matcher === null && arg.includes("="))) return;
          current = current.filter((element) => {
            const value = element.getAttribute(test.name);
            return value !== null && (!test.matcher || test.matcher.test(value));
          });
          break;
        }
        case "matches-css":
        case "matches-css-before":
        case "matches-css-after": {
          const index = arg.indexOf(":");
          if (index < 1 || !matcher) return;
          const property = arg.slice(0, index).trim();
          const expected = safePattern(arg.slice(index + 1));
          if (!property || !expected) return;
          const pseudo = op.type === "matches-css-before" ? "::before" : op.type === "matches-css-after" ? "::after" : null;
          current = current.filter((element) => {
            try { return expected.test(getComputedStyle(element, pseudo).getPropertyValue(property)); }
            catch (_) { return false; }
          });
          break;
        }
        case "matches-path": {
          if (!matcher) return;
          current = current.filter((element) => matcher.test(location.pathname + location.search));
          break;
        }
        case "min-text-length": {
          const minimum = Number(arg);
          if (!Number.isFinite(minimum) || minimum < 0 || minimum > 100000) return;
          current = current.filter((element) => (element.textContent || "").trim().length >= minimum);
          break;
        }
        case "upward":
        case "nth-ancestor": {
          const levels = Number(arg);
          current = unique(current.map((element) => {
            if (Number.isInteger(levels) && levels >= 1 && levels <= 32) {
              let node = element;
              for (let i = 0; i < levels && node; i++) node = node.parentElement;
              return node;
            }
            try { return element.closest(arg); } catch (_) { return null; }
          }));
          break;
        }
        case "xpath": {
          if (arg.length > 1024) return;
          const found = [];
          for (const element of current) {
            try {
              const result = doc.evaluate(arg, element, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
              for (let i = 0; i < Math.min(result.snapshotLength, 1000); i++) found.push(result.snapshotItem(i));
            } catch (_) { return; }
          }
          current = unique(found);
          break;
        }
        case "has":
          try { current = current.filter((element) => element.querySelector(arg)); }
          catch (_) { return; }
          break;
        case "not":
          try { current = current.filter((element) => !element.matches(arg)); }
          catch (_) { return; }
          break;
        case "matches-media":
          try { if (!matchMedia(arg).matches) current = []; }
          catch (_) { current = []; }
          break;
        case "watch-attr": {
          const names = arg.split(/[\s,]+/).filter(Boolean);
          current = current.filter((element) => names.some((name) => element.hasAttribute(name)));
          break;
        }
        case "others":
          current = current.slice(1);
          break;
        default:
          return;
      }
      if (!current.length) return;
    }

    const action = filter.action || { type: "remove" };
    let normalizedStyle = "";
    if (action.type === "style") {
      try {
        const probe = doc.createElement("span");
        probe.style.cssText = String(action.arg || "");
        normalizedStyle = probe.style.cssText;
      } catch (_) { return; }
    }
    for (const element of unique(current)) {
      const arg = typeof action.arg === "string" ? action.arg : "";
      switch (action.type) {
        case "remove": element.remove(); break;
        case "style":
          if (element.style.cssText !== normalizedStyle) element.style.cssText = normalizedStyle;
          break;
        case "remove-attr":
          if (arg && element.hasAttribute(arg)) element.removeAttribute(arg);
          break;
        case "remove-class":
          if (arg && element.classList.contains(arg)) element.classList.remove(arg);
          break;
        default: break;
      }
    }
  };

  const applyAll = (filters) => {
    if (!Array.isArray(filters) || filters.length > 1024 || globalThis.__athanorProceduralRules === filters) return;
    globalThis.__athanorProceduralRules = filters;
    let queued = false;
    let idleTimer = 0;
    let stopped = false;
    const run = () => {
      queued = false;
      if (stopped) return;
      for (const filter of filters) {
        try { applyFilter(filter); } catch (_) { /* Invalid selectors fail open for this rule. */ }
      }
    };
    const schedule = () => {
      if (queued || stopped) return;
      queued = true;
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
      else setTimeout(run, 32);
    };
    const observer = new MutationObserver((records) => {
      if (!records.length) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { stopped = true; observer.disconnect(); }, 60000);
      schedule();
    });
    const observe = () => {
      if (stopped || !document.documentElement) return;
      observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
      run();
    };
    observe();
    idleTimer = setTimeout(() => { stopped = true; observer.disconnect(); }, 60000);
  };

  Object.defineProperty(globalThis, "__athanorApplyProcedural", { value: applyAll, configurable: false });
  if (typeof module === "object" && module.exports) module.exports = { applyAll, applyFilter };
})();
