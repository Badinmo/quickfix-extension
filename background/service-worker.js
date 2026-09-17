/**
 * Background service worker.
 *
 * Responsibilities:
 *  - own the keyboard commands and the context menu
 *  - route an action to the right frame of the active tab
 *  - make the Gemini call (content scripts never do — see lib/ai.js header)
 *
 * It never asks a tab for page content. The only text it ever sees is what the
 * content script explicitly sends after the user invoked an action on their own
 * selection (requirements §5.1, hard requirement).
 */

import { getSettings, saveSettings } from '../lib/config.js';
import { runAction, listModels, validateKey, AiError } from '../lib/ai.js';
import { onDeviceStatus } from '../lib/on-device.js';
import { KEY_PAGE_URL, WHY_LINE, STEPS, ONE_KEY_NOTE, SUCCESS_LINE } from '../lib/onboarding.js';

const MENU_ROOT = 'qf-root';
const MENU_GRAMMAR = 'qf-grammar';
const MENU_TRANSLATE = 'qf-translate';

/* ------------------------------------------------------------------ menus */

async function buildMenus() {
  const { targetLanguage } = await getSettings();

  await chrome.contextMenus.removeAll();

  chrome.contextMenus.create({
    id: MENU_ROOT,
    title: 'Kalam',
    contexts: ['selection', 'editable']
  });
  chrome.contextMenus.create({
    id: MENU_GRAMMAR,
    parentId: MENU_ROOT,
    title: 'Fix grammar',
    contexts: ['selection', 'editable']
  });
  chrome.contextMenus.create({
    id: MENU_TRANSLATE,
    parentId: MENU_ROOT,
    title: `Translate to ${targetLanguage}`,
    contexts: ['selection', 'editable']
  });
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await buildMenus();
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onStartup.addListener(() => {
  buildMenus();
});

// Keep the menu label in step with the configured language.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.targetLanguage) {
    buildMenus();
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  const action =
    info.menuItemId === MENU_TRANSLATE
      ? 'translate'
      : info.menuItemId === MENU_GRAMMAR
        ? 'grammar'
        : null;
  if (!action) return;

  // The context menu tells us exactly which frame was right-clicked, so we can
  // target it directly instead of broadcasting.
  send(tab.id, { type: 'QF_RUN', action, source: 'menu' }, { frameId: info.frameId ?? 0 });
});

/* -------------------------------------------------------------- shortcuts */

chrome.commands.onCommand.addListener(async (command) => {
  const action = command === 'translate' ? 'translate' : 'grammar';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  // Broadcast to every frame. Only the frame that currently owns focus answers;
  // the rest ignore it (see content.js → frameOwnsFocus).
  send(tab.id, { type: 'QF_RUN', action, source: 'shortcut' });
});

/**
 * chrome.tabs.sendMessage rejects on restricted pages (chrome://, the web
 * store, PDF viewer) and when no frame answers. Neither is worth an exception
 * in the console, but the user deserves a hint that nothing happened.
 */
function send(tabId, message, options) {
  chrome.tabs.sendMessage(tabId, message, options || {}).catch(() => {
    flashBadge();
  });
}

let badgeTimer = null;
function flashBadge() {
  chrome.action.setBadgeBackgroundColor({ color: '#b91c1c' });
  chrome.action.setBadgeText({ text: '!' });
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2500);
}

/* --------------------------------------------------------------- messages */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'QF_AI') {
    handleAi(msg).then(sendResponse);
    return true; // async
  }

  if (msg?.type === 'QF_LIST_MODELS') {
    handleListModels(msg).then(sendResponse);
    return true; // async
  }

  if (msg?.type === 'QF_VALIDATE_KEY') {
    handleValidateKey(msg).then(sendResponse);
    return true; // async
  }

  if (msg?.type === 'QF_ON_DEVICE_STATUS') {
    handleOnDeviceStatus(msg).then(sendResponse);
    return true; // async
  }

  if (msg?.type === 'QF_OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }

  // The in-page onboarding panel: a content script can import no module and
  // open no tab, so the worker hands it the copy and opens the key page.
  if (msg?.type === 'QF_ONBOARDING_COPY') {
    sendResponse({ ok: true, copy: onboardingCopy() });
    return false;
  }

  if (msg?.type === 'QF_OPEN_KEY_PAGE') {
    chrome.tabs.create({ url: KEY_PAGE_URL });
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

/** The onboarding copy from lib/onboarding.js, with each screenshot path resolved to a URL a page can load. */
function onboardingCopy() {
  return {
    whyLine: WHY_LINE,
    steps: STEPS.map(({ text, screenshot }) => ({ text, screenshotUrl: chrome.runtime.getURL(screenshot) })),
    oneKeyNote: ONE_KEY_NOTE,
    successLine: SUCCESS_LINE
  };
}

/**
 * The reply echoes the request's `id` so the content script can drop a reply
 * that belongs to a request it has since cancelled or timed out.
 */
async function handleAi(msg) {
  const id = msg.id;
  try {
    const settings = await getSettings();
    const { text, via } = await runAction(msg.action, msg.text, settings);
    return { ok: true, id, text, via };
  } catch (err) {
    if (err instanceof AiError) {
      return { ok: false, id, code: err.code, error: err.message };
    }
    console.error('[Kalam]', err);
    return { ok: false, id, code: 'UNKNOWN', error: 'Something went wrong: ' + (err?.message || err) };
  }
}

/**
 * The live model list for the options page (ADR 0004). `force` bypasses the
 * 24 h cache — the Refresh models button. `apiKey` lists models for a key the
 * page holds but has not saved yet. listModels never throws for a failed
 * fetch (it falls back to the built-in list), so an error here is a genuine
 * bug, not an offline user.
 */
async function handleListModels(msg) {
  try {
    const settings = await getSettings();
    const { models, fetchedAt, source } = await listModels(settings, {
      force: Boolean(msg.force),
      apiKey: typeof msg.apiKey === 'string' ? msg.apiKey : undefined
    });
    return { ok: true, models, fetchedAt, source };
  } catch (err) {
    console.error('[Kalam]', err);
    return { ok: false, error: 'Could not load the model list: ' + (err?.message || err) };
  }
}

/**
 * Feature detection for the options page's on-device toggle (ADR 0003):
 * is the browser's built-in Translator there, does it offer this pair, does
 * it need a download first. `onDeviceStatus` never rejects, so this is the
 * whole handler — no try/catch to normalise, unlike the other handlers here.
 */
async function handleOnDeviceStatus(msg) {
  return onDeviceStatus({ sourceLanguage: msg.sourceLanguage, targetLanguage: msg.targetLanguage });
}

/**
 * Key onboarding (ADR 0001): check a key the moment it is pasted. The key
 * travels in the message because it may not be saved yet. Only extension
 * pages and the content script can send runtime messages, never a web page.
 * With `save: true` a working key is saved here, trimmed, so the options
 * page and the in-page panel share one save.
 */
async function handleValidateKey(msg) {
  const apiKey = String(msg.apiKey || '').trim();
  try {
    await validateKey(apiKey);
  } catch (err) {
    if (err instanceof AiError) {
      return { ok: false, code: err.code, error: err.message };
    }
    console.error('[Kalam]', err);
    return { ok: false, code: 'UNKNOWN', error: 'Something went wrong: ' + (err?.message || err) };
  }
  if (msg.save === true) {
    try {
      await saveSettings({ apiKey });
    } catch (err) {
      console.error('[Kalam]', err);
      return { ok: false, code: 'SAVE_FAILED', error: 'The key works but could not be saved: ' + (err?.message || err) };
    }
  }
  return { ok: true };
}
