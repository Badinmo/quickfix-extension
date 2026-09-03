/**
 * Google Gemini client. Runs in the background service worker only — content
 * scripts never hold the API key and never make the network call themselves
 * (requirements §7: page CSP would block it, and the key must stay out of any
 * page-accessible context).
 */

import { MAX_CHARS } from './config.js';
import { buildSystemInstruction, buildUserPrompt } from './prompts.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 45000;

/** Thrown for anything we want to show the user as a readable message. */
export class AiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Run one action against Gemini.
 *
 * @param {'grammar'|'translate'} action
 * @param {string} text  the exact text the user selected
 * @param {object} settings
 * @returns {Promise<string>} the replacement text
 */
export async function runAction(action, text, settings) {
  if (!settings.apiKey) {
    throw new AiError('NO_API_KEY', 'No Gemini API key set. Open QuickFix settings to add one.');
  }
  if (typeof text !== 'string' || !text.trim()) {
    throw new AiError('EMPTY', 'There was no text to work on.');
  }
  if (text.length > MAX_CHARS) {
    throw new AiError(
      'TOO_LONG',
      `Selection is ${text.length.toLocaleString()} characters; the limit is ${MAX_CHARS.toLocaleString()}. Select a smaller chunk.`
    );
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

  const raw = await callWithLeastThinking(settings, body);
  const cleaned = cleanOutput(raw, text);

  if (!cleaned.trim()) {
    throw new AiError('EMPTY_RESPONSE', 'Gemini returned an empty response. Try again.');
  }
  return cleaned;
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

async function callWithLeastThinking(settings, body) {
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
      const out = await callGemini(settings.model, settings.apiKey, body);
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

async function callGemini(model, apiKey, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res;
  try {
    res = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new AiError('TIMEOUT', 'Gemini took too long to respond. Try again.');
    }
    throw new AiError('NETWORK', 'Could not reach the Gemini API. Check your connection.');
  } finally {
    clearTimeout(timer);
  }

  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    throw mapHttpError(res.status, payload);
  }

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

function mapHttpError(status, payload) {
  const detail = payload?.error?.message || '';

  if (status === 400 && /API[_ ]key/i.test(detail)) {
    return new AiError('BAD_KEY', 'That Gemini API key was rejected. Check it in QuickFix settings.');
  }
  if (status === 400) {
    // Usually a request field this model doesn't accept. runAction retries
    // once without the thinking hint when it sees this code.
    return new AiError('INVALID_ARGUMENT', detail || 'Gemini rejected the request as invalid.');
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
