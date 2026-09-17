import { DEFAULTS, MODELS, TONES, LANGUAGES, getSettings, saveSettings, recommendedModel } from '../lib/config.js';
import { KEY_PAGE_URL, WHY_LINE, STEPS, ONE_KEY_NOTE, SUCCESS_LINE } from '../lib/onboarding.js';
import { runNeverStuck } from '../lib/never-stuck.js';

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
// the current pair can't do it; a plain confirm() when it can but needs a
// download first (the full consent flow with size/progress is #10). The pair
// is always secondary → target — the direction auto-swap produces.
let onDeviceSeq = 0;
let lastStatus = null;

async function refreshOnDeviceStatus() {
  const toggle = $('onDeviceTranslate');
  const seq = ++onDeviceSeq;
  setOnDeviceNote('Checking this browser…');

  let status;
  try {
    status = await chrome.runtime.sendMessage({
      type: 'QF_ON_DEVICE_STATUS',
      sourceLanguage: $('secondaryLanguage').value,
      targetLanguage: $('targetLanguage').value
    });
  } catch {
    status = null;
  }
  if (seq !== onDeviceSeq) return; // superseded by a newer language change
  if (!status || typeof status.supported !== 'boolean') {
    lastStatus = null;
    toggle.disabled = true;
    setOnDeviceNote('Could not check this browser for on-device support.', true);
    return;
  }

  // Disabling greys the control out, but the saved value is left alone: a
  // pair that stops being offered because of a language change should not
  // silently erase the user's setting, since runAction falls back to Gemini
  // on its own whenever the pair is unavailable.
  lastStatus = status;
  toggle.disabled = !status.supported;
  setOnDeviceNote(status.reason || '', !status.supported);
}

const setOnDeviceNote = (text, warn) => setHint('onDeviceNote', text, warn);

// Turning it on when the pack isn't downloaded yet asks first, with the size
// (#10 is the full consent + progress + cancel flow; this is the minimal
// stand-in the spec asks for). Declining leaves the toggle off.
$('onDeviceTranslate').addEventListener('change', () => {
  const toggle = $('onDeviceTranslate');
  if (!toggle.checked || lastStatus?.availability !== 'downloadable') return;
  const target = $('targetLanguage').value;
  const ok = confirm(`This will download a language pack for ${target}. Continue?`);
  if (!ok) toggle.checked = false;
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
