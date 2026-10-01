// Athanor "Block DRM" switch: the page is told that encrypted media (EME / Widevine) is not available.
//
// This does not defeat or bypass any protection. It only refuses to take part: sites that need DRM show their own
// "unsupported" message or fall back to unprotected streams, exactly as in a browser built without a CDM.
(() => {
  'use strict';
  if (globalThis.__athanorDrmOff) return;
  try { Object.defineProperty(globalThis, '__athanorDrmOff', { value: 1 }); } catch (_e) { return; }

  const refuse = () => Promise.reject(new DOMException('Encrypted media is turned off in Athanor.', 'NotSupportedError'));
  try {
    Object.defineProperty(Navigator.prototype, 'requestMediaKeySystemAccess', { value: refuse, configurable: true, writable: true });
  } catch (_e) { /* ignore */ }
  try {
    Object.defineProperty(HTMLMediaElement.prototype, 'setMediaKeys', { value: refuse, configurable: true, writable: true });
    Object.defineProperty(HTMLMediaElement.prototype, 'mediaKeys', { get() { return null; }, configurable: true });
  } catch (_e) { /* ignore */ }
  for (const name of ['MediaKeys', 'MediaKeySystemAccess', 'MediaKeySession', 'MediaKeyStatusMap', 'MediaKeyMessageEvent']) {
    try { delete globalThis[name]; } catch (_e) { /* ignore */ }
  }
})();
