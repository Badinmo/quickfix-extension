/**
 * Shared settings schema + storage helpers.
 *
 * Storage is `chrome.storage.local` by design (requirements §7): API keys never
 * leave this machine via browser account sync. See README "Open question 4".
 */

export const DEFAULTS = {
  // Provider. Only 'gemini' is valid today (ADR 0002); the field exists so a
  // second provider needs no storage migration. Nothing reads it yet.
  provider: 'gemini',
  apiKey: '',
  model: 'gemini-3.7-flash',

  // On-device translate (ADR 0003) — experimental, off by default. Not read yet.
  onDeviceTranslate: false,

  // Translation
  targetLanguage: 'Arabic',
  secondaryLanguage: 'English',
  autoSwapLanguage: true,

  // Grammar
  tone: 'preserve',
  customInstructions: '',

  // UI
  showToolbar: true,
  showIndicator: true
};

/**
 * The offline fallback for the live model list (ADR 0004). Kept short and
 * current; `recommended` marks the default the same way the live list does.
 */
export const MODELS = [
  {
    id: 'gemini-3.7-flash',
    label: 'Gemini 3.7 Flash — recommended (latest, fast)',
    recommended: true
  },
  {
    id: 'gemini-3.6-flash',
    label: 'Gemini 3.6 Flash — previous generation, still current'
  },
  {
    id: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash-Lite — fastest / cheapest'
  },
  {
    id: 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro (preview) — highest quality, slower'
  }
];

export const TONES = [
  { id: 'preserve', label: 'Preserve the original tone (default)' },
  { id: 'professional', label: 'Professional' },
  { id: 'plain', label: 'Plain English' },
  { id: 'concise', label: 'Concise' },
  { id: 'friendly', label: 'Friendly' },
  { id: 'formal', label: 'Formal' }
];

export const LANGUAGES = [
  'Arabic', 'Bengali', 'Bulgarian', 'Chinese (Simplified)', 'Chinese (Traditional)',
  'Croatian', 'Czech', 'Danish', 'Dutch', 'English', 'Estonian', 'Farsi (Persian)',
  'Filipino', 'Finnish', 'French', 'German', 'Greek', 'Gujarati', 'Hebrew', 'Hindi',
  'Hungarian', 'Indonesian', 'Italian', 'Japanese', 'Korean', 'Kurdish (Sorani)',
  'Latvian', 'Lithuanian', 'Malay', 'Norwegian', 'Pashto', 'Polish',
  'Portuguese (Brazil)', 'Portuguese (Portugal)', 'Punjabi', 'Romanian', 'Russian',
  'Serbian', 'Slovak', 'Slovenian', 'Somali', 'Spanish', 'Swedish', 'Tamil', 'Thai',
  'Turkish', 'Ukrainian', 'Urdu', 'Vietnamese', 'Welsh'
];

/**
 * Storage key for the live model list (ADR 0004): `{ models, fetchedAt,
 * keyFingerprint }`. Written by `listModels` in lib/ai.js; read here for the
 * stale-model check. Kept out of DEFAULTS so it never travels with settings.
 */
export const MODEL_CACHE_KEY = 'modelCache';

/** The model a list marks recommended, else its first entry. */
export const recommendedModel = (models) => models.find((m) => m.recommended) || models[0];

/** Hard cap on how much text we will send in one request. */
export const MAX_CHARS = 20000;

/** Read all settings, filling in defaults for anything unset. */
export async function getSettings() {
  const { [MODEL_CACHE_KEY]: cache, ...stored } = await chrome.storage.local.get({ ...DEFAULTS, [MODEL_CACHE_KEY]: null });
  const settings = { ...DEFAULTS, ...stored };

  // A previously-saved model can go stale when Google retires one (this is
  // exactly what broke Test Connection before this list was updated) — fall
  // back to the current default rather than sending a dead model id forever.
  // The live list (ADR 0004) is the authority when there is one; the hardcoded
  // list only vouches for a model when there is not.
  const offered = (list) => Array.isArray(list) && list.some((m) => m.id === settings.model);
  if (!offered(cache?.models) && !offered(MODELS)) {
    settings.model = DEFAULTS.model;
  }
  return settings;
}

export async function saveSettings(patch) {
  await chrome.storage.local.set(patch);
}
