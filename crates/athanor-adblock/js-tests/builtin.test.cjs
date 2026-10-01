const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { JSDOM } = require("jsdom");

const asset = (name) => fs.readFileSync(path.join(__dirname, "..", "assets", name), "utf8");
const youtube = asset("youtube-ads.js");
const drm = asset("drm-off.js");

const open = [];
// The injected script keeps a polling interval alive; close every window so the test process can exit.
test.afterEach(() => { while (open.length) open.pop().window.close(); });
const page = (html = "") => { const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, { runScripts: "outside-only", url: "https://www.youtube.com/watch?v=x", pretendToBeVisual: true }); open.push(dom); return dom; };
const tick = (ms = 650) => new Promise((resolve) => setTimeout(resolve, ms));

test("youtube: ad data is pruned from parsed player responses and is idempotent", () => {
  const { window } = page();
  window.eval(youtube);
  window.eval(youtube); // second injection must be a no-op
  const response = window.JSON.parse(JSON.stringify({ streamingData: {}, videoDetails: { title: "t" }, adPlacements: [1], playerAds: [2], adSlots: [3], keep: 1 }));
  assert.equal(response.adPlacements, undefined);
  assert.equal(response.playerAds, undefined);
  assert.equal(response.adSlots, undefined);
  assert.equal(response.keep, 1);
  // not a player response: left alone
  const other = window.JSON.parse('{"adPlacements":[1],"x":1}');
  assert.equal(JSON.stringify(other.adPlacements), "[1]");
  // wrapped in a "next"/"get_watch" style envelope
  const wrapped = window.JSON.parse(JSON.stringify({ playerResponse: { adPlacements: [1], adSlots: [2], a: 1 } }));
  assert.equal(wrapped.playerResponse.adPlacements, undefined);
  assert.equal(wrapped.playerResponse.a, 1);
});

test("youtube: the initial player response global is pruned on assignment", () => {
  const { window } = page();
  window.eval(youtube);
  window.eval("var ytInitialPlayerResponse = { streamingData: {}, adPlacements: [1], playerAds: [2], ok: true };");
  assert.equal(window.ytInitialPlayerResponse.adPlacements, undefined);
  assert.equal(window.ytInitialPlayerResponse.playerAds, undefined);
  assert.equal(window.ytInitialPlayerResponse.ok, true);
});

test("youtube: ad containers are hidden by a stylesheet", () => {
  const { window } = page();
  window.eval(youtube);
  const css = window.document.getElementById("athanor-yt-style").textContent;
  assert.match(css, /ytd-ad-slot-renderer/);
  assert.match(css, /display:none!important/);
});

test("youtube: an ad in progress is muted, fast-forwarded, skipped, then playback is restored", async () => {
  const { window } = page('<div class="html5-video-player ad-showing"><video class="html5-main-video"></video><button class="ytp-ad-skip-button"></button></div>');
  const video = window.document.querySelector("video");
  let clicked = 0;
  window.document.querySelector(".ytp-ad-skip-button").addEventListener("click", () => { clicked += 1; });
  Object.defineProperty(video, "duration", { value: 30, configurable: true });
  video.playbackRate = 1.5;
  video.muted = false;
  window.eval(youtube);
  await tick(50);
  assert.equal(video.muted, true, "muted during the ad");
  assert.equal(video.playbackRate, 16, "sped up");
  assert.ok(video.currentTime >= 29.9, "jumped to the end");
  assert.ok(clicked >= 1, "skip pressed");
  // ad ends
  window.document.querySelector(".html5-video-player").classList.remove("ad-showing");
  await tick(650);
  assert.equal(video.playbackRate, 1.5, "speed restored");
  assert.equal(video.muted, false, "volume restored");
});

test("youtube: a normal video is never touched", async () => {
  const { window } = page('<div class="html5-video-player"><video class="html5-main-video"></video></div>');
  const video = window.document.querySelector("video");
  Object.defineProperty(video, "duration", { value: 600, configurable: true });
  video.playbackRate = 2;
  window.eval(youtube);
  await tick(650);
  assert.equal(video.playbackRate, 2);
  assert.equal(video.currentTime, 0);
  assert.equal(video.muted, false);
});

test("youtube: the ad-blocker interstitial is dismissed", async () => {
  const { window } = page('<tp-yt-paper-dialog><ytd-enforcement-message-view-model>blocked</ytd-enforcement-message-view-model></tp-yt-paper-dialog><tp-yt-iron-overlay-backdrop></tp-yt-iron-overlay-backdrop>');
  window.eval(youtube);
  await tick(50);
  assert.equal(window.document.querySelector("ytd-enforcement-message-view-model"), null);
  assert.equal(window.document.querySelector("tp-yt-iron-overlay-backdrop"), null);
});

test("drm: encrypted media is refused and the API surface is removed", async () => {
  const { window } = page();
  window.MediaKeys = function MediaKeys() {};
  window.MediaKeySystemAccess = function MediaKeySystemAccess() {};
  window.HTMLMediaElement.prototype.setMediaKeys = () => Promise.resolve();
  window.eval(drm);
  window.eval(drm); // idempotent
  await assert.rejects(window.navigator.requestMediaKeySystemAccess("com.widevine.alpha", []), (e) => e.name === "NotSupportedError");
  assert.equal(window.MediaKeys, undefined);
  assert.equal(window.MediaKeySystemAccess, undefined);
  const video = window.document.createElement("video");
  assert.equal(video.mediaKeys, null);
  await assert.rejects(video.setMediaKeys(null), (e) => e.name === "NotSupportedError");
});
