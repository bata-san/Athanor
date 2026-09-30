const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { JSDOM } = require("jsdom");

const runtime = fs.readFileSync(path.join(__dirname, "..", "assets", "procedural-runtime.js"), "utf8");
const bridge = fs.readFileSync(path.join(__dirname, "..", "assets", "cosmetic-bridge.js"), "utf8");

test("procedural has-text and chained CSS operators apply remove/style actions", () => {
  const dom = new JSDOM("<!doctype html><div class='sponsor'><span>Promoted offer</span></div><div class='sponsor'>Editorial</div>", { runScripts: "outside-only" });
  const { window } = dom;
  window.eval(runtime);
  window.__athanorApplyProcedural([
    {
      selector: [
        { type: "css-selector", arg: ".sponsor" },
        { type: "has-text", arg: "Promoted" },
      ],
      action: { type: "remove" },
    },
    {
      selector: [
        { type: "css-selector", arg: ".sponsor" },
        { type: "has-text", arg: "/Editorial/i" },
      ],
      action: { type: "style", arg: "visibility: hidden !important;" },
    },
  ]);
  assert.equal(window.document.querySelectorAll(".sponsor").length, 1);
  assert.equal(window.document.querySelector(".sponsor").style.visibility, "hidden");
  dom.window.close();
});

test("procedural runtime handles upward, xpath, and attribute actions without evaluating filter code", () => {
  const dom = new JSDOM("<!doctype html><section class='wrapper'><a class='bad-link' onclick='run()'>ad</a></section>", { runScripts: "outside-only" });
  const { window } = dom;
  window.eval(runtime);
  window.__athanorApplyProcedural([
    {
      selector: [
        { type: "css-selector", arg: ".bad-link" },
        { type: "upward", arg: "1" },
      ],
      action: { type: "remove-class", arg: "wrapper" },
    },
    {
      selector: [
        { type: "css-selector", arg: "a" },
        { type: "xpath", arg: "self::a" },
        { type: "matches-attr", arg: "onclick" },
      ],
      action: { type: "remove-attr", arg: "onclick" },
    },
  ]);
  assert.equal(window.document.querySelector("section").classList.contains("wrapper"), false);
  assert.equal(window.document.querySelector("a").hasAttribute("onclick"), false);
  assert.equal(runtime.includes("new Function"), false);
  dom.window.close();
});

test("document bridge batches class/id queries and accepts matching host CSS replies", async () => {
  const dom = new JSDOM("<!doctype html><main><div id='ad-slot' class='banner promo'></div></main>", { runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  const webview = new window.EventTarget();
  const messages = [];
  webview.postMessage = (message) => messages.push(message);
  window.chrome = { webview };
  window.eval(bridge);
  await new Promise((resolve) => setTimeout(resolve, 70));
  const request = messages.find((message) => message.type === "cosmetic-query");
  assert.ok(request);
  assert.deepEqual([...request.classes].sort(), ["banner", "promo"]);
  assert.deepEqual([...request.ids], ["ad-slot"]);
  webview.dispatchEvent(new window.MessageEvent("message", {
    data: { athanorShield: 1, type: "cosmetic-response", id: request.id, css: ".banner{display:none!important}\n" },
  }));
  assert.match(window.document.querySelector("[data-athanor-cosmetics]").textContent, /\.banner/);
  dom.window.close();
});
