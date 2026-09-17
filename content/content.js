/**
 * Kalam content script.
 *
 * Injected into every frame of every page (manifest: all_frames). It is passive:
 * it registers no key listeners on the page and reads nothing until the user
 * explicitly invokes an action via the browser shortcut, the context menu, or
 * the floating toolbar. At that moment it reads *only* the current selection —
 * or, for a plain <input>/<textarea> with no selection, only that one field.
 * It never walks the rest of the document. (Requirements §5.1, hard requirement.)
 */

(() => {
  'use strict';

  if (window.__quickfixLoaded) return;
  if (!globalThis.chrome?.runtime?.id) return; // sandboxed frame with no extension APIs
  window.__quickfixLoaded = true;

  /* ================================================================ state */

  /** The product name as the user sees it in every message this script shows. */
  const PRODUCT = 'Kalam';

  const settings = {
    targetLanguage: 'Arabic',
    showToolbar: true,
    showIndicator: true
  };

  /** The request in flight, or null when idle. See the run section. */
  let inFlight = null;
  const busy = () => inFlight !== null;

  chrome.storage.local
    .get(['targetLanguage', 'showToolbar', 'showIndicator'])
    .then((s) => Object.assign(settings, dropUndefined(s)))
    .catch(() => {});

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key in settings) settings[key] = newValue;
    }
    if (!settings.showToolbar) UI.hideToolbar();
  });

  function dropUndefined(obj) {
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
  }

  class QfError extends Error {}

  /* ============================================================== helpers */

  /** activeElement, following open shadow roots down to the real focus. */
  function deepActiveElement() {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) {
      el = el.shadowRoot.activeElement;
    }
    return el;
  }

  // Only the types whose selection API Chrome actually supports. Reading
  // selectionStart on type="email" or type="number" throws, and password fields
  // are deliberately excluded.
  const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', '']);

  function isPlainTextField(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') return !el.readOnly && !el.disabled;
    if (el.tagName === 'INPUT') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      return TEXT_INPUT_TYPES.has(type) && !el.readOnly && !el.disabled;
    }
    return false;
  }

  /** Outermost contenteditable ancestor of a node, crossing shadow boundaries. */
  function closestEditableHost(node) {
    let n = node;
    while (n) {
      if (n.nodeType === Node.ELEMENT_NODE && n.isContentEditable) {
        let root = n;
        while (root.parentElement && root.parentElement.isContentEditable) {
          root = root.parentElement;
        }
        return root;
      }
      n = n.parentNode || (n instanceof ShadowRoot ? n.host : null);
    }
    return null;
  }

  /** Selection object for a node — shadow roots keep their own in Chromium. */
  function selectionFor(node) {
    const root = node && node.getRootNode ? node.getRootNode() : document;
    if (root instanceof ShadowRoot && typeof root.getSelection === 'function') {
      const sel = root.getSelection();
      if (sel && sel.rangeCount) return sel;
    }
    return document.getSelection();
  }

  /**
   * Does *this* frame own the keyboard focus? A broadcast shortcut reaches every
   * frame in the tab; exactly one should act on it.
   *
   * document.hasFocus() is also true for ancestor frames of the focused frame,
   * so the extra test is: if our activeElement is itself a frame, the real focus
   * lives deeper and this is not our message.
   */
  function frameOwnsFocus() {
    if (!document.hasFocus()) return false;
    const el = deepActiveElement();
    if (el && (el.tagName === 'IFRAME' || el.tagName === 'FRAME')) return false;
    return true;
  }

  /* ============================================================== capture */

  /**
   * Snapshot what the user has selected, right now.
   * @returns {{kind:'input'|'editable'|'readonly', ...}}
   */
  function captureTarget() {
    const active = deepActiveElement();

    // 1. Plain form field — we can read the exact character range.
    if (isPlainTextField(active)) {
      const value = active.value;
      let start = active.selectionStart;
      let end = active.selectionEnd;

      // No selection: fall back to the whole field. Safe here in a way it is
      // not for contenteditable — an <input>/<textarea> is a single discrete
      // box, so this cannot pull in a quoted email thread. (§5.1)
      if (start === null || end === null || start === end) {
        start = 0;
        end = value.length;
      }

      const text = value.slice(start, end);
      if (!text.trim()) {
        throw new QfError('Select some text first (or type something in this field).');
      }
      return { kind: 'input', el: active, start, end, text, singleLine: active.tagName === 'INPUT' };
    }

    // 2. Anything else — go by the selection.
    const sel = selectionFor(active);
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      throw new QfError(`Select the text you want ${PRODUCT} to work on first.`);
    }

    const range = sel.getRangeAt(0).cloneRange();
    const text = sel.toString();
    if (!text.trim()) {
      throw new QfError(`Select the text you want ${PRODUCT} to work on first.`);
    }

    const host = closestEditableHost(range.commonAncestorContainer);

    // Deliberate: no "whole field" fallback for contenteditable. In Outlook and
    // FreshService the editable box also contains the quoted thread below your
    // reply, and grabbing all of it would break the §5.1 hard requirement.
    if (host) {
      return { kind: 'editable', el: host, range, text, singleLine: false };
    }
    return { kind: 'readonly', el: null, range, text, singleLine: false };
  }

  /* ========================================================== replacement */

  function splitWhitespace(text) {
    const lead = /^\s*/.exec(text)[0];
    const rest = text.slice(lead.length);
    const trail = /\s*$/.exec(rest)[0];
    return { lead, core: rest.slice(0, rest.length - trail.length), trail };
  }

  function setNativeValue(el, value) {
    const proto =
      el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
  }

  function fireInput(el, data) {
    el.dispatchEvent(
      new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data })
    );
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  function replaceInInput(target, out) {
    const { el, start, end, text } = target;

    if (!el.isConnected) throw new QfError('That field has gone from the page — nothing was replaced.');
    if (el.value.slice(start, end) !== text) {
      throw new QfError(`The field changed while ${PRODUCT} was working — nothing was replaced.`);
    }

    el.focus({ preventScroll: true });
    try {
      el.setSelectionRange(start, end);
    } catch {
      /* some inputs refuse setSelectionRange; the fallback below still works */
    }

    // execCommand keeps the page's own undo stack intact, so Ctrl+Z works
    // normally (§4.5) and the page sees real beforeinput/input events.
    const before = el.value;
    const expected = before.slice(0, start) + out + before.slice(end);
    let ok = false;
    try {
      ok = document.execCommand('insertText', false, out);
    } catch {
      ok = false;
    }

    if (!ok || el.value !== expected) {
      setNativeValue(el, expected);
      const caret = start + out.length;
      try {
        el.setSelectionRange(caret, caret);
      } catch {
        /* ignore */
      }
      fireInput(el, out);
    }
  }

  function textToFragment(text) {
    const frag = document.createDocumentFragment();
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (i > 0) frag.appendChild(document.createElement('br'));
      if (line) frag.appendChild(document.createTextNode(line));
    });
    return frag;
  }

  function replaceInEditable(target, out) {
    const { el, range, text } = target;

    if (!el.isConnected) throw new QfError('That editor has gone from the page — nothing was replaced.');

    el.focus({ preventScroll: true });
    const sel = selectionFor(el);
    try {
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {
      throw new QfError('Lost the selection — try again.');
    }

    // Re-check via sel.toString() — the same call captureTarget() used to get
    // `text` in the first place. Comparing against range.toString() instead
    // used to false-positive on any multi-paragraph selection: Range.toString()
    // is spec'd to just concatenate text-node data with no awareness of block
    // boundaries, while Selection.toString() inserts line breaks between
    // paragraphs, so the two disagreed even when nothing on the page changed.
    let current = '';
    try {
      current = sel.toString();
    } catch {
      current = '';
    }
    if (current !== text) {
      throw new QfError(`The text changed while ${PRODUCT} was working — nothing was replaced.`);
    }

    let ok = false;
    try {
      ok = document.execCommand('insertText', false, out);
    } catch {
      ok = false;
    }

    if (!ok) {
      // Manual DOM replacement, then tell the host app about it ourselves.
      range.deleteContents();
      const frag = textToFragment(out);
      const last = frag.lastChild;
      range.insertNode(frag);
      if (last) {
        const after = document.createRange();
        after.setStartAfter(last);
        after.collapse(true);
        sel.removeAllRanges();
        sel.addRange(after);
      }
      fireInput(el, out);
    }
  }

  /* ================================================================== run */

  // Never-stuck rules (ADR 0004): at 5 s the indicator offers Cancel; at 20 s
  // the action hard-stops. The provider already gives up at 20 s, so this
  // guard exists for the case where the worker dies and no reply ever comes.
  // It fires at exactly 20 s rather than 20 s plus a margin: the page's clock
  // starts before the worker's, both roads end in the same bubble, and a
  // provider TIMEOUT that lands afterwards is dropped as a stale reply.
  const CANCEL_AFTER_MS = 5000;
  const HARD_STOP_MS = 20000;

  /**
   * A request walks
   *   working → working-with-cancel (5 s) → done | failed | cancelled | timed-out (20 s)
   * `inFlight` holds it while it is in either working state; `settle` leaves
   * them and the outcome decides what the user sees (a replacement and a flash,
   * a bubble, or nothing for a Cancel they chose). Each request has an id; a
   * reply for any other id is dropped, and so is a reply that lands after the
   * request was settled.
   */
  let requestSeq = 0;
  const isLive = (req) => inFlight === req;

  const LABELS = {
    grammar: { working: 'Fixing…', done: 'Fixed' },
    translate: { working: 'Translating…', done: 'Translated' }
  };

  function run(action) {
    if (busy()) return;

    let target;
    try {
      target = captureTarget();
    } catch (err) {
      // Nothing captured, so nothing to retry: the user's next selection is the retry.
      UI.bubble({ message: err.message, kind: 'warn' });
      return;
    }
    execute(action, target);
  }

  /** Run `action` on an already-captured target. */
  async function execute(action, target) {
    if (busy()) return;

    const { lead, core, trail } = splitWhitespace(target.text);
    if (!core) {
      UI.bubble({ rect: anchorRect(target), message: 'Select some actual text first.', kind: 'warn' });
      return;
    }

    UI.hideToolbar();
    UI.hideBubble();
    const req = { id: ++requestSeq, action, target, cancelTimer: null, stopTimer: null };
    const labels = LABELS[action] || LABELS.grammar;
    inFlight = req;
    UI.indicator(anchorRect(target), labels.working);
    req.cancelTimer = setTimeout(() => {
      UI.indicatorWithCancel(anchorRect(target), 'Still working…', () => settle(req));
    }, CANCEL_AFTER_MS);
    req.stopTimer = setTimeout(() => timeOut(req), HARD_STOP_MS);

    let res;
    try {
      res = await sendToBackground({ type: 'QF_AI', id: req.id, action, text: core });
    } catch (err) {
      if (!isLive(req)) return;
      return fail(req, err.message);
    }
    if (!isLive(req)) return; // cancelled or timed out while we waited
    if (!res) return fail(req, `No response from ${PRODUCT}. Try reloading the page.`);
    if (res.id !== req.id) return; // a reply for some other request
    if (!res.ok) return fail(req, res.error || 'Something went wrong.', res.code);

    try {
      // Re-attach the exact whitespace the user had selected, so we do not eat
      // the leading space or the trailing newline of their selection.
      let out = lead + res.text + trail;
      if (target.singleLine) out = out.replace(/\s*\n+\s*/g, ' ');

      if (target.kind === 'input') replaceInInput(target, out);
      else if (target.kind === 'editable') replaceInEditable(target, out);
      else UI.result(anchorRect(target), out); // not editable — offer it to copy
    } catch (err) {
      return fail(req, err instanceof QfError ? err.message : `${PRODUCT} failed: ${err?.message || err}`);
    }

    settle(req);
    if (target.kind !== 'readonly') {
      UI.flash(labels.done + (res.via === 'on-device' ? ' · on-device' : ''));
    }
  }

  /** Leave the working states: stop the timers, clear busy, hide the indicator. */
  function settle(req) {
    if (!isLive(req)) return;
    clearTimeout(req.cancelTimer);
    clearTimeout(req.stopTimer);
    inFlight = null;
    UI.hideIndicator();
  }

  function timeOut(req) {
    fail(req, `${PRODUCT} took too long to respond.`, 'TIMEOUT');
  }

  function fail(req, message, code) {
    settle(req);
    showFailure(req, message, code);
  }

  // Failures about the key or the model are fixed in settings, so the bubble
  // offers the way there.
  const SETTINGS_CODES = new Set(['NO_API_KEY', 'BAD_KEY', 'BAD_MODEL']);

  /** Every failure ends in a bubble: the message, Retry on the same target, and Open settings when that is the fix. */
  function showFailure(req, message, code) {
    UI.bubble({
      rect: anchorRect(req.target),
      message,
      kind: 'error',
      onRetry: () => execute(req.action, req.target),
      withSettingsLink: SETTINGS_CODES.has(code)
    });
  }

  function sendToBackground(msg) {
    if (!chrome.runtime?.id) {
      throw new QfError(`${PRODUCT} was reloaded — refresh this page to use it again.`);
    }
    return chrome.runtime.sendMessage(msg).catch(() => {
      throw new QfError(`${PRODUCT} was reloaded — refresh this page to use it again.`);
    });
  }

  function anchorRect(target) {
    try {
      if (target.kind === 'input') {
        return target.el.getBoundingClientRect();
      }
      const r = target.range.getBoundingClientRect();
      if (r && (r.width || r.height)) return r;
    } catch {
      /* fall through */
    }
    return { left: 16, top: 16, right: 216, bottom: 56, width: 200, height: 40 };
  }

  /* =================================================================== UI */

  const UI = (() => {
    let host = null;
    let root = null;
    let indicatorEl = null;
    let bubbleEl = null;
    let bubbleTimer = null;
    let barEl = null;
    let panelEl = null;

    const CSS = `
      :host { all: initial; }
      .layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;
               font: 500 13px/1.45 -apple-system, "Segoe UI", system-ui, sans-serif; }
      .card { position: absolute; pointer-events: auto; box-sizing: border-box;
              background: #ffffff; color: #111827; border: 1px solid #d8dbe2;
              border-radius: 10px; box-shadow: 0 6px 24px rgba(15,23,42,.18);
              padding: 8px 12px; max-width: min(420px, 90vw); }
      .card.error { border-color: #fca5a5; background: #fef2f2; color: #7f1d1d; }
      .card.warn  { border-color: #fcd34d; background: #fffbeb; color: #78350f; }
      .card.ok    { border-color: #86efac; background: #f0fdf4; color: #14532d; }
      .row { display: flex; align-items: center; gap: 8px; }
      .msg { white-space: pre-wrap; overflow-wrap: anywhere; }
      .spin { width: 13px; height: 13px; flex: none; border-radius: 50%;
              border: 2px solid #c7d2fe; border-top-color: #4f46e5;
              animation: qfspin .7s linear infinite; }
      @keyframes qfspin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) { .spin { animation-duration: 2s; } }

      .bar { position: absolute; pointer-events: auto; display: flex; gap: 2px;
             background: #111827; border-radius: 9px; padding: 3px;
             box-shadow: 0 6px 20px rgba(15,23,42,.3); }
      .bar button { all: unset; cursor: pointer; color: #e5e7eb; font: inherit;
                    padding: 5px 10px; border-radius: 6px; white-space: nowrap; }
      .bar button:hover { background: #374151; color: #fff; }
      .bar .sep { width: 1px; background: #374151; margin: 4px 1px; }

      .panel .head { display: flex; align-items: center; justify-content: space-between;
                     gap: 12px; margin-bottom: 6px; font-size: 11px;
                     text-transform: uppercase; letter-spacing: .05em; color: #6b7280; }
      .panel .out { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 40vh;
                    overflow: auto; user-select: text; }
      .panel .acts { display: flex; gap: 6px; margin-top: 8px; }
      .panel button, .card button.link { all: unset; cursor: pointer; font: inherit;
                    font-size: 12px; padding: 4px 9px; border-radius: 6px;
                    background: #4f46e5; color: #fff; }
      .card button.link { background: transparent; color: inherit;
                          text-decoration: underline; padding: 0 2px; }

      @media (prefers-color-scheme: dark) {
        .card { background: #1f2937; color: #f3f4f6; border-color: #374151; }
        .card.error { background: #3f1d1d; color: #fecaca; border-color: #7f1d1d; }
        .card.warn  { background: #422006; color: #fde68a; border-color: #78350f; }
        .card.ok    { background: #052e16; color: #bbf7d0; border-color: #14532d; }
        .panel .head { color: #9ca3af; }
      }
    `;

    function ensure() {
      if (root && host.isConnected) return root;
      host = document.createElement('div');
      host.setAttribute('data-quickfix', '');
      // The host itself must not disturb the page's own layout.
      host.style.cssText = 'all:initial;position:static;';
      root = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = CSS;
      const layer = document.createElement('div');
      layer.className = 'layer';
      root.append(style, layer);
      (document.body || document.documentElement).appendChild(host);
      root.layer = layer;
      return root;
    }

    /** Position a floating element near a viewport rect, kept fully on screen. */
    function place(el, rect, gap = 8) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      el.style.visibility = 'hidden';
      el.style.left = '0px';
      el.style.top = '0px';
      const box = el.getBoundingClientRect();

      let top = rect.bottom + gap;
      if (top + box.height > vh - 8) top = Math.max(8, rect.top - box.height - gap);
      let left = rect.left;
      if (left + box.width > vw - 8) left = Math.max(8, vw - box.width - 8);

      el.style.left = Math.round(left) + 'px';
      el.style.top = Math.round(Math.min(Math.max(8, top), vh - box.height - 8)) + 'px';
      el.style.visibility = 'visible';
    }

    /** The working state: a spinner and a label. Hidden by the showIndicator setting. */
    function indicator(rect, label) {
      if (!settings.showIndicator) return;
      renderIndicator(rect, label);
    }

    /**
     * The working-with-cancel state. Shown regardless of showIndicator: the
     * setting hides progress, not the way out of a stuck action.
     */
    function indicatorWithCancel(rect, label, onCancel) {
      renderIndicator(rect, label);
      indicatorEl.querySelector('.row').appendChild(actionButton('Cancel', onCancel));
      place(indicatorEl, rect);
    }

    function renderIndicator(rect, label) {
      hideIndicator();
      const r = ensure();
      indicatorEl = document.createElement('div');
      indicatorEl.className = 'card';
      indicatorEl.innerHTML = '<div class="row"><span class="spin"></span><span class="msg"></span></div>';
      indicatorEl.querySelector('.msg').textContent = label;
      r.layer.appendChild(indicatorEl);
      place(indicatorEl, rect);
    }

    function hideIndicator() {
      indicatorEl?.remove();
      indicatorEl = null;
    }

    /**
     * The bubble: where every message to the user lands. A failure bubble
     * stays until the user dismisses it (Escape, a click on it, a scroll) or
     * starts a new action — a message that expires before you look back at
     * the page reads as "it just did nothing". Only a success flash is
     * short-lived (`life`).
     */
    function bubble({ rect, message, kind = 'error', onRetry = null, withSettingsLink = false, life = 0 }) {
      hideBubble();
      const r = ensure();
      bubbleEl = document.createElement('div');
      bubbleEl.className = 'card ' + kind;
      const row = document.createElement('div');
      row.className = 'row';
      const msg = document.createElement('span');
      msg.className = 'msg';
      msg.textContent = message;
      row.appendChild(msg);
      if (onRetry) row.appendChild(bubbleButton('Retry', onRetry));
      if (withSettingsLink) {
        row.appendChild(bubbleButton('Open settings', () => {
          chrome.runtime.sendMessage({ type: 'QF_OPEN_OPTIONS' }).catch(() => {});
        }));
      }
      bubbleEl.appendChild(row);
      bubbleEl.addEventListener('click', hideBubble);
      r.layer.appendChild(bubbleEl);
      place(bubbleEl, rect || nearSelection());
      if (life) bubbleTimer = setTimeout(hideBubble, life);
    }

    /** A button inside an indicator or bubble. Pressing it must not steal the page's selection. */
    function actionButton(label, onClick) {
      const btn = document.createElement('button');
      btn.className = 'link';
      btn.textContent = label;
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', onClick);
      return btn;
    }

    /** A bubble action: dismisses the bubble first, so a message the action shows itself survives. */
    function bubbleButton(label, fn) {
      return actionButton(label, (e) => {
        e.stopPropagation();
        hideBubble();
        fn();
      });
    }

    /** Where to put a message that has no captured target: by the selection, else the focused element. */
    function nearSelection() {
      const sel = document.getSelection();
      let rect = { left: 16, top: 16, bottom: 56, right: 216, width: 200, height: 40 };
      try {
        if (sel && sel.rangeCount && !sel.isCollapsed) {
          const b = sel.getRangeAt(0).getBoundingClientRect();
          if (b.width || b.height) rect = b;
        } else {
          const el = deepActiveElement();
          if (el && el.getBoundingClientRect) rect = el.getBoundingClientRect();
        }
      } catch {
        /* keep default */
      }
      return rect;
    }

    function flash(message) {
      bubble({ message, kind: 'ok', life: 1400 });
    }

    function hideBubble() {
      clearTimeout(bubbleTimer);
      bubbleEl?.remove();
      bubbleEl = null;
    }

    function result(rect, text) {
      hidePanel();
      const r = ensure();
      panelEl = document.createElement('div');
      panelEl.className = 'card panel';
      panelEl.innerHTML =
        `<div class="head"><span>${PRODUCT} — read-only selection</span></div>` +
        '<div class="out"></div>' +
        '<div class="acts"><button class="copy">Copy</button><button class="close">Close</button></div>';
      panelEl.querySelector('.out').textContent = text;
      panelEl.querySelector('.copy').addEventListener('click', async (e) => {
        try {
          await navigator.clipboard.writeText(text);
          e.target.textContent = 'Copied';
        } catch {
          e.target.textContent = 'Copy failed';
        }
      });
      panelEl.querySelector('.close').addEventListener('click', hidePanel);
      r.layer.appendChild(panelEl);
      place(panelEl, rect);
    }

    function hidePanel() {
      panelEl?.remove();
      panelEl = null;
    }

    function showToolbar(rect) {
      hideToolbar();
      const r = ensure();
      barEl = document.createElement('div');
      barEl.className = 'bar';

      const fix = document.createElement('button');
      fix.textContent = 'Fix grammar';
      fix.title = 'Fix grammar (Alt+G)';

      const sep = document.createElement('span');
      sep.className = 'sep';

      const tr = document.createElement('button');
      tr.textContent = 'Translate';
      tr.title = `Translate to ${settings.targetLanguage} (Alt+T)`;

      // Do not let the click steal the selection out from under us.
      barEl.addEventListener('mousedown', (e) => e.preventDefault());
      fix.addEventListener('click', () => run('grammar'));
      tr.addEventListener('click', () => run('translate'));

      barEl.append(fix, sep, tr);
      r.layer.appendChild(barEl);
      place(barEl, rect, 6);
    }

    function hideToolbar() {
      barEl?.remove();
      barEl = null;
    }

    return {
      indicator, indicatorWithCancel, hideIndicator,
      bubble, hideBubble, flash, result, hidePanel, showToolbar, hideToolbar
    };
  })();

  /* ====================================================== floating toolbar */

  let toolbarTimer = null;

  function maybeShowToolbar() {
    if (!settings.showToolbar || busy()) return;

    const active = deepActiveElement();

    // Plain form fields: only when there is a real selection inside them.
    if (isPlainTextField(active)) {
      if (active.selectionStart === active.selectionEnd) return UI.hideToolbar();
      const text = active.value.slice(active.selectionStart, active.selectionEnd);
      if (!text.trim()) return UI.hideToolbar();
      return UI.showToolbar(active.getBoundingClientRect());
    }

    const sel = selectionFor(active);
    if (!sel || !sel.rangeCount || sel.isCollapsed || !sel.toString().trim()) {
      return UI.hideToolbar();
    }
    if (!closestEditableHost(sel.getRangeAt(0).commonAncestorContainer)) {
      // Read-only selection: no inline replacement possible, so no toolbar.
      // The right-click menu still works and shows a copyable result.
      return UI.hideToolbar();
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) return UI.hideToolbar();
    UI.showToolbar(rect);
  }

  function scheduleToolbar() {
    clearTimeout(toolbarTimer);
    toolbarTimer = setTimeout(maybeShowToolbar, 180);
  }

  document.addEventListener('mouseup', scheduleToolbar, true);
  document.addEventListener('keyup', (e) => {
    if (e.shiftKey || e.key === 'Escape' || e.ctrlKey || e.metaKey) scheduleToolbar();
  }, true);
  document.addEventListener('mousedown', (e) => {
    if (!e.target || !e.target.closest || !e.target.closest('[data-quickfix]')) UI.hideToolbar();
  }, true);
  document.addEventListener('scroll', () => { UI.hideToolbar(); UI.hideBubble(); }, true);
  window.addEventListener('blur', () => UI.hideToolbar());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { UI.hideToolbar(); UI.hideBubble(); UI.hidePanel(); }
  }, true);

  /* ============================================================= messaging */

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'QF_RUN') return false;

    // A shortcut is broadcast to every frame; only the focused one responds.
    // A context-menu click is addressed to one frame already.
    if (msg.source === 'shortcut' && !frameOwnsFocus()) return false;

    run(msg.action);
    sendResponse({ handled: true });
    return false;
  });
})();
