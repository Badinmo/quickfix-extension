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
  model: 'gemini-3.8-flash',

  // On-device translate (ADR 0003) — experimental, off by default. Read by
  // runAction's route decision in lib/ai.js and the options page toggle.
  onDeviceTranslate: false,

  // Language pairs the user has already said yes to downloading on-device
  // (#10): "source>target" display-name keys, e.g. "English>Arabic" — see
  // lib/on-device.js's pairKey/hasConsent/addConsent. Read by the options
  // page so re-toggling, or coming back to a pair already consented, never
  // asks again this session or any future one. Only gates the consent
  // *prompt* — a pair the browser already reports 'available' (nothing left
  // to download, consented here or not) always turns the toggle on with no
  // prompt at all; this list only matters for a 'downloadable' pair.
  onDeviceConsentedPairs: [],

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
 * The offline fallback for the live model list (ADR 0004). Deliberately short
 * and deliberately narrow: the mainline Flash family only (no Pro, no preview
 * or experimental builds, nothing niche) — this is a grammar-fix/translate
 * tool, not a model picker, so "generic, fast, cheap, currently supported" is
 * the whole brief. `recommended` marks the default the same way the live list
 * does. Re-check this against https://ai.google.dev/gemini-api/docs/models
 * every so often; the live path (lib/ai.js `shapeModels`) applies the same
 * narrow filter to whatever Gemini actually offers, so this list only matters
 * offline or before a key is entered.
 */
export const MODELS = [
  {
    id: 'gemini-3.8-flash',
    label: 'Gemini 3.8 Flash — recommended (latest, fast)',
    recommended: true
  },
  {
    id: 'gemini-3.7-flash',
    label: 'Gemini 3.7 Flash — previous generation, still current'
  },
  {
    id: 'gemini-3.6-flash',
    label: 'Gemini 3.6 Flash — two generations back, still current'
  },
  {
    id: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash-Lite — fastest / cheapest'
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
 * Display name → BCP-47 tag, for the on-device route (ADR 0003): settings hold
 * the display strings above, the browser's Translator and LanguageDetector
 * speak BCP-47. One entry per LANGUAGES item; the provider harness checks the
 * two lists stay in step. Gemini never sees these — the prompt uses the names.
 */
export const LANGUAGE_CODES = {
  'Arabic': 'ar',
  'Bengali': 'bn',
  'Bulgarian': 'bg',
  'Chinese (Simplified)': 'zh',
  'Chinese (Traditional)': 'zh-Hant',
  'Croatian': 'hr',
  'Czech': 'cs',
  'Danish': 'da',
  'Dutch': 'nl',
  'English': 'en',
  'Estonian': 'et',
  'Farsi (Persian)': 'fa',
  'Filipino': 'fil',
  'Finnish': 'fi',
  'French': 'fr',
  'German': 'de',
  'Greek': 'el',
  'Gujarati': 'gu',
  'Hebrew': 'he',
  'Hindi': 'hi',
  'Hungarian': 'hu',
  'Indonesian': 'id',
  'Italian': 'it',
  'Japanese': 'ja',
  'Korean': 'ko',
  'Kurdish (Sorani)': 'ckb',
  'Latvian': 'lv',
  'Lithuanian': 'lt',
  'Malay': 'ms',
  'Norwegian': 'no',
  'Pashto': 'ps',
  'Polish': 'pl',
  'Portuguese (Brazil)': 'pt-BR',
  'Portuguese (Portugal)': 'pt-PT',
  'Punjabi': 'pa',
  'Romanian': 'ro',
  'Russian': 'ru',
  'Serbian': 'sr',
  'Slovak': 'sk',
  'Slovenian': 'sl',
  'Somali': 'so',
  'Spanish': 'es',
  'Swedish': 'sv',
  'Tamil': 'ta',
  'Thai': 'th',
  'Turkish': 'tr',
  'Ukrainian': 'uk',
  'Urdu': 'ur',
  'Vietnamese': 'vi',
  'Welsh': 'cy'
};

/** The BCP-47 tag for a display name, or null for a name the table does not know. */
export const languageCode = (name) => LANGUAGE_CODES[name] ?? null;

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
