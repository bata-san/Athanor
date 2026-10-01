// Athanor find-in-page. Evaluated as a function expression and called with {action, q, cs}; returns {count, index}.
// Matches are painted with the CSS Custom Highlight API (no DOM changes): all matches pale yellow, the current one orange.
function (a) {
  var S = window.__athanorFind || (window.__athanorFind = { q: '', cs: false, ranges: [], i: -1, sheet: null });
  var supports = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function';
  function paint() {
    if (!supports) return;
    try {
      CSS.highlights.delete('athanor-find'); CSS.highlights.delete('athanor-find-current');
      if (!S.ranges.length) return;
      if (!S.sheet) {
        S.sheet = new CSSStyleSheet();
        S.sheet.replaceSync('::highlight(athanor-find){background-color:#ffe36e;color:#000}::highlight(athanor-find-current){background-color:#ff9f1a;color:#000}');
        document.adoptedStyleSheets = document.adoptedStyleSheets.concat([S.sheet]);
      }
      CSS.highlights.set('athanor-find', new Highlight(...S.ranges));
      if (S.i >= 0) CSS.highlights.set('athanor-find-current', new Highlight(S.ranges[S.i]));
    } catch (e) { /* highlighting is cosmetic */ }
  }
  function clear() { S.ranges = []; S.i = -1; S.q = ''; paint(); }
  if (a.action === 'clear') { clear(); return { count: 0, index: 0 }; }

  var q = String(a.q || '');
  var cs = !!a.cs;
  if (!q) { clear(); return { count: 0, index: 0 }; }

  function collect() {
    var needle = cs ? q : q.toLowerCase();
    var out = [];
    var root = document.body || document.documentElement;
    if (!root) return out;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentElement;
        if (!p || !n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        var tag = p.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA' || tag === 'TEMPLATE') return NodeFilter.FILTER_REJECT;
        if (p.checkVisibility && !p.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var node;
    while ((node = walker.nextNode()) && out.length < 5000) {
      var text = node.nodeValue;
      var hay = cs ? text : text.toLowerCase();
      if (hay.length !== text.length) continue; // case folding changed the length: offsets would be wrong
      var at = 0;
      while ((at = hay.indexOf(needle, at)) !== -1 && out.length < 5000) {
        var r = document.createRange();
        r.setStart(node, at); r.setEnd(node, at + needle.length);
        out.push(r);
        at += needle.length;
      }
    }
    return out;
  }

  var fresh = a.action === 'start' || q !== S.q || cs !== S.cs;
  if (fresh) {
    S.q = q; S.cs = cs; S.ranges = collect(); S.i = -1;
    // Begin with the first match that is on screen (or after it), like Safari.
    for (var k = 0; k < S.ranges.length; k++) {
      var rect = S.ranges[k].getBoundingClientRect();
      if (rect.bottom >= 0) { S.i = k; break; }
    }
    if (S.i < 0 && S.ranges.length) S.i = 0;
  } else if (S.ranges.length) {
    var n = S.ranges.length;
    if (a.action === 'prev') S.i = (S.i - 1 + n) % n; else if (a.action === 'next') S.i = (S.i + 1) % n;
  }
  paint();
  if (S.i >= 0 && S.ranges[S.i]) {
    var el = S.ranges[S.i].startContainer.parentElement;
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  }
  return { count: S.ranges.length, index: S.ranges.length ? S.i + 1 : 0 };
}
