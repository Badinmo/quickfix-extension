/**
 * The service worker's half of the offscreen bridge for on-device translate
 * (ADR 0003): the built-in Translator and LanguageDetector in the shape
 * lib/on-device.js expects, backed by messages to offscreen/on-device.html.
 *
 * Why it exists: Chrome exposes both APIs to windows only, never to workers
 * (spec: `Exposed=Window`; docs: "isn't available in Web Workers"). Edge
 * exposes them in the worker too, so lib/on-device.js only reaches for this
 * bridge when `globalThis.Translator` is missing — feature detection, never a
 * user-agent check. The document is created on first use and left open; it
 * is invisible, holds no state and gets nothing but the text runAction was
 * already given.
 */

export const OFFSCREEN_URL = 'offscreen/on-device.html';
export const OFFSCREEN_MESSAGE_TYPE = 'QF_OFFSCREEN_ON_DEVICE';

/** True when this context can open an offscreen document at all. */
export const offscreenSupported = () => Boolean(globalThis.chrome?.offscreen?.createDocument && globalThis.chrome?.runtime?.getContexts);

/**
 * A Translator / LanguageDetector pair whose calls run in the offscreen
 * document. `create` hands back a handle; the real object is created per
 * call on the other side, so nothing is held across messages.
 */
export function offscreenApi() {
  return {
    Translator: {
      availability: (options) => call({ op: 'availability', api: 'Translator', options }),
      create: async ({ sourceLanguage, targetLanguage, signal: createSignal }) => ({
        translate: (text, opts) => call({ op: 'translate', sourceLanguage, targetLanguage, text }, opts?.signal || createSignal),
        destroy() {}
      })
    },
    LanguageDetector: {
      availability: (options) => call({ op: 'availability', api: 'LanguageDetector', options }),
      create: async (opts) => ({
        detect: (text) => call({ op: 'detect', text }, opts?.signal),
        destroy() {}
      })
    }
  };
}

let nextCallId = 0;

/**
 * One call to the offscreen document. `signal` is runAction's deadline — it
 * cannot be sent as-is (an AbortSignal isn't structured-cloneable), so a
 * matching `cancel` message carries its abort across instead, tagged with the
 * same `callId` offscreen/on-device.js uses to find the right AbortController
 * on its side. The reply itself is unaffected: whichever settles first (the
 * real answer or lib/on-device.js's own deadline race) wins for the caller.
 */
async function call(payload, signal) {
  await ensureDocument();
  const callId = ++nextCallId;
  const onAbort = () => {
    chrome.runtime.sendMessage({ type: OFFSCREEN_MESSAGE_TYPE, op: 'cancel', callId }).catch(() => {});
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await chrome.runtime.sendMessage({ type: OFFSCREEN_MESSAGE_TYPE, callId, ...payload });
    if (!res || typeof res.ok !== 'boolean') throw new Error('The on-device document did not answer.');
    if (!res.ok) throw new Error(res.error || 'The on-device call failed.');
    return res.value;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

let creating = null;

/** Open the offscreen document unless it is already there. Concurrent callers share one creation. */
async function ensureDocument() {
  const url = chrome.runtime.getURL(OFFSCREEN_URL);
  const open = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
  if (open.length) return;
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        // Chrome's reason list has no entry for the built-in AI APIs; WORKERS is
        // the closest ("the document needs a context the worker lacks"). The
        // justification is what a reviewer reads.
        reasons: ['WORKERS'],
        justification: 'The built-in Translator and Language Detector are only exposed to documents, not to the extension service worker. This invisible document runs on-device translation for the selection the user asked to translate.'
      })
      .catch((err) => {
        // Lost a race with another creation: the document is there, carry on.
        if (!/single offscreen document|already exists/i.test(err?.message || '')) throw err;
      })
      .finally(() => { creating = null; });
  }
  await creating;
}
