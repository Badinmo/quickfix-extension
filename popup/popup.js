import { LANGUAGES, getSettings, saveSettings } from '../lib/config.js';

const settings = await getSettings();

const state = document.getElementById('keyState');
if (settings.apiKey) {
  state.textContent = `Ready — ${settings.model}`;
  state.className = 'state ok';
} else {
  state.textContent = 'No API key set. Open Settings to add one.';
  state.className = 'state bad';
}

const select = document.getElementById('targetLanguage');
select.replaceChildren(
  ...LANGUAGES.map((l) => {
    const opt = document.createElement('option');
    opt.value = l;
    opt.textContent = l;
    opt.selected = l === settings.targetLanguage;
    return opt;
  })
);

select.addEventListener('change', () => {
  saveSettings({ targetLanguage: select.value });
});

document.getElementById('options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
