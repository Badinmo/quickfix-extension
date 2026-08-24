/**
 * Shared settings schema + storage helpers.
 *
 * Storage is `chrome.storage.local` by design (requirements §7): API keys never
 * leave this machine via browser account sync. See README "Open question 4".
 */

export const DEFAULTS = {
  apiKey: '',
  model: 'gemini-2.5-flash',

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
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash — recommended (fast, generous free tier)'
  },
  {
    id: 'gemini-2.5-flash-lite',
    label: 'Gemini 2.5 Flash-Lite — fastest / cheapest'
  },
  {
    id: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro — highest quality, slower'
  },
  {
    id: 'gemini-2.0-flash',
    label: 'Gemini 2.0 Flash — older, very fast'
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
  return { ...DEFAULTS, ...stored };
}

export async function saveSettings(patch) {
  await chrome.storage.local.set(patch);
}
