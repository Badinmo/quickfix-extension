import { DEFAULTS, MODELS, TONES, LANGUAGES, getSettings, saveSettings, recommendedModel } from '../lib/config.js';
import { KEY_PAGE_URL, WHY_LINE, STEPS, ONE_KEY_NOTE, SUCCESS_LINE } from '../lib/onboarding.js';
import { runNeverStuck } from '../lib/never-stuck.js';
import { downloadOnDeviceLanguage, hasConsent, addConsent } from '../lib/on-device.js';

const $ = (id) => document.getElementById(id);

/** The key as typed, trimmed — what gets validated, listed against and saved. */
const currentKey = () => $('apiKey').value.trim();

const FIELDS = {
  apiKey: 'value',
  model: 'value',
  targetLanguage: 'value',
  secondaryLanguage: 'value',
  autoSwapLanguage: 'checked',
  onDeviceTranslate: 'checked',
  tone: 'value',
  customInstructions: 'value',
  showToolbar: 'checked',
  showIndicator: 'checked'
};

function fillSelect(el, items) {
  el.replaceChildren(
    ...items.map(({ id, label }) => {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = label;
      return opt;
    })
  );
}

fillSelect($('model'), MODELS);
fillSelect($('tone'), TONES);
fillSelect($('targetLanguage'), LANGUAGES.map((l) => ({ id: l, label: l })));
fillSelect($('secondaryLanguage'), LANGUAGES.map((l) => ({ id: l, label: l })));

const settings = await getSettings();
for (const [key, prop] of Object.entries(FIELDS)) {
  $(key)[prop] = settings[key] ?? DEFAULTS[key];
}

/* ------------------------------------------------------------ model list */

// The picker starts on the built-in list (above) so the page is never empty,
// then swaps to the live list (ADR 0004). The user's choice stays selected as
// long as it is still offered; otherwise the recommended model is selected and
// the note says why. A saved model only the live list knows has no option yet
// on first load (picker.value is ''), so the saved setting is the fallback.
// The key in the field travels with the message, so a key pasted moments ago
// is the one listed for, saved or not. Loads can overlap (page open, then a
// paste); only the newest one is allowed to paint the picker.
let modelsSeq = 0;
async function loadModels({ force = false } = {}) {
  const picker = $('model');
  const wanted = picker.value || settings.model;
  const apiKey = currentKey();
  const seq = ++modelsSeq;
  $('refreshModels').disabled = true;
  setModelsNote(force ? 'Refreshing…' : 'Loading the model list…');

  try {
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'QF_LIST_MODELS', force, apiKey });
    } catch {
      res = null;
    }
    if (seq !== modelsSeq) return; // a newer load owns the picker now
    const { models, fetchedAt, source } = res?.ok ? res : { models: MODELS, fetchedAt: null, source: 'fallback' };

    fillSelect(picker, models.map((m) => ({ id: m.id, label: labelWithRecommended(m) })));
    const stillOffered = models.some((m) => m.id === wanted);
    picker.value = stillOffered ? wanted : recommendedModel(models).id;

    const when = source === 'live'
      ? `Updated ${relativeTime(fetchedAt)}.`
      : apiKey ? 'Built-in list — could not reach Gemini.' : 'Built-in list — add an API key to load the live list.';
    setModelsNote(stillOffered ? when : `${when} Your saved model (${wanted}) is no longer available; the recommended one is selected — save to keep it.`, !stillOffered);
  } finally {
    if (seq === modelsSeq) $('refreshModels').disabled = false;
  }
}

/** loadModels for callers with nothing better to do with a failure than say so in the note. */
const loadModelsOrNote = (opts) =>
  loadModels(opts).catch((err) => setModelsNote('Could not load the model list: ' + err.message, true));

function labelWithRecommended(m) {
  return m.recommended && !/recommended/i.test(m.label) ? `${m.label} — recommended` : m.label;
}

/** A hint line under a field: plain by default, `.bad` (red) when it's a warning. Shared by the model and on-device notes. */
function setHint(id, text, warn = false) {
  const el = $(id);
  el.textContent = text;
  el.className = 'hint' + (warn ? ' bad' : '');
}
const setModelsNote = (text, warn) => setHint('modelsNote', text, warn);

function relativeTime(ts) {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return `${hours} h ago`;
}

$('refreshModels').addEventListener('click', () => loadModelsOrNote({ force: true }));
loadModelsOrNote();

/* ------------------------------------------------------------ on-device */

// On-device translate (ADR 0003): greyed with the reason when the browser or
// the current pair can't do it. Turning it on for a pair that needs a
// download shows a consent step first (#10): what will download, an
// approximate size, and Continue / Not now. The pair is always
// secondary → target — the direction auto-swap produces.
let onDeviceSeq = 0;
let lastStatus = null;

const currentPair = () => ({ sourceLanguage: $('secondaryLanguage').value, targetLanguage: $('targetLanguage').value });
const pairConsented = () => hasConsent(consentedPairs, currentPair());

// `settings` above is a read-only snapshot the way the rest of this file
// treats it (every other write goes through collect()/patch in save()); the
// consent list is the one setting that must be updated and persisted the
// moment a download finishes, so it gets its own mutable copy instead.
let consentedPairs = Array.isArray(settings.onDeviceConsentedPairs) ? settings.onDeviceConsentedPairs : [];

async function refreshOnDeviceStatus() {
  const toggle = $('onDeviceTranslate');
  const seq = ++onDeviceSeq;
  setOnDeviceNote('Checking this browser…');

  let status;
  try {
    status = await chrome.runtime.sendMessage({ type: 'QF_ON_DEVICE_STATUS', ...currentPair() });
  } catch {
    status = null;
  }
  if (seq !== onDeviceSeq) return; // superseded by a newer language change
  if (!status || typeof status.supported !== 'boolean') {
    lastStatus = null;
    toggle.disabled = true;
    setOnDeviceNote('Could not check this browser for on-device support.', true);
    hideConsent();
    return;
  }

  // Disabling greys the control out, but the saved value is left alone: a
  // pair that stops being offered because of a language change should not
  // silently erase the user's setting, since runAction falls back to Gemini
  // on its own whenever the pair is unavailable.
  lastStatus = status;
  toggle.disabled = !status.supported;
  setOnDeviceNote(status.reason || '', !status.supported);

  // A language change can land the toggle — already on, from a previous pair
  // — on a new pair that needs a download Kalima has no consent for. Ask
  // again here, exactly like turning the toggle on would; never mid-action,
  // only from this page (ADR 0003 / #10).
  if (toggle.checked && status.availability === 'downloadable' && !pairConsented()) {
    toggle.checked = false;
    askConsent();
  } else {
    hideConsent();
  }
}

const setOnDeviceNote = (text, warn) => setHint('onDeviceNote', text, warn);

/* -------------------------------------------------- download consent (#10) */
// Continue runs the real download right here in the options page: Chrome and
// Edge both expose Translator to a Window context, and this page is one, so
// no background/offscreen round trip or new message type is needed (that
// bridge exists only for the service worker, which lacks the exposure on
// Chrome — see lib/on-device.js's downloadOnDeviceLanguage doc comment).
const odConsent = $('onDeviceConsent');
const odText = $('odConsentText');
const odProgressWrap = $('odProgress');
const odProgressFill = $('odProgressFill');
const odProgressPct = $('odProgressPct');
const odResult = $('odResult');
const odContinue = $('odContinue');
const odNotNow = $('odNotNow');
const odCancel = $('odCancel');

let downloadController = null; // the in-flight download's AbortController, if any
let downloadSeq = 0; // guards the success state's auto-hide against a newer download taking over the panel

/**
 * The panel is always in exactly one of these states; this is the only place
 * that touches the five visibility flags together, so a state can never be
 * left half-applied (e.g. Cancel showing while the ask buttons are also up).
 * @param {'hidden'|'asking'|'downloading'|'done'} state
 */
function setPanelState(state) {
  odConsent.hidden = state === 'hidden';
  odContinue.hidden = state !== 'asking';
  odNotNow.hidden = state !== 'asking';
  odCancel.hidden = state !== 'downloading';
  odProgressWrap.hidden = state !== 'downloading';
  odResult.hidden = state !== 'done';
}

/**
 * Abort whatever download is in flight (if any) and bump `downloadSeq`, so
 * odContinue's own completion handler recognises itself as superseded and
 * discards its result instead of clobbering whatever the panel has moved on
 * to. Without this, a download for pair A left running while the panel opens
 * again for pair B (a language change, or the toggle re-checked mid-download)
 * would eventually resolve and silently flip the toggle on / repaint the
 * result for A over whatever B's own flow is showing.
 */
function abortInFlightDownload() {
  downloadSeq++;
  downloadController?.abort();
  downloadController = null;
}

function hideConsent() {
  abortInFlightDownload();
  setPanelState('hidden');
}

function setProgress(fraction) {
  const pct = Math.max(0, Math.min(100, Math.round((Number(fraction) || 0) * 100)));
  odProgressFill.style.width = pct + '%';
  odProgressPct.textContent = pct + '%';
}

// Chrome reports download progress once it starts (a 0..1 fraction) but never
// a size in bytes beforehand, so this is the most honest figure Kalima can
// show — an approximate, hedged one, not a fabricated precise number.
const APPROX_SIZE_NOTE = "Chrome doesn't report the exact size before downloading starts — on-device " +
  'language packs are typically in the range of 100–300 MB (a rough figure, not a guarantee).';

function askConsent() {
  abortInFlightDownload(); // in case this reopens the panel over an earlier pair's still-running download
  const { targetLanguage } = currentPair();
  odText.textContent = `On-device translate needs a one-time download of the ${targetLanguage} language pack before it can run on this machine. ${APPROX_SIZE_NOTE}`;
  setPanelState('asking');
}

odNotNow.addEventListener('click', () => {
  $('onDeviceTranslate').checked = false;
  hideConsent();
});

odCancel.addEventListener('click', () => downloadController?.abort());

odContinue.addEventListener('click', async () => {
  const pair = currentPair();
  const seq = ++downloadSeq;
  setPanelState('downloading');
  setProgress(0);

  downloadController = new AbortController();
  try {
    await downloadOnDeviceLanguage(pair, { signal: downloadController.signal, onProgress: setProgress });
    // A newer askConsent()/hideConsent() (a language change, a re-opened
    // panel) has already moved the panel on since this download started —
    // discard the result rather than flipping the toggle on for a pair the
    // page has stopped asking about.
    if (seq !== downloadSeq) return;
    setProgress(1);
    consentedPairs = addConsent(consentedPairs, pair);
    await saveSettings({ onDeviceConsentedPairs: consentedPairs });
    $('onDeviceTranslate').checked = true;
    setLine(odResult, 'Downloaded — on-device translate is on for this language.', 'ok');
    setPanelState('done');
    // A brief success state, not a permanent fixture of the page: it clears
    // itself unless a newer download has since taken over the panel.
    setTimeout(() => { if (seq === downloadSeq) hideConsent(); }, 2500);
  } catch (err) {
    // Superseded the same way as above — this also covers the ordinary case
    // of abortInFlightDownload() itself having caused this rejection: that
    // one is not "the user cancelled this pair's download", so it gets no
    // message here, not even a stale "Cancelled".
    if (seq !== downloadSeq) return;
    $('onDeviceTranslate').checked = false;
    // Chrome's create() does accept an AbortSignal (per spec), so Cancel does
    // ask it to stop — but whether the underlying download itself is torn
    // down rather than just abandoned by this page isn't something Kalima can
    // verify, so the message is honest about the uncertainty either way.
    setLine(
      odResult,
      err?.name === 'AbortError'
        ? 'Cancelled. The browser may keep downloading in the background even so — the toggle stays off until you turn it on again.'
        : `Could not download the language pack: ${err?.message || err}`,
      'bad'
    );
    setPanelState('done');
  } finally {
    if (seq === downloadSeq) downloadController = null;
  }
});

// Turning it on for a pair that needs a download and has no consent yet asks
// first. An already-consented pair (this session or a previous one) turns on
// immediately, same as an already-available pair.
$('onDeviceTranslate').addEventListener('change', () => {
  const toggle = $('onDeviceTranslate');
  if (!toggle.checked) {
    hideConsent();
    return;
  }
  if (lastStatus?.availability !== 'downloadable' || pairConsented()) return;
  toggle.checked = false; // stays off until Continue finishes
  askConsent();
});

$('targetLanguage').addEventListener('change', refreshOnDeviceStatus);
$('secondaryLanguage').addEventListener('change', refreshOnDeviceStatus);
refreshOnDeviceStatus();

/* ------------------------------------------------------------------ save */

function collect() {
  const patch = {};
  for (const [key, prop] of Object.entries(FIELDS)) {
    patch[key] = prop === 'checked' ? $(key).checked : $(key)[prop];
  }
  patch.apiKey = patch.apiKey.trim();
  patch.customInstructions = patch.customInstructions.trim();
  return patch;
}

let statusTimer = null;
function setStatus(text, kind = '') {
  const el = $('status');
  el.textContent = text;
  el.className = 'status ' + kind;
  clearTimeout(statusTimer);
  if (text) statusTimer = setTimeout(() => setStatus(''), 3000);
}

async function save() {
  const patch = collect();
  if (patch.targetLanguage === patch.secondaryLanguage && patch.autoSwapLanguage) {
    setStatus('Target and second language are the same — auto-swap will do nothing.', 'bad');
  }
  await saveSettings(patch);
  if (!$('status').textContent) setStatus('Saved', 'ok');
  return patch;
}

$('save').addEventListener('click', save);

// Ctrl+S / Cmd+S
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save();
  }
});

/* --------------------------------------------------------------- API key */

// Key onboarding (ADR 0001): the copy is shared with the in-page panel via
// lib/onboarding.js. Each step has a screenshot slot that shows the image when
// images/onboarding-N.png ships (#8) and nothing at all when it does not.
$('keyWhy').textContent = WHY_LINE;
$('oneKeyNote').textContent = ONE_KEY_NOTE;
$('keySteps').replaceChildren(
  ...STEPS.map(({ text, screenshot }) => {
    const li = document.createElement('li');
    li.textContent = text;
    const img = document.createElement('img');
    img.alt = '';
    img.hidden = true; // no box, border or broken-image icon until the PNG has actually loaded
    img.addEventListener('load', () => { img.hidden = false; });
    img.addEventListener('error', () => img.remove());
    img.src = chrome.runtime.getURL(screenshot);
    li.appendChild(img);
    return li;
  })
);

$('getKey').addEventListener('click', () => chrome.tabs.create({ url: KEY_PAGE_URL }));

$('toggleKey').addEventListener('click', () => {
  const input = $('apiKey');
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  $('toggleKey').textContent = showing ? 'Show' : 'Hide';
});

/** A status line with an optional inline action (Try again / Cancel). The element's first class is its base. */
function setLine(el, text, kind, action) {
  el.replaceChildren(...(text ? [text] : []));
  el.className = `${el.classList[0]} ${kind}`;
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'link';
    btn.textContent = action.label;
    btn.addEventListener('click', action.onClick);
    el.appendChild(btn);
  }
}
const setKeyStatus = (text, kind = '', action) => setLine($('keyStatus'), text, kind, action);

/**
 * Ask the background to check a key; with `save` it also saves a working key
 * (trimmed) — the one save path shared with the in-page onboarding panel.
 * Resolves to { ok: true } or { ok: false, code, error }; never throws.
 */
async function validateKeyMessage(apiKey, { save = false } = {}) {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'QF_VALIDATE_KEY', apiKey, save });
    return res && typeof res.ok === 'boolean' ? res : { ok: false, code: 'UNKNOWN', error: 'No reply from the extension.' };
  } catch (err) {
    return { ok: false, code: 'UNKNOWN', error: 'Could not reach the extension background worker: ' + err.message };
  }
}

// Validate the moment a key is pasted (or 400 ms after typing stops). Each run
// has a sequence number so a slow reply for an older value cannot overwrite
// the state for the current one. A valid key is saved at once by the worker,
// trimmed, and the model list is refreshed for it.
const VALIDATE_DEBOUNCE_MS = 400;
let validateSeq = 0;
let validateTimer = null;
let pastePending = false;

async function validateCurrentKey() {
  const apiKey = currentKey();
  const seq = ++validateSeq;
  const live = () => seq === validateSeq && currentKey() === apiKey;
  if (!apiKey) {
    setKeyStatus('');
    return;
  }

  setKeyStatus('Checking your key…', 'busy');
  const outcome = await runNeverStuck(() => validateKeyMessage(apiKey, { save: true }), {
    onStillWorking: () => { if (live()) setKeyStatus('Still checking…', 'busy'); }
  });
  if (!live()) return; // superseded by a newer paste or edit

  const tryAgain = { label: 'Try again', onClick: validateCurrentKey };
  if (outcome.status === 'timed-out') {
    setKeyStatus('Checking the key took too long. Check your connection.', 'bad', tryAgain);
    return;
  }
  const res = outcome.status === 'done' ? outcome.value : { ok: false, error: 'Something went wrong.' };
  if (!res.ok) {
    setKeyStatus(res.error, 'bad', tryAgain);
    return;
  }

  setKeyStatus(SUCCESS_LINE, 'ok');
  loadModelsOrNote({ force: true });
}

$('apiKey').addEventListener('paste', () => {
  pastePending = true;
  setTimeout(() => { pastePending = false; }, 0); // the paste's own input event has fired by then, if it ever will
});
$('apiKey').addEventListener('input', () => {
  clearTimeout(validateTimer);
  validateSeq++; // whatever was in flight is for an old value
  const delay = pastePending ? 0 : VALIDATE_DEBOUNCE_MS;
  pastePending = false;
  if (!currentKey()) {
    setKeyStatus('');
    return;
  }
  validateTimer = setTimeout(validateCurrentKey, delay);
});

/* ----------------------------------------------------------------- test */

// Test connection: the key check first, then one real action so the
// thinking-variant diagnostic is preserved — under the never-stuck rules
// (Cancel at 5 s, hard stop at 20 s, a readable line on every outcome).
const setTestResult = (text, kind = '', action) => setLine($('testResult'), text, kind, action);

$('test').addEventListener('click', async () => {
  const patch = await save(); // test what is actually stored

  if (!patch.apiKey) {
    setTestResult('Add an API key first.', 'bad');
    return;
  }

  setTestResult('Checking the key…', 'busy');
  $('test').disabled = true;

  try {
    let cancelOffered = false;
    const outcome = await runNeverStuck(async (signal) => {
      const check = await validateKeyMessage(patch.apiKey);
      if (!check.ok || signal.aborted) return check; // over already; the line says so
      // Once Cancel is on screen it stays there — the Gemini leg is the slow one.
      if (!cancelOffered) setTestResult('Key works — contacting Gemini…', 'busy');
      return chrome.runtime.sendMessage({ type: 'QF_AI', action: 'grammar', text: 'this sentance have a errors in it' });
    }, {
      onStillWorking: (cancel) => {
        cancelOffered = true;
        setTestResult('Still working…', 'busy', { label: 'Cancel', onClick: cancel });
      }
    });

    switch (outcome.status) {
      case 'cancelled':
        setTestResult('Cancelled.', '');
        break;
      case 'timed-out':
        setTestResult('The test took too long — Gemini did not answer within 20 s. Check your connection and try again.', 'bad');
        break;
      case 'failed':
        setTestResult('Could not reach the extension background worker: ' + (outcome.error?.message || outcome.error), 'bad');
        break;
      default: {
        const res = outcome.value;
        if (!res?.ok) {
          setTestResult(res?.error || 'Failed.', 'bad');
          break;
        }
        // Report which thinking setting this model actually accepted. How
        // thinking is configured varies by model and has changed between
        // generations, so knowing which form won is the difference between a
        // fast round trip and the model reasoning at full depth over a typo.
        let variant = '';
        try {
          const stored = await chrome.storage.local.get('thinkingVariants');
          const id = stored?.thinkingVariants?.[patch.model];
          if (id) variant = ` · thinking: ${id}`;
        } catch {
          /* diagnostic only */
        }
        setTestResult(`Working — returned “${res.text.slice(0, 60)}”${variant}`, 'ok');
      }
    }
  } finally {
    $('test').disabled = false;
  }
});

/* ------------------------------------------------------------ shortcuts */

$('shortcuts').addEventListener('click', () => {
  const isEdge = navigator.userAgent.includes('Edg/');
  chrome.tabs.create({
    url: isEdge ? 'edge://extensions/shortcuts' : 'chrome://extensions/shortcuts'
  });
});
