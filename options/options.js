import { DEFAULTS, MODELS, TONES, LANGUAGES, getSettings, saveSettings, recommendedModel } from '../lib/config.js';

const $ = (id) => document.getElementById(id);

const FIELDS = {
  apiKey: 'value',
  model: 'value',
  targetLanguage: 'value',
  secondaryLanguage: 'value',
  autoSwapLanguage: 'checked',
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
async function loadModels({ force = false } = {}) {
  const picker = $('model');
  const wanted = picker.value || settings.model;
  $('refreshModels').disabled = true;
  setModelsNote(force ? 'Refreshing…' : 'Loading the model list…');

  try {
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'QF_LIST_MODELS', force });
    } catch {
      res = null;
    }
    const { models, fetchedAt, source } = res?.ok ? res : { models: MODELS, fetchedAt: null, source: 'fallback' };

    fillSelect(picker, models.map((m) => ({ id: m.id, label: labelWithRecommended(m) })));
    const stillOffered = models.some((m) => m.id === wanted);
    picker.value = stillOffered ? wanted : recommendedModel(models).id;

    const when = source === 'live'
      ? `Updated ${relativeTime(fetchedAt)}.`
      : $('apiKey').value.trim() ? 'Built-in list — could not reach Gemini.' : 'Built-in list — add an API key to load the live list.';
    setModelsNote(stillOffered ? when : `${when} Your saved model (${wanted}) is no longer available; the recommended one is selected — save to keep it.`, !stillOffered);
  } finally {
    $('refreshModels').disabled = false;
  }
}

function labelWithRecommended(m) {
  return m.recommended && !/recommended/i.test(m.label) ? `${m.label} — recommended` : m.label;
}

function setModelsNote(text, warn = false) {
  const el = $('modelsNote');
  el.textContent = text;
  el.className = 'hint' + (warn ? ' bad' : '');
}

function relativeTime(ts) {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return `${hours} h ago`;
}

// Refresh saves first, like Test, so a key pasted moments ago is the one used.
$('refreshModels').addEventListener('click', async () => {
  await save();
  await loadModels({ force: true });
});
loadModels().catch((err) => setModelsNote('Could not load the model list: ' + err.message, true));

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

$('toggleKey').addEventListener('click', () => {
  const input = $('apiKey');
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  $('toggleKey').textContent = showing ? 'Show' : 'Hide';
});

/* ----------------------------------------------------------------- test */

$('test').addEventListener('click', async () => {
  const result = $('testResult');
  const patch = await save(); // test what is actually stored

  if (!patch.apiKey) {
    result.textContent = 'Add an API key first.';
    result.className = 'test-result bad';
    return;
  }

  result.textContent = 'Contacting Gemini…';
  result.className = 'test-result busy';
  $('test').disabled = true;

  try {
    const res = await chrome.runtime.sendMessage({
      type: 'QF_AI',
      action: 'grammar',
      text: 'this sentance have a errors in it'
    });
    if (res?.ok) {
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
      result.textContent = `Working — returned “${res.text.slice(0, 60)}”${variant}`;
      result.className = 'test-result ok';
    } else {
      result.textContent = res?.error || 'Failed.';
      result.className = 'test-result bad';
    }
  } catch (err) {
    result.textContent = 'Could not reach the extension background worker: ' + err.message;
    result.className = 'test-result bad';
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
