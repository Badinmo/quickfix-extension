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
      maxOutputTokens: outputBudget(text, settings.model),
      candidateCount: 1
    }
  };

  // 2.5 Flash / Flash-Lite think by default, which costs a second or two we do
  // not need for a rewrite. 2.5 Pro cannot have thinking disabled.
  if (/^gemini-2\.5-flash/.test(settings.model)) {
    body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  const raw = await callGemini(settings.model, settings.apiKey, body);
  const cleaned = cleanOutput(raw, text);

  if (!cleaned.trim()) {
    throw new AiError('EMPTY_RESPONSE', 'Gemini returned an empty response. Try again.');
  }
  return cleaned;
}

/**
 * The output is roughly as long as the input, so budget by character count with
 * plenty of headroom — but stay under the model's own ceiling (8,192 for the
 * 2.0 generation, far higher for 2.5).
 */
function outputBudget(text, model) {
  const ceiling = /^gemini-2\.0/.test(model) ? 8192 : 32768;
  return Math.min(ceiling, Math.max(1024, 512 + text.length));
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

  const out = (candidate.content?.parts || [])
    .map((p) => p.text || '')
    .join('');

  if (candidate.finishReason === 'MAX_TOKENS') {
    throw new AiError('TRUNCATED', 'The response was cut off — the selection is too long. Try a smaller chunk.');
  }
  return out;
}

function mapHttpError(status, payload) {
  const detail = payload?.error?.message || '';

  if (status === 400 && /API[_ ]key/i.test(detail)) {
    return new AiError('BAD_KEY', 'That Gemini API key was rejected. Check it in QuickFix settings.');
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
