// Athanor built-in YouTube ad handling. Injected at document start into youtube.com pages (top frame).
//
// Three layers, each harmless when the others already did the job:
//  1. Strip ad data from the player responses YouTube itself loads (JSON.parse, fetch text/JSON, XHR, and the
//     initial `ytInitialPlayerResponse` global), so most ads are never scheduled.
//  2. Hide ad containers with CSS.
//  3. Press a visible Skip button when available. The ad and content share a video element: changing its time,
//     speed or mute state can seek the actual video to its end during a midroll or an SPA transition.
// Written for this project (clean-room): no code from other blockers.
(() => {
  'use strict';
  if (globalThis.__athanorYtAds) return;
  try { Object.defineProperty(globalThis, '__athanorYtAds', { value: 1 }); } catch (_e) { return; }

  const parse = JSON.parse;
  const stringify = JSON.stringify;
  const PLAYER_RESPONSE_URL = /\/youtubei\/v1\/(?:player|next|get_watch|reel(?:_item_watch)?|playlist)(?:[/?]|$)|\/(?:get_video_info|player|playlist)(?:\?|$)/;
  const isPlayerUrl = (raw) => {
    try {
      const url = new URL(raw, location.href);
      return /(^|\.)youtube(?:-nocookie)?\.com$/.test(url.hostname)
        && PLAYER_RESPONSE_URL.test(url.pathname + url.search);
    } catch (_e) { return false; }
  };

  const AD_KEYS = ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams'];
  const prune = (object) => {
    if (object && typeof object === 'object') {
      for (const key of AD_KEYS) {
        if (key in object) { try { delete object[key]; } catch (_e) { object[key] = undefined; } }
      }
    }
    return object;
  };
  const isPlayerResponse = (value) => Boolean(value && typeof value === 'object'
    && ('streamingData' in value || 'playabilityStatus' in value || 'videoDetails' in value));
  const pruneResponse = (value, depth = 0, player = false) => {
    if (!value || typeof value !== 'object' || depth > 8) return value;
    if (Array.isArray(value)) {
      for (const item of value) pruneResponse(item, depth + 1, player);
      return value;
    }
    if (player || isPlayerResponse(value)) prune(value);
    // Watch responses can be an array of envelopes; mobile and playlist responses use different envelopes.
    for (const key of ['playerResponse', 'player_response', 'response', 'responses', 'data']) {
      const child = value[key];
      if (key === 'player_response' && typeof child === 'string') value[key] = pruneText(child);
      else pruneResponse(child, depth + 1, player || key === 'playerResponse');
    }
    return value;
  };
  const pruneText = (text) => {
    if (typeof text !== 'string' || text.length > 16 * 1024 * 1024
        || !AD_KEYS.some((key) => text.includes(`"${key}"`))) return text;
    try { return stringify(pruneResponse(parse(text), 0, true)); } catch (_e) { return text; }
  };

  // 1a. Player responses parsed from JSON text.
  try {
    JSON.parse = function (...args) {
      const value = parse.apply(this, args);
      try { pruneResponse(value); } catch (_e) { /* never break the page */ }
      return value;
    };
  } catch (_e) { /* ignore */ }

  // 1b. Responses read with fetch().json().
  try {
    const nativeJson = Response.prototype.json;
    Response.prototype.json = function () {
      const url = this.url || '';
      const promise = nativeJson.call(this);
      if (!isPlayerUrl(url)) return promise;
      return promise.then((value) => { try { pruneResponse(value, 0, true); } catch (_e) { /* ignore */ } return value; });
    };
    const nativeText = Response.prototype.text;
    Response.prototype.text = function () {
      const promise = nativeText.call(this);
      return isPlayerUrl(this.url) ? promise.then(pruneText) : promise;
    };
  } catch (_e) { /* ignore */ }

  // 1c. XHR's native JSON decoder bypasses JSON.parse. Preserve the original request and response type;
  // only the JSON player data seen by the page changes. Non-JSON and incomplete text remain untouched.
  try {
    if (typeof XMLHttpRequest !== 'undefined') {
      const urls = new WeakMap();
      const cache = new WeakMap();
      const nativeOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (...args) {
        const result = nativeOpen.apply(this, args);
        urls.set(this, String(args[1]));
        cache.delete(this);
        return result;
      };
      for (const key of ['response', 'responseText']) {
        const descriptor = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, key);
        if (!descriptor?.get || !descriptor.configurable) continue;
        Object.defineProperty(XMLHttpRequest.prototype, key, {
          ...descriptor,
          get() {
            const value = descriptor.get.call(this); // retain native InvalidStateError behavior
            if (!isPlayerUrl(this.responseURL || urls.get(this))) return value;
            if (typeof value !== 'string') {
              try { return pruneResponse(value, 0, true); } catch (_e) { return value; }
            }
            const prior = cache.get(this);
            if (prior?.raw === value) return prior.clean;
            const clean = pruneText(value);
            cache.set(this, { raw: value, clean });
            return clean;
          },
        });
      }
    }
  } catch (_e) { /* ignore */ }

  // 1d. Preserve other scriptlets' accessors when observing inline player globals. Some pages supply their
  // first response as a JSON string in ytplayer.config.args rather than ytInitialPlayerResponse.
  const watched = new WeakMap();
  const watch = (owner, key, clean) => {
    if (!owner || (typeof owner !== 'object' && typeof owner !== 'function')) return;
    let keys = watched.get(owner);
    if (keys?.has(key)) return;
    if (!keys) { keys = new Set(); watched.set(owner, keys); }
    keys.add(key);
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (descriptor && !descriptor.configurable) { clean(owner[key]); return; }
    let stored = clean(owner[key]);
    Object.defineProperty(owner, key, {
      configurable: true, enumerable: descriptor?.enumerable ?? true,
      get() { return descriptor?.get ? clean(descriptor.get.call(this)) : stored; },
      set(value) {
        stored = clean(value);
        if (descriptor?.set) descriptor.set.call(this, stored);
      },
    });
  };
  try {
    watch(globalThis, 'ytInitialPlayerResponse', (value) => pruneResponse(value, 0, true));
    watch(globalThis, 'ytplayer', (player) => {
      watch(player, 'config', (config) => {
        if (config && typeof config === 'object') {
          watch(config, 'args', (args) => {
            if (args && typeof args === 'object') watch(args, 'player_response', pruneText);
            return args;
          });
        }
        return config;
      });
      return player;
    });
  } catch (_e) { /* never replace a non-configurable site property */ }

  // 2. Hide ad containers.
  const AD_SELECTORS = [
    '#masthead-ad', '#player-ads', '.ytp-ad-overlay-container', '.ytp-ad-overlay-slot', '.ytp-paid-content-overlay',
    'ytd-display-ad-renderer', 'ytd-ad-slot-renderer', 'ytd-in-feed-ad-layout-renderer', 'ytd-banner-promo-renderer',
    'ytd-statement-banner-renderer', 'ytd-promoted-sparkles-web-renderer', 'ytd-promoted-video-renderer',
    'ytd-companion-slot-renderer', 'ytd-player-legacy-desktop-watch-ads-renderer', 'ytd-action-companion-ad-renderer',
    'ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer)', 'ytm-promoted-sparkles-web-renderer',
    'ytm-companion-slot', 'ad-slot-renderer',
  ];
  const addStyle = () => {
    const root = document.head || document.documentElement;
    if (!root) return; // too early: retried on DOMContentLoaded
    if (document.getElementById('athanor-yt-style')) return;
    const style = document.createElement('style');
    style.id = 'athanor-yt-style';
    style.textContent = `${AD_SELECTORS.join(',')}{display:none!important}`;
    root.appendChild(style);
  };
  addStyle();
  document.addEventListener('DOMContentLoaded', addStyle, { once: true });

  // 3. Skip what is already playing.
  const SKIP_BUTTONS = [
    '.ytp-skip-ad-button', '.ytp-ad-skip-button', '.ytp-ad-skip-button-modern', '.ytp-ad-skip-button-container button',
    '.ytp-ad-overlay-close-button', '.ytp-ad-survey-skip-button',
  ];
  const clicked = new WeakMap();
  const handleAdState = () => {
    try {
      const player = document.querySelector('.html5-video-player');
      if (player) {
        const inAd = player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');
        if (inAd) {
          for (const selector of SKIP_BUTTONS) {
            const button = player.querySelector(selector) || document.querySelector(selector);
            if (button && !button.disabled && button.getAttribute('aria-disabled') !== 'true'
                && !button.hidden && (clicked.get(button) || 0) + 1000 < Date.now()) {
              clicked.set(button, Date.now());
              button.click();
            }
          }
        }
      }
      // Keep server-side enforcement visible. Removing its dialog doesn't restore permission to play and
      // leaves a silently paused video; the site shield gives the person a working recovery path instead.
    } catch (_e) { /* never break the page */ }
  };
  const start = () => {
    handleAdState();
    try {
      new MutationObserver(handleAdState).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    } catch (_e) { /* ignore */ }
    setInterval(handleAdState, 500);
  };
  if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
