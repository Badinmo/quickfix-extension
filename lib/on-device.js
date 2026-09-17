/**
 * On-device translate (ADR 0003): the browser's built-in Translator and
 * LanguageDetector, behind the same runAction seam as Gemini. Experimental,
 * off by default, translate only — grammar always goes to the provider.
 *
 * The globals are reached through `browserApi()` below, which the worker
 * points at whatever context actually has the API: the worker itself where
 * the browser exposes it there (Edge), an offscreen document where it does
 * not (Chrome — the spec declares both interfaces `Exposed=Window`). This
 * module never imports lib/ai.js; the deadline and its TIMEOUT belong to
 * runAction, which asks `signal.aborted`.
 */

import { languageCode } from './config.js';
import { offscreenApi, offscreenSupported } from './on-device-offscreen.js';

/** @typedef {{ Translator?: object, LanguageDetector?: object }} OnDeviceApi */

/**
 * The one seam onto the built-in APIs, read fresh on every call like every
 * other ambient global this module talks to (`fetch`, `chrome.storage.local`
 * in lib/ai.js): the worker's own `globalThis.Translator` when the browser
 * puts it there (Edge), else the offscreen bridge (Chrome), else nothing. A
 * test stands in a fake pair the same way the provider harness stands in
 * `window.fetch` — by assigning `globalThis.Translator` directly, no setter
 * needed. Checking `.availability` rather than `typeof === 'function'` is
 * what makes that work: the real API is a class (itself a function) but a
 * stub is a plain object exposing the same static method.
 * @returns {OnDeviceApi}
 */
function browserApi() {
  if (typeof globalThis.Translator?.availability === 'function') {
    return { Translator: globalThis.Translator, LanguageDetector: globalThis.LanguageDetector };
  }
  if (offscreenSupported()) return offscreenApi();
  return {};
}

/**
 * Translate on-device, or say why not. Resolves to the replacement, or null
 * when this route cannot take the action — no API, pair not available now,
 * the call failed — so runAction falls through to Gemini. A run cut short by
 * the deadline also resolves null; runAction sees the aborted signal and
 * reports TIMEOUT rather than starting a Gemini call it has no time for.
 *
 * @param {string} text
 * @param {object} settings  targetLanguage, secondaryLanguage, autoSwapLanguage (display names)
 * @param {AbortSignal} signal  the action's deadline
 * @returns {Promise<string|null>}
 */
export async function translateOnDevice(text, settings, signal) {
  const { Translator, LanguageDetector } = browserApi();
  if (!Translator) return null;

  const target = languageCode(settings.targetLanguage);
  const secondary = languageCode(settings.secondaryLanguage);
  if (!target || !secondary) return null;

  const attempt = async () => {
    const detected = await detectLanguage(LanguageDetector, text, signal);
    const sourceLanguage = detected || secondary;
    const targetLanguage = detected && sameLanguage(detected, target) && settings.autoSwapLanguage ? secondary : target;

    if ((await Translator.availability({ sourceLanguage, targetLanguage })) !== 'available') return null;

    const translator = await Translator.create({ sourceLanguage, targetLanguage, signal });
    try {
      const out = String((await translator.translate(text, { signal })) ?? '').trim();
      return out || null;
    } finally {
      translator.destroy?.();
    }
  };

  try {
    // The signal is also handed to the API (create/translate/detect), and the
    // offscreen bridge forwards it on to the real call there too — but either
    // way, a model or a bridge round trip that ignores it must not hold the
    // action past the deadline: the race ends the promise Kalam is waiting on
    // regardless of whether the underlying call ever notices the abort.
    return await untilAbort(attempt(), signal);
  } catch {
    return null;
  }
}

/** `promise`, or a rejection the moment `signal` aborts — whichever comes first. */
function untilAbort(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

const abortError = () => new DOMException('The action ran out of time.', 'AbortError');

/**
 * The selection's language as a BCP-47 tag, or null when the detector is not
 * there, not ready without a download (never a surprise download mid-action),
 * or unsure. The caller then assumes the secondary language, which is what
 * the user said they usually write in.
 */
async function detectLanguage(LanguageDetector, text, signal) {
  if (!LanguageDetector) return null;
  try {
    if ((await LanguageDetector.availability()) !== 'available') return null;
    const detector = await LanguageDetector.create({ signal });
    try {
      const [best] = (await detector.detect(text)) || [];
      const tag = best?.detectedLanguage;
      return tag && tag !== 'und' ? tag : null;
    } finally {
      detector.destroy?.();
    }
  } catch {
    return null;
  }
}

/* ------------------------------------------------------ feature detection */

const ABSENT = Object.freeze({
  supported: false,
  availability: 'absent',
  reason: 'This browser has no built-in Translator. On-device translate needs Chrome 138 or newer (or an Edge that offers the same API).'
});

/**
 * The three questions the options page asks before offering the toggle: is
 * the API there, is this pair offered, does it need a download. `supported`
 * says whether the toggle may be turned on — now ('available') or after the
 * download the reason describes ('downloadable' / 'downloading'). Every
 * other case is greyed out with the reason. Never rejects.
 *
 * @param {{ sourceLanguage: string, targetLanguage: string }} pair  display
 *   names as stored in settings (secondary → target)
 * @returns {Promise<{ supported: boolean,
 *   availability: 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'absent' | string,
 *   reason: string | null }>}
 */
export async function onDeviceStatus({ sourceLanguage, targetLanguage }) {
  const { Translator } = browserApi();
  if (!Translator) return ABSENT;

  const pairName = `${sourceLanguage} → ${targetLanguage}`;
  const unknown = [sourceLanguage, targetLanguage].find((name) => !languageCode(name));
  if (unknown) {
    return { supported: false, availability: 'unavailable', reason: `Kalam has no language code for ${unknown}, so the browser cannot be asked about ${pairName}.` };
  }

  let availability;
  try {
    availability = String(await Translator.availability({
      sourceLanguage: languageCode(sourceLanguage),
      targetLanguage: languageCode(targetLanguage)
    }));
  } catch (err) {
    return { supported: false, availability: 'unavailable', reason: `The browser could not say whether it can translate ${pairName} on-device (${err?.message || err}).` };
  }

  switch (availability) {
    case 'absent': // the offscreen bridge's answer when the document has no Translator either
      return ABSENT;
    case 'available':
      return { supported: true, availability, reason: null };
    case 'downloadable':
      return { supported: true, availability, reason: `Needs a one-time download of the ${targetLanguage} language pack before it can run on this machine.` };
    case 'downloading':
      return { supported: true, availability, reason: `The ${targetLanguage} language pack is still downloading. Gemini is used until it finishes.` };
    case 'unavailable':
      return {
        supported: false,
        availability,
        reason: `This browser cannot translate ${pairName} on-device. Either the language pair is not offered or this machine is below the hardware floor — the browser does not say which.`
      };
    default:
      return { supported: false, availability, reason: `The browser answered "${availability}" for ${pairName}, which Kalam does not know how to use.` };
  }
}

/** Same language, ignoring region and script: the detector says `zh` for Chinese (Simplified), `pt` for either Portuguese. */
const sameLanguage = (a, b) => primary(a) === primary(b);
const primary = (tag) => String(tag || '').toLowerCase().split('-')[0];

/* ------------------------------------------------------ download consent */
// #10: the options page asks once per language pair before the model
// downloads, and remembers the answer in settings.onDeviceConsentedPairs.

/**
 * The storage key for one pair, source and target as the display names
 * settings use ("English>Arabic"). Never parsed back apart — an opaque
 * membership key. Takes the same `{ sourceLanguage, targetLanguage }` shape
 * as onDeviceStatus and downloadOnDeviceLanguage, rather than two loose
 * strings, so a caller already holding "the pair" never has to take it apart.
 */
export const pairKey = ({ sourceLanguage, targetLanguage }) => `${sourceLanguage}>${targetLanguage}`;

/** Whether `pairs` (settings.onDeviceConsentedPairs) already covers this pair. */
export const hasConsent = (pairs, pair) => Array.isArray(pairs) && pairs.includes(pairKey(pair));

/** `pairs` plus this pair, without duplicating an already-consented one. Pure — the caller saves the result. */
export function addConsent(pairs, pair) {
  const list = Array.isArray(pairs) ? pairs : [];
  const key = pairKey(pair);
  return list.includes(key) ? list : [...list, key];
}

/**
 * Run (or wait out) the one-time model download for a pair, reporting
 * progress and abortable by `signal`. Meant to be called from an extension
 * page — the options page — not the service worker: Chrome exposes
 * `Translator` to Window contexts only, and an options page is one, so this
 * runs directly there with no background round trip and no new message
 * type. (The offscreen bridge in lib/on-device-offscreen.js exists solely
 * because the *service worker* lacks that exposure on Chrome; it is
 * unrelated to this function and untouched by it. On a browser exposing
 * `Translator` to the worker too, such as Edge, `browserApi()` still finds
 * it as `globalThis.Translator` there as well.)
 *
 * Chrome's Translator API reports download progress once it starts
 * (`downloadprogress` on the object `monitor` is handed, with `loaded` as a
 * 0..1 fraction — see Chrome's own docs example, `loaded * 100` for a
 * percentage) but never a size in bytes before it starts, so there is
 * nothing honest to show before Continue beyond an approximate, hedged
 * figure; the options page supplies that copy.
 *
 * @param {{ sourceLanguage: string, targetLanguage: string }} pair  display names, as stored in settings
 * @param {{ onProgress?: (loaded: number) => void, signal?: AbortSignal }} [opts]
 * @returns {Promise<void>} resolves once the pair is ready to translate
 *   (immediately, if it already was); rejects with a DOMException named
 *   'AbortError' if `signal` fires, or a plain Error for anything else —
 *   the caller tells those apart by `err.name`.
 */
export async function downloadOnDeviceLanguage({ sourceLanguage, targetLanguage }, { onProgress, signal } = {}) {
  const { Translator } = browserApi();
  if (!Translator) throw new Error('This browser has no built-in Translator.');

  const source = languageCode(sourceLanguage);
  const target = languageCode(targetLanguage);
  if (!source || !target) {
    throw new Error(`Kalam has no language code for ${!source ? sourceLanguage : targetLanguage}.`);
  }

  const translator = await Translator.create({
    sourceLanguage: source,
    targetLanguage: target,
    signal,
    monitor(m) {
      m.addEventListener('downloadprogress', (e) => onProgress?.(e.loaded));
    }
  });
  translator.destroy?.();
}
