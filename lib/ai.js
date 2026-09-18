/**
 * Google Gemini client. Runs in the background service worker only — content
 * scripts never hold the API key and never make the network call themselves
 * (requirements §7: page CSP would block it, and the key must stay out of any
 * page-accessible context).
 */

import { DEFAULTS, MAX_CHARS, MODELS, MODEL_CACHE_KEY, recommendedModel, saveSettings } from './config.js';
import { buildSystemInstruction, buildUserPrompt } from './prompts.js';
import { translateOnDevice } from './on-device.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Hard stop for one whole action (never-stuck rules, ADR 0004). Flash-class
 * models answer in 1–3 s; anything past this is a failure to report, not to
 * wait out. The budget is per action: thinking-variant retries share it.
 */
const TIMEOUT_MS = 20000;

/** Thrown for anything we want to show the user as a readable message. */
export class AiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Run one action: on-device when it is a translate, the toggle is on and the
 * browser can do the pair right now (ADR 0003); Gemini otherwise. The route
 * is decided inside the action's one 20 s deadline, before the key check —
 * a translate-only user with no key never sees NO_API_KEY for a translate —
 * and before any Gemini call, so the BAD_MODEL heal never runs for an
 * on-device result.
 *
 * @param {'grammar'|'translate'} action
 * @param {string} text  the exact text the user selected
 * @param {object} settings
 * @returns {Promise<{ text: string, via: 'gemini' | 'on-device' }>} the
 *   replacement and which route produced it
 */
export async function runAction(action, text, settings) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new AiError('EMPTY', 'There was no text to work on.');
  }
  if (text.length > MAX_CHARS) {
    throw new AiError(
      'TOO_LONG',
      `Selection is ${text.length.toLocaleString()} characters; the limit is ${MAX_CHARS.toLocaleString()}. Select a smaller chunk.`
    );
  }

  // One deadline for the whole action, whichever route takes it, however
  // many variants get tried and whether or not the model has to be healed.
  return withDeadline(async (signal) => {
    if (action === 'translate' && settings.onDeviceTranslate) {
      const local = await translateOnDevice(text, settings, signal);
      if (local) return { text: local, via: 'on-device' };
      if (signal.aborted) throw timeoutError();
      // Pair not available, API missing or the call failed: Gemini, silently.
    }
    return runGemini(action, text, settings, signal);
  });
}

/** The Gemini route: key check, request, thinking-variant discovery, BAD_MODEL heal, output cleanup. */
async function runGemini(action, text, settings, signal) {
  if (!settings.apiKey) {
    throw new AiError('NO_API_KEY', 'No Gemini API key set. Open Kalima settings to add one.');
  }

  const body = {
    systemInstruction: {
      parts: [{ text: buildSystemInstruction(action, settings) }]
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: buildUserPrompt(text) }]
      }
    ],
    generationConfig: {
      temperature: action === 'translate' ? 0.2 : 0.3,
      topP: 0.95,
      maxOutputTokens: outputBudget(text),
      candidateCount: 1
    }
  };

  let raw;
  try {
    raw = await callWithLeastThinking(settings, body, signal);
  } catch (err) {
    if (!(err instanceof AiError && err.code === 'BAD_MODEL')) throw err;
    const healed = await healModel(settings, signal);
    if (!healed) throw err;
    raw = await callWithLeastThinking(healed, body, signal);
  }
  const cleaned = cleanOutput(raw, text);

  if (!cleaned.trim()) {
    throw new AiError('EMPTY_RESPONSE', 'Gemini returned an empty response. Try again.');
  }
  return { text: cleaned, via: 'gemini' };
}

/**
 * Fixing grammar and translating are mechanical rewrites — they gain nothing
 * from extended reasoning, and every thinking token is latency the user sits
 * and waits through. So ask for the least thinking the model will accept.
 *
 * The problem is knowing what it accepts. How thinking is controlled has
 * changed shape repeatedly across model generations — `thinkingBudget` became
 * `thinkingLevel`, `minimal` exists on some models and not others — and Google's
 * own published pages currently contradict each other on the specifics. Every
 * hardcoded guess here has gone stale, twice breaking the extension outright.
 *
 * So this doesn't guess. It tries the cheapest form first, steps down only when
 * the API actually rejects one, and then REMEMBERS which form worked for that
 * model, so the cost of discovery is paid once rather than on every keystroke.
 * If Google changes the rules again, a rejection simply re-triggers discovery.
 *
 * Ordering matters: sending no thinkingConfig at all means Gemini 3 defaults to
 * "high" — the slowest possible outcome — so that's the last resort, not the
 * fallback.
 */
const THINKING_VARIANTS = [
  { id: 'level-minimal', config: { thinkingLevel: 'minimal' } },
  { id: 'LEVEL-MINIMAL', config: { thinkingLevel: 'MINIMAL' } },
  { id: 'level-low', config: { thinkingLevel: 'low' } },
  { id: 'LEVEL-LOW', config: { thinkingLevel: 'LOW' } },
  { id: 'budget-0', config: { thinkingBudget: 0 } },
  { id: 'none', config: null }
];

const VARIANT_STORE = 'thinkingVariants';

async function rememberVariant(model, id) {
  try {
    const { [VARIANT_STORE]: known = {} } = await chrome.storage.local.get(VARIANT_STORE);
    if (known[model] === id) return;
    known[model] = id;
    await chrome.storage.local.set({ [VARIANT_STORE]: known });
  } catch {
    /* remembering is an optimisation, never a requirement */
  }
}

async function callWithLeastThinking(settings, body, signal) {
  let known;
  try {
    const stored = await chrome.storage.local.get(VARIANT_STORE);
    known = stored?.[VARIANT_STORE]?.[settings.model];
  } catch {
    known = undefined;
  }

  // Whatever worked last time for this model goes first; the rest stay in
  // cheapest-first order behind it as fallbacks.
  const order = known
    ? [
        ...THINKING_VARIANTS.filter((v) => v.id === known),
        ...THINKING_VARIANTS.filter((v) => v.id !== known)
      ]
    : THINKING_VARIANTS;

  let lastErr = null;

  for (const variant of order) {
    if (variant.config) {
      body.generationConfig.thinkingConfig = variant.config;
    } else {
      delete body.generationConfig.thinkingConfig;
    }

    try {
      const out = await callGemini(settings.model, settings.apiKey, body, signal);
      await rememberVariant(settings.model, variant.id);
      return out;
    } catch (err) {
      // Only an argument rejection is worth retrying in another form. A bad
      // key, a rate limit or a network failure would fail identically five
      // more times.
      if (err instanceof AiError && err.code === 'INVALID_ARGUMENT') {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }

  throw lastErr;
}

/**
 * Budget for maxOutputTokens.
 *
 * This has to cover the model's *thinking* tokens as well as the reply itself —
 * they share one allowance. Thinking alone can run to thousands of tokens even
 * at the lowest level, so the floor here is deliberately generous rather than
 * sized to the input: a budget that merely fits the answer produces an empty
 * response, because reasoning consumes it first. It's only a cap, so unused
 * headroom costs nothing.
 */
function outputBudget(text) {
  return Math.min(65536, Math.max(8192, text.length * 2));
}

function timeoutError() {
  return new AiError('TIMEOUT', 'Kalima took too long to respond. Try again.');
}

/**
 * Run one whole operation (an action, a key check, a list refresh) on its own
 * 20 s hard stop: the signal aborts at the deadline and geminiRequest turns
 * that into TIMEOUT. The timer is always cleared, so nothing is left ticking.
 *
 * @template T
 * @param {(signal: AbortSignal) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withDeadline(fn) {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), TIMEOUT_MS);
  try {
    return await fn(deadline.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One authenticated request to the Gemini API, mapped to AiErrors: the key in
 * the header, an abort as TIMEOUT, an unreachable host as NETWORK, a non-2xx
 * status through mapHttpError. Resolves to the parsed JSON (null when the body
 * was not JSON).
 *
 * @param {AbortSignal} signal  the caller's deadline; aborting it ends the request as TIMEOUT
 */
async function geminiRequest(url, apiKey, signal, init = {}) {
  let res;
  try {
    res = await fetch(url, { ...init, headers: { ...init.headers, 'x-goog-api-key': apiKey }, signal });
  } catch (err) {
    if (err.name === 'AbortError') throw timeoutError();
    throw new AiError('NETWORK', 'Could not reach the Gemini API. Check your connection.');
  }

  // The deadline can also fire while the body is still streaming in; that is a
  // timeout too, not an empty response. Anything else unparseable is left to the caller.
  let payload = null;
  try {
    payload = await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw timeoutError();
  }

  if (!res.ok) throw mapHttpError(res.status, payload);
  return payload;
}

async function callGemini(model, apiKey, body, signal) {
  const payload = await geminiRequest(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, apiKey, signal, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const feedback = payload?.promptFeedback;
  if (feedback?.blockReason) {
    throw new AiError('BLOCKED', `Gemini refused the request (${feedback.blockReason}).`);
  }

  const candidate = payload?.candidates?.[0];
  if (!candidate) {
    throw new AiError('EMPTY_RESPONSE', 'Gemini returned no result. Try again.');
  }
  if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'PROHIBITED_CONTENT') {
    throw new AiError('BLOCKED', 'Gemini blocked this text under its safety filters.');
  }

  // Skip any part flagged as a thought. Thought summaries are only returned
  // when explicitly requested (we don't), but joining them into the output
  // would paste the model's internal reasoning straight into the user's
  // document — worth guarding against outright now that thinking is on.
  const out = (candidate.content?.parts || [])
    .filter((p) => !p.thought)
    .map((p) => p.text || '')
    .join('');

  if (candidate.finishReason === 'MAX_TOKENS') {
    throw new AiError(
      'TRUNCATED',
      out.trim()
        ? 'The response was cut off — the selection is too long. Try a smaller chunk.'
        : 'Gemini used its whole token budget thinking and returned nothing. Try a shorter selection, or a different model in settings.'
    );
  }
  return out;
}

/* ---------------------------------------------------------- validate key */

/**
 * Check a key the moment it is pasted (key onboarding, ADR 0001): the cheapest
 * authenticated call there is, one GET on the models endpoint, on its own 20 s
 * deadline. Takes the key directly rather than settings so a key that is not
 * saved yet can be checked.
 *
 * @param {string} apiKey
 * @returns {Promise<{ ok: true }>} resolves when the key works; throws the
 *   mapped AiError otherwise (BAD_KEY, NETWORK, TIMEOUT, RATE_LIMIT, SERVER…),
 *   or NO_API_KEY without a network call when the key is blank.
 */
export async function validateKey(apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) {
    throw new AiError('NO_API_KEY', 'Paste your Gemini API key first.');
  }
  await withDeadline((signal) => geminiRequest(API_BASE, key, signal, { method: 'GET' }));
  return { ok: true };
}

/* ------------------------------------------------------------ model list */

/**
 * The live model list (ADR 0004): what this key can actually run, so a retired
 * model id can never strand a user.
 *
 * @param {object} settings  needs `apiKey`
 * @param {object} [opts]
 * @param {boolean} [opts.force]  bypass the 24 h cache (the Refresh models button)
 * @param {string} [opts.apiKey]  use this key instead of the saved one — the
 *   options page listing models for a key that was just pasted, not yet saved
 * @returns {Promise<{ models: Array<{ id: string, label: string, recommended?: boolean }>,
 *   fetchedAt: number|null, source: 'live'|'fallback' }>}
 */
export async function listModels(settings, { force = false, apiKey: override } = {}) {
  const apiKey = String(override || '').trim() || settings.apiKey;
  if (!apiKey) return FALLBACK_LIST;

  if (!force) {
    const cached = await readModelCache(apiKey);
    if (cached) return { models: cached.models, fetchedAt: cached.fetchedAt, source: 'live' };
  }

  // Its own deadline: this is a whole operation when called from the options
  // page. Inside runAction the refresh shares the action's signal instead.
  try {
    return await withDeadline((signal) => refreshModelList(apiKey, signal));
  } catch {
    // Offline, rejected, empty, timed out: the built-in list keeps settings
    // usable, and whatever cache exists stays for the next attempt.
    return FALLBACK_LIST;
  }
}

/**
 * The self-heal for a retired model (ADR 0004): refresh the list once on the
 * action's own deadline, save the recommended model as the setting, and hand
 * back settings pointing at it — or null when there is nothing better to try,
 * so the caller surfaces the original BAD_MODEL. A refresh that runs out the
 * deadline is the action running out the deadline: that one propagates.
 *
 * @param {AbortSignal} signal  the action's deadline, never a fresh one
 * @returns {Promise<object|null>} settings with the new model, or null
 */
async function healModel(settings, signal) {
  let models;
  try {
    ({ models } = await refreshModelList(settings.apiKey, signal));
  } catch (err) {
    if (err instanceof AiError && err.code === 'TIMEOUT') throw err;
    return null;
  }
  const next = recommendedModel(models);
  if (!next || next.id === settings.model) return null;
  try {
    await saveSettings({ model: next.id });
  } catch {
    /* the retry still happens; the setting just won't stick */
  }
  return { ...settings, model: next.id };
}

const FALLBACK_LIST = Object.freeze({ models: MODELS, fetchedAt: null, source: 'fallback' });
const MODEL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Fetch, shape and cache the live list. Throws an AiError on any failure,
 * including a list with nothing usable in it, and never touches the cache
 * on the way out — so a failed refresh leaves the last good list in place.
 *
 * @param {AbortSignal} signal  the caller's deadline
 */
async function refreshModelList(apiKey, signal) {
  const models = shapeModels(await fetchModelList(apiKey, signal));
  if (!models.length) throw new AiError('EMPTY_RESPONSE', 'Gemini returned no usable models.');
  const fetchedAt = Date.now();
  await chrome.storage.local.set({ [MODEL_CACHE_KEY]: { models, fetchedAt, keyFingerprint: keyFingerprint(apiKey) } });
  return { models, fetchedAt, source: 'live' };
}

/** The cached list, or null when there is none, it is over 24 h old, or it was fetched with a different key. */
async function readModelCache(apiKey) {
  try {
    const stored = await chrome.storage.local.get(MODEL_CACHE_KEY);
    const cache = stored?.[MODEL_CACHE_KEY];
    const usable = cache && Array.isArray(cache.models) && cache.models.length && typeof cache.fetchedAt === 'number';
    const fresh = usable && cache.keyFingerprint === keyFingerprint(apiKey) && Date.now() - cache.fetchedAt < MODEL_CACHE_TTL_MS;
    return fresh ? cache : null;
  } catch {
    return null;
  }
}

/**
 * Identifies which key a cache was fetched with, without storing the key: a
 * 32-bit FNV-1a hash plus the length. Enough to notice a key change; not
 * enough to recover the key from storage.
 */
function keyFingerprint(apiKey) {
  const s = String(apiKey || '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${s.length}:${h.toString(16).padStart(8, '0')}`;
}

/** GET every page of the models endpoint; throws an AiError like callGemini does. */
async function fetchModelList(apiKey, signal) {
  const models = [];
  let pageToken = '';
  do {
    const url = pageToken ? `${API_BASE}?pageToken=${encodeURIComponent(pageToken)}` : API_BASE;
    const payload = await geminiRequest(url, apiKey, signal, { method: 'GET' });
    for (const m of payload?.models || []) models.push(m);
    pageToken = payload?.nextPageToken || '';
  } while (pageToken);
  return models;
}

const stripPrefix = (name) => String(name || '').replace(/^models\//, '');

/**
 * The mainline Flash family, and nothing else: `gemini-<version>-flash` or
 * `gemini-<version>-flash-lite`, an exact match. This is an allowlist, not a
 * blocklist, on purpose — `supportedGenerationMethods` including
 * `generateContent` is true of far more than the flagship text models (Pro,
 * every preview/experimental build, image and audio variants, Gemma, and
 * whatever niche model ships next), and a fix/translate tool has no business
 * offering any of them. A future `gemini-4.0-flash` matches this pattern
 * automatically; a retired `gemini-3.x-flash` simply stops being returned by
 * the endpoint and drops out on the next fetch — no version numbers are
 * hardcoded here.
 */
const FLASH_FAMILY = /^gemini-[\d.]+-flash(-lite)?$/;
const isLite = (id) => /-lite$/.test(id);

// Keep the picker short even when Google keeps several generations live at
// once (it currently does): the newest few flagship models, plus the newest
// lite one — the "fast" and the "cheap" option — not a growing list of every
// generation still technically reachable.
const MAX_FLASH_MODELS = 3;
const MAX_LITE_MODELS = 1;

/**
 * Filter to the current, generic-use Flash family, order newest-first within
 * each group, cap the list, and mark the recommended one: the hardcoded
 * default when the key still offers it, otherwise the newest model.
 */
function shapeModels(raw) {
  const usable = raw
    .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
    .map((m) => ({ id: stripPrefix(m.name), label: stripPrefix(m.displayName || m.name) }))
    .filter((m) => m.id && FLASH_FAMILY.test(m.id));

  // Numeric-aware so 3.10 sorts above 3.8.
  const newestFirst = (a, b) => b.id.localeCompare(a.id, undefined, { numeric: true });
  const flash = usable.filter((m) => !isLite(m.id)).sort(newestFirst).slice(0, MAX_FLASH_MODELS);
  const lite = usable.filter((m) => isLite(m.id)).sort(newestFirst).slice(0, MAX_LITE_MODELS);
  const models = [...flash, ...lite];

  const recommended = models.find((m) => m.id === DEFAULTS.model) || models[0];
  if (recommended) recommended.recommended = true;
  return models;
}

function mapHttpError(status, payload) {
  const detail = payload?.error?.message || '';

  if (status === 400 && /API[_ ]key/i.test(detail)) {
    return new AiError('BAD_KEY', 'That Gemini API key was rejected. Check it in Kalima settings.');
  }
  if (status === 400) {
    // Usually a request field this model doesn't accept. callWithLeastThinking
    // steps to the next thinking variant when it sees this code.
    return new AiError('INVALID_ARGUMENT', detail || 'Gemini rejected the request as invalid.');
  }
  // Google's wording: "… API has not been used in project N before or it is
  // disabled." A bare "disabled" would also match a revoked key, so be exact.
  if (status === 403 && /(has not been used|it is disabled|not enabled)/i.test(detail)) {
    // The key is real but its Google project has the API switched off — a
    // different fix from a mistyped key, so say so.
    return new AiError('BAD_KEY', 'The Generative Language API is not enabled for this key’s Google project. Enable it in Google AI Studio (or make a new key there) and try again.');
  }
  if (status === 401 || status === 403) {
    return new AiError('BAD_KEY', 'Gemini rejected the API key (403). Check the key and that the Generative Language API is enabled.');
  }
  if (status === 404) {
    return new AiError('BAD_MODEL', 'That model is not available for this API key. Pick another model in settings.');
  }
  if (status === 429) {
    return new AiError('RATE_LIMIT', 'Gemini rate limit hit. Wait a moment and try again.');
  }
  if (status >= 500) {
    return new AiError('SERVER', 'Gemini is having problems right now. Try again shortly.');
  }
  return new AiError('HTTP_' + status, detail || `Gemini returned HTTP ${status}.`);
}

/**
 * Strip the wrappers models habitually add, without damaging text that
 * legitimately contains them.
 */
function cleanOutput(raw, original) {
  let out = String(raw).replace(/\r\n/g, '\n');

  // Sentinels, if the model echoed them.
  out = out.replace(/^\s*<<<TEXT\n?/, '').replace(/\n?TEXT>>>\s*$/, '');

  // A markdown fence wrapping the whole response.
  const fence = /^\s*```[a-zA-Z0-9-]*\n([\s\S]*?)\n?```\s*$/.exec(out);
  if (fence && !original.includes('```')) {
    out = fence[1];
  }

  // Matching quotes around the whole response, when the original had none.
  const trimmed = out.trim();
  const quoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith('“') && trimmed.endsWith('”')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"));
  if (quoted && trimmed.length > 1 && !/^["'“]/.test(original.trim())) {
    out = trimmed.slice(1, -1);
  }

  return out.trim();
}
