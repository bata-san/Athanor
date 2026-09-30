(() => {
  "use strict";
  const bridge = globalThis.chrome && globalThis.chrome.webview;
  if (!bridge || typeof bridge.postMessage !== "function" || globalThis.__athanorCosmeticBridge) return;
  Object.defineProperty(globalThis, "__athanorCosmeticBridge", { value: true });

  const pending = new Set();
  const sentClasses = new Set();
  const sentIds = new Set();
  const queuedClasses = new Set();
  const queuedIds = new Set();
  const applied = new Set();
  const maxTokens = 8192;
  const maxTokenLength = 256;
  const maxReplyBytes = 1024 * 1024;
  let sequence = 0;
  let scheduled = false;
  let style = null;

  const ensureStyle = () => {
    if (style && style.isConnected) return style;
    if (!document.documentElement) return null;
    style = document.createElement("style");
    style.setAttribute("data-athanor-cosmetics", "");
    (document.head || document.documentElement).appendChild(style);
    return style;
  };

  const applyReply = (message) => {
    if (!message || message.athanorShield !== 1 || message.type !== "cosmetic-response") return;
    if (typeof message.id !== "string" || !pending.delete(message.id)) return;
    if (typeof message.css !== "string" || message.css.length > maxReplyBytes || !message.css) return;
    if (applied.has(message.css)) return;
    const node = ensureStyle();
    if (!node) return;
    applied.add(message.css);
    node.appendChild(document.createTextNode(message.css));
  };

  bridge.addEventListener("message", (event) => applyReply(event.data));

  const validToken = (token) => token && token.length <= maxTokenLength && !/[\u0000-\u001f\u007f]/.test(token);
  const collectElement = (element) => {
    if (!element || element.nodeType !== 1) return;
    const id = element.getAttribute("id");
    if (validToken(id) && !sentIds.has(id) && sentClasses.size + sentIds.size + queuedClasses.size + queuedIds.size < maxTokens) queuedIds.add(id);
    const classes = element.getAttribute("class");
    if (classes) {
      for (const token of classes.split(/[\t\n\f\r ]+/)) {
        if (validToken(token) && !sentClasses.has(token) && sentClasses.size + sentIds.size + queuedClasses.size + queuedIds.size < maxTokens) queuedClasses.add(token);
      }
    }
  };

  const collectTree = (node) => {
    if (!node) return;
    if (node.nodeType === 1) {
      collectElement(node);
      if (node.querySelectorAll) {
        for (const element of node.querySelectorAll("[class], [id]")) collectElement(element);
      }
    } else if (node.nodeType === 9 && node.documentElement) {
      collectTree(node.documentElement);
    }
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    const run = () => {
      scheduled = false;
      let budget = 256;
      const classes = [];
      const ids = [];
      for (const token of queuedClasses) {
        queuedClasses.delete(token);
        sentClasses.add(token);
        classes.push(token);
        if (--budget === 0) break;
      }
      while (budget > 0 && queuedIds.size) {
        const token = queuedIds.values().next().value;
        queuedIds.delete(token);
        sentIds.add(token);
        ids.push(token);
        budget--;
      }
      if (sentClasses.size + sentIds.size > maxTokens) {
        const excess = sentClasses.size + sentIds.size - maxTokens;
        for (let i = 0; i < excess; i++) {
          const first = sentClasses.values().next();
          if (!first.done) sentClasses.delete(first.value);
          else break;
        }
      }
      if (classes.length || ids.length) {
        const id = `c${(++sequence).toString(36)}`;
        pending.add(id);
        // WebView2 only delivers *string* messages from pages to the host, so serialise explicitly.
        bridge.postMessage(JSON.stringify({ athanorShield: 1, type: "cosmetic-query", id, classes, ids }));
      }
      if (queuedClasses.size || queuedIds.size) schedule();
    };
    if (typeof globalThis.requestIdleCallback === "function") globalThis.requestIdleCallback(run, { timeout: 120 });
    else globalThis.setTimeout(run, 32);
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") collectElement(record.target);
      else for (const node of record.addedNodes) collectTree(node);
    }
    schedule();
  });
  observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "id"] });
  collectTree(document);
  schedule();
})();
