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

import { getSettings } from '../lib/config.js';
import { runAction, AiError } from '../lib/ai.js';

const MENU_ROOT = 'qf-root';
const MENU_GRAMMAR = 'qf-grammar';
const MENU_TRANSLATE = 'qf-translate';

/* ------------------------------------------------------------------ menus */

async function buildMenus() {
  const { targetLanguage } = await getSettings();

  await chrome.contextMenus.removeAll();

  chrome.contextMenus.create({
    id: MENU_ROOT,
    title: 'QuickFix',
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

  if (msg?.type === 'QF_OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

async function handleAi(msg) {
  try {
    const settings = await getSettings();
    const text = await runAction(msg.action, msg.text, settings);
    return { ok: true, text };
  } catch (err) {
    if (err instanceof AiError) {
      return { ok: false, code: err.code, error: err.message };
    }
    console.error('[QuickFix]', err);
    return { ok: false, code: 'UNKNOWN', error: 'Something went wrong: ' + (err?.message || err) };
  }
}
