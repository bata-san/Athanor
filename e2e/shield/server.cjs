// Tiny local site used to verify ad blocking inside the real Athanor WebView2 tab.
const http = require('http');
const page = `<!doctype html><html><head><meta charset="utf-8"><title>Athanor shield test</title>
<style>.box{width:200px;height:40px;background:#ccc;margin:4px}</style></head><body>
<h1>shield test</h1>
<div id="t-ad-banner" class="box AdBox160">.AdBox160</div>
<div id="t-adsbygoogle" class="box ArticleAd">.ArticleAd</div>
<div id="AdSkyscraper" class="box">#AdSkyscraper</div>
<div id="t-plain" class="box content-card">.content-card (must stay visible)</div>
<script>
  window.__results = { scripts: {}, early: null };
  // runs before any external script: was a hide-rule already applied to a late-created element?
  function loadScript(name, src) {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => { window.__results.scripts[name] = 'loaded'; };
    s.onerror = () => { window.__results.scripts[name] = 'blocked'; };
    document.head.appendChild(s);
  }
  loadScript('gpt', 'https://securepubads.g.doubleclick.net/tag/js/gpt.js');
  loadScript('analytics', 'https://www.google-analytics.com/analytics.js');
  loadScript('local', '/local.js');
  // element added after load: on-demand generic cosmetic rules must hide it too
  setTimeout(() => {
    const d = document.createElement('div');
    d.id = 't-late-ad'; d.className = 'box adslot'; d.textContent = 'late .adslot';
    document.body.appendChild(d);
  }, 1200);
</script></body></html>`;
http
  .createServer((req, res) => {
    if (req.url === '/local.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      return res.end('window.__localLoaded = true;');
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(page);
  })
  .listen(8099, '127.0.0.1', () => console.log('listening 8099'));
