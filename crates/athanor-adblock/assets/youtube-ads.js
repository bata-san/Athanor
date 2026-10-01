// Athanor built-in YouTube ad handling. Injected at document start into youtube.com pages (top frame).
//
// Three layers, each harmless when the others already did the job:
//  1. Strip ad data from the player responses YouTube itself loads (JSON.parse, fetch/Response.json, and the
//     initial `ytInitialPlayerResponse` global), so most ads are never scheduled.
//  2. Hide ad containers with CSS.
//  3. Whatever slips through: when the player enters an ad state, mute it, fast-forward it to the end and press
//     "Skip"; restore volume/speed afterwards. Also dismisses the "ad blockers are not allowed" interstitial.
// Written for this project (clean-room): no code from other blockers.
(() => {
  'use strict';
  if (globalThis.__athanorYtAds) return;
  try { Object.defineProperty(globalThis, '__athanorYtAds', { value: 1 }); } catch (_e) { return; }

  const AD_KEYS = ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams'];
  const prune = (object) => {
    if (object && typeof object === 'object') {
      for (const key of AD_KEYS) {
        if (key in object) { try { delete object[key]; } catch (_e) { object[key] = undefined; } }
      }
    }
    return object;
  };
  const isPlayerResponse = (value) => Boolean(value && typeof value === 'object' && ('streamingData' in value || 'playabilityStatus' in value || 'videoDetails' in value));
  const pruneResponse = (value) => {
    if (!value || typeof value !== 'object') return value;
    if (isPlayerResponse(value)) prune(value);
    if (value.playerResponse) prune(value.playerResponse);
    if (value.response && value.response.playerResponse) prune(value.response.playerResponse);
    return value;
  };

  // 1a. Player responses parsed from JSON text.
  try {
    const nativeParse = JSON.parse;
    JSON.parse = function (...args) {
      const value = nativeParse.apply(this, args);
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
      if (!/\/youtubei\/v1\/(player|next|get_watch|reel)/.test(url)) return promise;
      return promise.then((value) => { try { pruneResponse(value); } catch (_e) { /* ignore */ } return value; });
    };
  } catch (_e) { /* ignore */ }

  // 1c. The response embedded in the page HTML is assigned to this global.
  try {
    let initial;
    Object.defineProperty(globalThis, 'ytInitialPlayerResponse', {
      configurable: true,
      get() { return initial; },
      set(value) { initial = prune(value); },
    });
  } catch (_e) { /* ignore */ }

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
  let savedRate = null;
  let savedMuted = null;
  const handleAdState = () => {
    try {
      const player = document.querySelector('.html5-video-player');
      const video = player && (player.querySelector('video.html5-main-video') || player.querySelector('video'));
      if (player && video) {
        const inAd = player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');
        if (inAd) {
          if (savedRate === null) { savedRate = video.playbackRate; savedMuted = video.muted; }
          video.muted = true;
          try { video.playbackRate = 16; } catch (_e) { /* ignore */ }
          if (Number.isFinite(video.duration) && video.duration > 0 && video.currentTime < video.duration - 0.1) {
            try { video.currentTime = video.duration; } catch (_e) { /* ignore */ }
          }
          for (const selector of SKIP_BUTTONS) {
            const button = player.querySelector(selector) || document.querySelector(selector);
            if (button) button.click();
          }
        } else if (savedRate !== null) {
          try { video.playbackRate = savedRate; } catch (_e) { /* ignore */ }
          video.muted = Boolean(savedMuted);
          savedRate = null;
          savedMuted = null;
        }
      }
      // "Ad blockers are not allowed" interstitial: remove it and let the video go on.
      const enforcement = document.querySelector('ytd-enforcement-message-view-model');
      if (enforcement) {
        const dialog = enforcement.closest('tp-yt-paper-dialog') || enforcement;
        dialog.remove();
        const backdrop = document.querySelector('tp-yt-iron-overlay-backdrop');
        if (backdrop) backdrop.remove();
        if (document.body) document.body.style.removeProperty('overflow');
        const main = document.querySelector('video.html5-main-video');
        if (main && main.paused) { const play = main.play(); if (play && play.catch) play.catch(() => {}); }
      }
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
