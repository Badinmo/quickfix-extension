/**
 * Key onboarding copy (ADR 0001): the one place the "why", the numbered steps,
 * the one-key-per-person note and the key page URL live, so the options page
 * and the in-page onboarding panel say the same thing. Screenshots are
 * optional: `images/onboarding-N.png` per step, shown when present.
 */

export const KEY_PAGE_URL = 'https://aistudio.google.com/apikey';

export const WHY_LINE =
  "It's free, it's yours, and Kalima never sees it — your text goes straight from your browser to Google.";

/** One entry per numbered step, in order; `screenshot` is the image path relative to the extension root. */
export const STEPS = Object.freeze([
  { text: 'Open Google AI Studio’s key page (the Get your free key button opens it).', screenshot: 'images/onboarding-1.png' },
  { text: 'Sign in with your Google account and click Create API key.', screenshot: 'images/onboarding-2.png' },
  { text: 'Copy the key it shows you.', screenshot: 'images/onboarding-3.png' },
  { text: 'Paste it below — Kalima checks it the moment it lands.', screenshot: 'images/onboarding-4.png' }
]);

export const ONE_KEY_NOTE =
  'One key per person. Sharing a key shares its rate limit, so a colleague’s burst of requests would slow yours down too.';

export const SUCCESS_LINE = 'Working — you’re set up.';
