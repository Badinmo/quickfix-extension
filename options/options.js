import { DEFAULTS, MODELS, TONES, LANGUAGES, getSettings, saveSettings } from '../lib/config.js';

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
      result.textContent = `Working — returned “${res.text.slice(0, 60)}”`;
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
