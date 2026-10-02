// Page-side half of "Translate page". Injected on demand; it only ever changes the *text* of text nodes and a few
// text attributes, never the tree, so the page's structure, listeners and scripts stay exactly as they were.
(() => {
  if (window.__athTr && window.__athTr.v === 1) return;
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'CODE', 'PRE', 'KBD', 'SAMP', 'VAR', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'CANVAS', 'SVG', 'MATH', 'IFRAME', 'OBJECT', 'EMBED', 'AUDIO', 'VIDEO', 'HEAD']);
  const ATTRS = ['title', 'placeholder', 'alt', 'aria-label'];
  const LETTER = /\p{L}/u;
  const state = { v: 1, on: false, units: [], saved: [] };
  const blockCache = new WeakMap();

  const skipped = (el) => {
    if (SKIP_TAGS.has(el.tagName.toUpperCase())) return true;
    if (el.getAttribute('translate') === 'no' || el.classList.contains('notranslate')) return true;
    const ce = el.getAttribute('contenteditable');
    return ce === '' || ce === 'true' || ce === 'plaintext-only';
  };
  const inlineLike = (el) => {
    let v = blockCache.get(el);
    if (v === undefined) {
      const d = getComputedStyle(el).display;
      v = d === 'inline' || d === 'contents' || d === 'ruby' || d === 'ruby-text';
      blockCache.set(el, v);
    }
    return v;
  };
  const blockOf = (node) => {
    let el = node.parentElement;
    while (el && el.parentElement && inlineLike(el)) el = el.parentElement;
    return el;
  };

  const collect = () => {
    state.units = [];
    const byBlock = new Map();
    const walk = (root) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n.nodeType === 1 && skipped(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
      });
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.nodeType === 1) { if (n.shadowRoot) walk(n.shadowRoot); continue; }
        const raw = n.nodeValue;
        if (!raw || !LETTER.test(raw)) continue;
        const block = blockOf(n) || root;
        let unit = byBlock.get(block);
        if (!unit) { unit = { refs: [] }; byBlock.set(block, unit); state.units.push(unit); }
        const lead = raw.match(/^\s*/)[0];
        const trail = raw.match(/\s*$/)[0];
        unit.refs.push({ node: n, lead, trail, core: raw.slice(lead.length, raw.length - trail.length).replace(/\s+/g, ' ') });
      }
    };
    walk(document.body || document.documentElement);
    for (const el of document.querySelectorAll('[title],[placeholder],[alt],[aria-label]')) {
      if (el.closest('[translate=no],.notranslate,script,style,code,pre,svg')) continue;
      for (const attr of ATTRS) {
        const raw = el.getAttribute(attr);
        if (raw && LETTER.test(raw)) state.units.push({ refs: [{ el, attr, lead: '', trail: '', core: raw.trim().replace(/\s+/g, ' ') }] });
      }
    }
    const title = document.querySelector('title');
    if (title && title.firstChild && title.firstChild.nodeType === 3 && LETTER.test(title.textContent)) {
      const raw = title.firstChild.nodeValue;
      state.units.unshift({ refs: [{ node: title.firstChild, lead: '', trail: '', core: raw.trim().replace(/\s+/g, ' ') }] });
    }
    return state.units.map((unit, id) => ({
      id,
      parts: unit.refs.map((r) => ({ t: r.core, l: r.lead.length > 0, r: r.trail.length > 0 })),
    }));
  };

  const apply = (list, tight) => {
    for (const [id, parts] of list) {
      const unit = state.units[id];
      if (!unit) continue;
      unit.refs.forEach((ref, i) => {
        const text = parts[i];
        if (typeof text !== 'string' || !text) return;
        if (ref.node) {
          if (!ref.node.isConnected) return;
          if (!ref.saved) { ref.saved = true; state.saved.push(ref); ref.original = ref.node.nodeValue; }
          // Japanese and Chinese are written without spaces between pieces of one sentence.
          const gap = tight && unit.refs.length > 1;
          ref.node.nodeValue = (gap ? '' : ref.lead) + text + (gap ? '' : ref.trail);
        } else if (ref.el) {
          if (!ref.saved) { ref.saved = true; state.saved.push(ref); ref.original = ref.el.getAttribute(ref.attr); }
          ref.el.setAttribute(ref.attr, text);
        }
      });
    }
    state.on = true;
    return state.saved.length;
  };

  const restore = () => {
    for (const ref of state.saved) {
      try {
        if (ref.node) ref.node.nodeValue = ref.original;
        else if (ref.el) ref.el.setAttribute(ref.attr, ref.original);
      } catch (_e) { /* the node left the page; nothing to put back */ }
      ref.saved = false;
    }
    state.saved = [];
    state.units = [];
    state.on = false;
    return true;
  };

  Object.defineProperty(window, '__athTr', { value: Object.assign(state, { collect, apply, restore }), configurable: true });
})();
