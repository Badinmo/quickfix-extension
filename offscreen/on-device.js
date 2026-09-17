/**
 * The offscreen document's half of on-device translate (ADR 0003).
 *
 * Chrome exposes the built-in Translator and LanguageDetector to windows only
 * (`Exposed=Window` in the spec), so the service worker cannot call them.
 * This document is the extension-owned window the worker reaches instead:
 * lib/on-device-offscreen.js creates it with chrome.offscreen and sends one
 * message per call; this file answers with the API's own result. It holds no
 * state, reads no page and sees only the text the worker was already given.
 * On a browser whose worker has the globals itself (Edge) it is never opened.
 */

const MESSAGE_TYPE = 'QF_OFFSCREEN_ON_DEVICE';

// One AbortController per in-flight call, keyed by the callId
// lib/on-device-offscreen.js assigns — an AbortSignal cannot travel through
// chrome.runtime.sendMessage itself, so a `cancel` message carries the abort
// across instead, and this map is where it lands.
const controllers = new Map();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== MESSAGE_TYPE) return false;

  if (msg.op === 'cancel') {
    controllers.get(msg.callId)?.abort();
    return false; // no reply expected
  }

  handle(msg).then(
    (value) => sendResponse({ ok: true, value }),
    (err) => sendResponse({ ok: false, error: err?.message || String(err) })
  );
  return true; // async
});

async function handle(msg) {
  const controller = new AbortController();
  if (msg.callId != null) controllers.set(msg.callId, controller);
  try {
    switch (msg.op) {
      case 'availability': {
        const api = msg.api === 'LanguageDetector' ? globalThis.LanguageDetector : msg.api === 'Translator' ? globalThis.Translator : null;
        // 'absent' is this bridge's word for "no such global here" — lib/on-device.js reads it.
        if (!api) return 'absent';
        return String(await api.availability(msg.options));
      }
      case 'detect': {
        const detector = await LanguageDetector.create({ signal: controller.signal });
        try {
          return await detector.detect(msg.text);
        } finally {
          detector.destroy?.();
        }
      }
      case 'translate': {
        const translator = await Translator.create({ sourceLanguage: msg.sourceLanguage, targetLanguage: msg.targetLanguage, signal: controller.signal });
        try {
          return await translator.translate(msg.text, { signal: controller.signal });
        } finally {
          translator.destroy?.();
        }
      }
      default:
        throw new Error(`Unknown on-device op: ${msg.op}`);
    }
  } finally {
    if (msg.callId != null) controllers.delete(msg.callId);
  }
}
