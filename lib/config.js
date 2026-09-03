/**
 * Shared settings schema + storage helpers.
 *
 * Storage is `chrome.storage.local` by design (requirements §7): API keys never
 * leave this machine via browser account sync. See README "Open question 4".
 */

export const DEFAULTS = {
  apiKey: '',
  model: 'gemini-3.7-flash',

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

export const MODELS = [
  {
    id: 'gemini-3.7-flash',
    label: 'Gemini 3.7 Flash — recommended (latest, fast)'
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

/** Hard cap on how much text we will send in one request. */
export const MAX_CHARS = 20000;

/** Read all settings, filling in defaults for anything unset. */
export async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  const settings = { ...DEFAULTS, ...stored };

  // A previously-saved model can go stale when Google retires one (this is
  // exactly what broke Test Connection before this list was updated) — fall
  // back to the current default rather than sending a dead model id forever.
  if (!MODELS.some((m) => m.id === settings.model)) {
    settings.model = DEFAULTS.model;
  }
  return settings;
}

export async function saveSettings(patch) {
  await chrome.storage.local.set(patch);
}
