/**
 * Kalima content script.
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
  const PRODUCT = 'Kalima';

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

  /**
   * Coach and Template never write, so neither goes through replaceInInput/
   * replaceInEditable — but both must refuse just as those would when the
   * field or selection has changed since it was captured. Mirrors their
   * comparisons rather than sharing code with them: those two also carry
   * the write itself, and re-shaping them around a check-only caller risked
   * changing the order they focus and re-select in ahead of an actual write.
   */
  function assertStillFresh(target) {
    if (target.kind === 'input') {
      if (!target.el.isConnected) throw new QfError('That field has gone from the page — nothing was replaced.');
      if (target.el.value.slice(target.start, target.end) !== target.text) {
        throw new QfError(`The field changed while ${PRODUCT} was working — nothing was replaced.`);
      }
      return;
    }
    if (target.kind === 'editable') {
      if (!target.el.isConnected) throw new QfError('That editor has gone from the page — nothing was replaced.');
      const sel = selectionFor(target.el);
      try {
        sel.removeAllRanges();
        sel.addRange(target.range);
      } catch {
        throw new QfError('Lost the selection — try again.');
      }
      let current = '';
      try {
        current = sel.toString();
      } catch {
        current = '';
      }
      if (current !== target.text) {
        throw new QfError(`The text changed while ${PRODUCT} was working — nothing was replaced.`);
      }
    }
    // read-only: nothing on the page to go stale
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
    translate: { working: 'Translating…', done: 'Translated' },
    coach: { working: 'Coaching…' }, // never written to a field, so there is no "done" flash
    template: { working: 'Finding fields…' } // never written to a field either
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

    // Reusing someone else's words as a personal template doesn't make sense
    // (#17). The toolbar already never offers Template here (it never
    // renders at all for a read-only selection) — this guard is the
    // "disabled" half of that same rule, so the behaviour holds no matter
    // how the action is invoked, not only from the circle that is already
    // absent, and stays true even if a future entry point (context menu,
    // shortcut) ever sends 'template' too.
    if (action === 'template' && target.kind === 'readonly') {
      UI.bubble({ rect: anchorRect(target), message: 'Select text you can edit to save it as a template.', kind: 'warn' });
      return;
    }

    const { lead, core, trail } = splitWhitespace(target.text);
    if (!core) {
      UI.bubble({ rect: anchorRect(target), message: 'Select some actual text first.', kind: 'warn' });
      return;
    }

    UI.hideToolbar();
    UI.hideBubble();
    UI.hideOnboarding(); // a new action replaces the pending one the panel was holding
    UI.hideCoachPanel();
    UI.hideTemplatePanel();
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
      if (action === 'coach') {
        assertStillFresh(target);
        UI.coachPanel({
          rect: anchorRect(target),
          text: core, // the exact text sent to Gemini — spans are offsets into this, not target.text
          payload: parseCoachResult(res.text),
          onFix: () => { UI.hideCoachPanel(); execute('grammar', target); },
          onDismiss: () => UI.hideCoachPanel()
        });
      } else if (action === 'template') {
        assertStillFresh(target);
        showTemplatePreview(target, core, res.fields || []);
      } else {
        // Re-attach the exact whitespace the user had selected, so we do not eat
        // the leading space or the trailing newline of their selection.
        let out = lead + res.text + trail;
        if (target.singleLine) out = out.replace(/\s*\n+\s*/g, ' ');

        if (target.kind === 'input') replaceInInput(target, out);
        else if (target.kind === 'editable') replaceInEditable(target, out);
        else UI.result(anchorRect(target), out); // not editable — offer it to copy
      }
    } catch (err) {
      return fail(req, err instanceof QfError ? err.message : `${PRODUCT} failed: ${err?.message || err}`);
    }

    settle(req);
    if (action !== 'coach' && action !== 'template' && target.kind !== 'readonly') {
      UI.flash(labels.done + (res.via === 'on-device' ? ' · on-device' : ''));
    }
  }

  /** lib/ai.js's coach route always resolves to valid JSON (or its own degraded shape), but parse defensively anyway. */
  function parseCoachResult(text) {
    try {
      return JSON.parse(text);
    } catch {
      return { overall: { level: 'fair', note: `${PRODUCT} could not read its own response. Try again.` }, categories: [] };
    }
  }

  /* ============================================================ template */

  /** Split on whitespace runs, so each clickable unit in the preview is one word (punctuation stays attached). */
  function tokenize(text) {
    const tokens = [];
    const re = /\S+|\s+/g;
    let m;
    while ((m = re.exec(text))) {
      tokens.push({ start: m.index, end: m.index + m[0].length, text: m[0], isWord: !/^\s/.test(m[0]) });
    }
    return tokens;
  }

  /**
   * A suggested field's offsets may land mid-word; snap it out to the full
   * word tokens it overlaps so every field the preview shows always lines
   * up with whole, clickable words. Drops a field that covers no word at all.
   */
  function snapFieldToTokens(field, tokens) {
    const covered = tokens.filter((t) => t.isWord && t.start < field.end && t.end > field.start);
    if (!covered.length) return null;
    return {
      start: Math.min(...covered.map((t) => t.start)),
      end: Math.max(...covered.map((t) => t.end)),
      label: field.label
    };
  }

  /** A first-pass template name: the text itself, trimmed to one line and a sensible length — never a provider call. */
  function suggestTemplateName(text) {
    const flat = text.trim().replace(/\s+/g, ' ');
    if (!flat) return 'New template';
    if (flat.length <= 40) return flat;
    return flat.slice(0, 40).replace(/\s+\S*$/, '') + '…';
  }

  /** Show the Template preview panel, seeded with whatever fields Gemini suggested (already snapped to word boundaries). */
  function showTemplatePreview(target, text, suggestedFields) {
    const tokens = tokenize(text);
    const initialFields = suggestedFields.map((f) => snapFieldToTokens(f, tokens)).filter(Boolean);
    UI.templatePanel({
      rect: anchorRect(target),
      tokens,
      initialFields,
      initialName: suggestTemplateName(text),
      onSave: (name, fields) => saveTemplateNow(target, name, text, fields),
      onCancel: () => UI.hideTemplatePanel()
    });
  }

  /** Ask the worker to save (#15's saveTemplate, via the background — a content script can import no module). */
  async function saveTemplateNow(target, name, text, fields) {
    let res;
    try {
      res = await sendToBackground({ type: 'QF_SAVE_TEMPLATE', name, text, fields });
    } catch (err) {
      UI.hideTemplatePanel();
      UI.bubble({ rect: anchorRect(target), message: err.message, kind: 'error' });
      return;
    }
    UI.hideTemplatePanel();
    if (res?.ok) {
      UI.flash('Template saved');
    } else {
      UI.bubble({ rect: anchorRect(target), message: res?.error || 'Could not save the template.', kind: 'error' });
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
  // offers the way there. (No key at all is handled by the onboarding panel.)
  const SETTINGS_CODES = new Set(['BAD_KEY', 'BAD_MODEL']);

  /**
   * Every failure ends in a bubble: the message, Retry on the same target, and
   * Open settings when that is the fix. The one exception is no key at all:
   * that opens the onboarding panel, which walks the user to a key right here.
   */
  function showFailure(req, message, code) {
    if (code === 'NO_API_KEY') return openOnboarding(req, message);
    failureBubble(req, message, SETTINGS_CODES.has(code));
  }

  function failureBubble(req, message, withSettingsLink) {
    UI.bubble({
      rect: anchorRect(req.target),
      message,
      kind: 'error',
      onRetry: () => execute(req.action, req.target),
      withSettingsLink
    });
  }

  /* ========================================================== onboarding */

  // The onboarding panel (ADR 0001): the first action with no key opens it in
  // the page, remembering the action and the captured target so "Try again"
  // runs exactly what the user asked for once their key works. The copy is
  // the worker's (lib/onboarding.js), fetched on open — a content script can
  // import nothing — so this file holds no onboarding wording of its own.

  /** What the open panel is for: the request it will re-run and the copy it shows. Null while closed. */
  let onboardingFor = null;

  /** Open the panel for the request that just failed with no key. */
  async function openOnboarding(req, message) {
    let res = null;
    try {
      res = await sendToBackground({ type: 'QF_ONBOARDING_COPY' });
    } catch {
      res = null;
    }
    if (requestSeq !== req.id) return; // a newer action started meanwhile; its own outcome decides what shows
    if (!res?.ok || !res.copy) {
      // No copy means no worker; the bubble is the way out that still works.
      return failureBubble(req, message, true);
    }
    UI.hideOnboarding(); // an earlier panel's pending check must not paint this one (its onClose drops it)
    onboardingFor = { req, copy: res.copy };
    UI.onboarding({
      rect: anchorRect(req.target),
      copy: res.copy,
      onKeyEdited: scheduleValidation,
      onClose: () => { onboardingFor = null; dropValidation(); }
    });
  }

  // Validate the moment a key is pasted, or 400 ms after typing stops (the
  // options page does the same). Each check has a sequence number: a reply
  // for an older value, a cancelled check or a closed panel is dropped.
  const VALIDATE_DEBOUNCE_MS = 400;
  let validateSeq = 0;
  let validateTimer = null;

  /** Forget whatever check is pending or in flight. */
  function dropValidation() {
    clearTimeout(validateTimer);
    validateSeq++;
  }

  function scheduleValidation(value, pasted) {
    dropValidation();
    const apiKey = value.trim();
    if (!apiKey) return UI.onboardingStatus(null);
    validateTimer = setTimeout(() => validatePastedKey(apiKey), pasted ? 0 : VALIDATE_DEBOUNCE_MS);
  }

  /**
   * One check of a pasted key through the worker (QF_VALIDATE_KEY, which
   * also saves a working key), under the never-stuck rules: Still checking…
   * with Cancel at 5 s, a timed-out line at 20 s. Ends in one of three
   * states on the panel's status line: checking, working (with Try again on
   * the pending action) or failed with the reason, the box still editable.
   */
  async function validatePastedKey(apiKey) {
    if (!onboardingFor) return; // the panel closed during the debounce
    const { req, copy } = onboardingFor;
    const seq = ++validateSeq;
    const live = () => seq === validateSeq && onboardingFor?.req === req;
    const status = (text, kind, actions) => UI.onboardingStatus({ text, kind, actions });
    const checkAgain = { label: 'Check again', onClick: () => validatePastedKey(apiKey) };
    let cancelTimer = null;
    let stopTimer = null;
    const end = () => {
      clearTimeout(cancelTimer);
      clearTimeout(stopTimer);
      validateSeq++; // a reply that lands after this is for a check that is over
    };

    status('Checking your key…', 'busy');
    cancelTimer = setTimeout(() => {
      if (!live()) return;
      status('Still checking…', 'busy', [{ label: 'Cancel', onClick: () => {
        if (!live()) return;
        end();
        status('Cancelled.', '', [checkAgain]);
      } }]);
    }, CANCEL_AFTER_MS);
    stopTimer = setTimeout(() => {
      if (!live()) return;
      end();
      status('Checking the key took too long. Check your connection.', 'bad', [checkAgain]);
    }, HARD_STOP_MS);

    let res;
    try {
      res = await sendToBackground({ type: 'QF_VALIDATE_KEY', apiKey, save: true });
    } catch (err) {
      res = { ok: false, error: err.message };
    }
    if (!live()) return; // superseded, cancelled, timed out, or the panel is gone
    end();
    if (!res || typeof res.ok !== 'boolean') res = { ok: false, error: `No reply from ${PRODUCT}. Try reloading the page.` };
    if (!res.ok) return status(res.error || 'Something went wrong.', 'bad', [checkAgain]);
    status(copy.successLine, 'ok', [{ label: 'Try again', onClick: () => execute(req.action, req.target) }]);
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
    let onboardEl = null;
    let onboardClose = null;
    let coachEl = null;
    let templateEl = null;

    // Per-action accents, shared by the CSS below and the toolbar's inline
    // icon strokes so a button's ring and its icon never drift apart.
    const SAGE = '#8FB89B'; // Fix, Translate
    const LAVENDER = '#A3A8D6'; // Coach
    const SAND = '#C9B896'; // Template

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

      .bar { position: absolute; pointer-events: auto; display: flex; gap: 10px;
             background: #1B1D21; border-radius: 20px; padding: 10px;
             box-shadow: 0 8px 24px rgba(10,12,16,.35); }
      .bar button { all: unset; cursor: pointer; box-sizing: border-box;
                    width: 64px; height: 64px; border-radius: 999px;
                    display: flex; flex-direction: column; align-items: center; justify-content: center;
                    gap: 2px; background: #262A31; border: 1.5px solid var(--accent, ${SAGE});
                    color: #ECEAE5; font: inherit; text-align: center; }
      .bar button:hover { background: #2E333B; }
      .bar button svg { flex: none; }
      .bar button span { display: block; max-width: 46px; font-size: 9px; line-height: 1.15;
                    font-weight: 700; letter-spacing: .01em; }

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

      .onboard { max-width: min(480px, 92vw); max-height: min(85vh, 640px); overflow: auto;
                 padding: 12px 14px; font-weight: 400; }
      .onboard .head { display: flex; align-items: center; justify-content: space-between;
                       gap: 12px; margin-bottom: 8px; font-size: 11px; font-weight: 500;
                       text-transform: uppercase; letter-spacing: .05em; color: #6b7280; }
      .onboard p { margin: 0 0 8px; }
      .onboard ol { margin: 0 0 8px; padding-left: 20px; }
      .onboard li { margin: 4px 0; }
      .onboard li img { display: block; max-width: 100%; max-height: 140px; margin-top: 4px;
                        border: 1px solid #d8dbe2; border-radius: 6px; }
      .onboard .paste { display: flex; align-items: center; gap: 6px; margin: 10px 0 4px; }
      .onboard input { all: unset; flex: 1; min-width: 0; box-sizing: border-box; font: inherit;
                       padding: 6px 8px; border: 1px solid #c4c9d4; border-radius: 6px;
                       background: #fff; color: #111827; }
      .onboard input:focus { border-color: #4f46e5; box-shadow: 0 0 0 2px #c7d2fe; }
      .onboard .status { display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
                         min-height: 1.4em; margin: 4px 0 8px; }
      .onboard .status.busy { color: #4b5563; }
      .onboard .status.ok   { color: #15803d; }
      .onboard .status.bad  { color: #b91c1c; }
      .onboard .note { color: #6b7280; font-size: 12px; }
      .onboard .foot { display: flex; justify-content: space-between; gap: 8px; }
      .onboard button.primary { all: unset; cursor: pointer; font: inherit; font-size: 12px;
                                font-weight: 500; padding: 5px 10px; border-radius: 6px;
                                background: #4f46e5; color: #fff; white-space: nowrap; }

      .panel-eyebrow { font-size: 11px; font-weight: 700; text-transform: uppercase;
                      letter-spacing: .05em; color: #6b7280; margin-bottom: 8px; }
      .coach .excerpt { font-size: 13px; line-height: 1.6; margin: 0 0 12px;
                         max-height: 30vh; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
      .coach mark { background: rgba(143,184,155,.35); color: inherit; border-radius: 3px; padding: 0 1px; }
      .coach .overall { display: flex; align-items: flex-start; gap: 8px; font-weight: 700; margin-bottom: 10px; }
      .coach .cats { display: flex; flex-direction: column; gap: 8px; margin-bottom: 4px; }
      .coach .cat-name { display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 12.5px; }
      .coach .cat-note { font-size: 12.5px; opacity: .85; margin: 2px 0 0 14px; }
      .coach .dot { width: 8px; height: 8px; border-radius: 999px; flex: none; display: inline-block; margin-top: 2px; }

      .coach .acts, .template .acts { display: flex; gap: 6px; margin-top: 14px; }
      .coach .acts button, .template .acts button { all: unset; cursor: pointer; font: inherit; font-size: 12px;
                             padding: 5px 10px; border-radius: 6px; }
      .coach .acts .primary, .template .acts .primary { background: #4f46e5; color: #fff; }
      .coach .acts .secondary, .template .acts .secondary { color: inherit; text-decoration: underline; padding: 5px 2px; }

      .template .template-preview { font-size: 13px; line-height: 1.9; margin: 0 0 8px;
                           max-height: 30vh; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
      .template .tok { cursor: pointer; border-radius: 3px; padding: 0 1px; }
      .template .tok:hover { background: rgba(201,184,150,.25); }
      .template .tok.active { background: rgba(201,184,150,.4); box-shadow: 0 0 0 1px rgba(201,184,150,.7); }
      .template .template-hint { font-size: 12px; color: #6b7280; margin-bottom: 14px; }
      .template .template-name-label { display: block; font-size: 11px; font-weight: 700; text-transform: uppercase;
                              letter-spacing: .04em; color: #6b7280; margin-bottom: 6px; }
      .template .template-name { all: unset; box-sizing: border-box; width: 100%; font: inherit; font-size: 13px;
                        padding: 7px 9px; border: 1px solid #d8dbe2; border-radius: 6px; background: #fff; color: #111827; }
      .template .template-name:focus { border-color: #C9B896; box-shadow: 0 0 0 2px rgba(201,184,150,.35); }

      @media (prefers-color-scheme: dark) {
        .card { background: #1f2937; color: #f3f4f6; border-color: #374151; }
        .card.error { background: #3f1d1d; color: #fecaca; border-color: #7f1d1d; }
        .card.warn  { background: #422006; color: #fde68a; border-color: #78350f; }
        .card.ok    { background: #052e16; color: #bbf7d0; border-color: #14532d; }
        .panel .head, .onboard .head, .onboard .note, .panel-eyebrow, .template .template-hint { color: #9ca3af; }
        .template .template-name { background: #111827; color: #f3f4f6; border-color: #4b5563; }
        .onboard input { background: #111827; color: #f3f4f6; border-color: #4b5563; }
        .onboard li img { border-color: #4b5563; }
        .onboard .status.busy { color: #d1d5db; }
        .onboard .status.ok   { color: #86efac; }
        .onboard .status.bad  { color: #fca5a5; }
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
        row.appendChild(bubbleButton('Open settings', () => tellBackground({ type: 'QF_OPEN_OPTIONS' })));
      }
      bubbleEl.appendChild(row);
      bubbleEl.addEventListener('click', hideBubble);
      r.layer.appendChild(bubbleEl);
      place(bubbleEl, rect || nearSelection());
      if (life) bubbleTimer = setTimeout(hideBubble, life);
    }

    /** Fire-and-forget to the worker, for buttons whose only effect happens there (open a tab, open settings). */
    function tellBackground(msg) {
      try {
        chrome.runtime.sendMessage(msg).catch(() => {});
      } catch {
        /* the extension was reloaded; nothing to open from here */
      }
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

    const LEVEL_COLORS = { weak: '#C97B6B', fair: '#D6A94A', good: '#8FB89B', strong: '#4E8A63' };

    function levelDot(level) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = LEVEL_COLORS[level] || LEVEL_COLORS.fair;
      dot.title = level;
      return dot;
    }

    /** Sorted, overlap-merged, in-bounds spans — offsets are the model's own claim, never validated upstream for overlap. */
    function mergeSpans(spans, maxLen) {
      const clean = spans
        .map(({ start, end }) => ({ start: Math.max(0, start | 0), end: Math.min(maxLen, end | 0) }))
        .filter((s) => s.end > s.start)
        .sort((a, b) => a.start - b.start);
      const merged = [];
      for (const s of clean) {
        const last = merged[merged.length - 1];
        if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
        else merged.push({ ...s });
      }
      return merged;
    }

    /** The captured text reproduced with any category spans it can point to marked — never the live page, only this copy in the panel. */
    function highlightedText(text, spans) {
      const frag = document.createDocumentFragment();
      let cursor = 0;
      for (const { start, end } of mergeSpans(spans, text.length)) {
        if (start > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, start)));
        const mark = document.createElement('mark');
        mark.textContent = text.slice(start, end);
        frag.appendChild(mark);
        cursor = end;
      }
      if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
      return frag;
    }

    /**
     * The Coach panel (ADR 0007): the selection reproduced with any spans a
     * category points to marked, an overall strength signal and note, each
     * of the four categories with its own signal and note, then Fix these
     * for me (hands off to Fix on the same captured target) and Got it
     * (dismiss, nothing changed). Anchored like the bubble — below the
     * selection, or above when there is no room — never over it.
     */
    function coachPanel({ rect, text, payload, onFix, onDismiss }) {
      hideCoachPanel();
      const r = ensure();
      coachEl = document.createElement('div');
      coachEl.className = 'card coach';
      coachEl.innerHTML =
        '<div class="panel-eyebrow"></div>' +
        '<div class="excerpt"></div>' +
        '<div class="overall"></div>' +
        '<div class="cats"></div>' +
        '<div class="acts"><button class="primary">Fix these for me</button><button class="secondary">Got it</button></div>';
      coachEl.querySelector('.panel-eyebrow').textContent = `${PRODUCT} — Coach`;

      const allSpans = (payload.categories || []).flatMap((c) => c.spans || []);
      coachEl.querySelector('.excerpt').appendChild(highlightedText(text, allSpans));

      const overall = payload.overall || { level: 'fair', note: '' };
      const overallEl = coachEl.querySelector('.overall');
      overallEl.appendChild(levelDot(overall.level));
      const overallNote = document.createElement('span');
      overallNote.textContent = overall.note;
      overallEl.appendChild(overallNote);

      const catsEl = coachEl.querySelector('.cats');
      for (const cat of payload.categories || []) {
        const row = document.createElement('div');
        const nameRow = document.createElement('div');
        nameRow.className = 'cat-name';
        nameRow.appendChild(levelDot(cat.level));
        const name = document.createElement('span');
        name.textContent = cat.name;
        nameRow.appendChild(name);
        const note = document.createElement('div');
        note.className = 'cat-note';
        note.textContent = cat.note;
        row.append(nameRow, note);
        catsEl.appendChild(row);
      }

      coachEl.querySelector('.primary').addEventListener('click', onFix);
      coachEl.querySelector('.secondary').addEventListener('click', onDismiss);
      r.layer.appendChild(coachEl);
      place(coachEl, rect, 8);
    }

    function hideCoachPanel() {
      coachEl?.remove();
      coachEl = null;
    }

    /**
     * The Template preview: the text split into clickable word tokens, the
     * suggested fields already toggled on, a suggested-but-editable name,
     * then Save (calls `onSave(name, fields)` with whatever is toggled at
     * that moment) or Cancel (calls `onCancel`, nothing saved). Toggling a
     * word is purely local — no further provider call — so the whole
     * interaction lives in this one closure rather than round-tripping
     * through the caller for every click.
     */
    function templatePanel({ rect, tokens, initialFields, initialName, onSave, onCancel }) {
      hideTemplatePanel();
      const r = ensure();
      let fields = initialFields.map((f) => ({ ...f }));
      let counter = 0;

      templateEl = document.createElement('div');
      templateEl.className = 'card template';
      templateEl.innerHTML =
        '<div class="panel-eyebrow"></div>' +
        '<div class="template-preview"></div>' +
        '<div class="template-hint"></div>' +
        '<label class="template-name-label" for="qf-template-name">Template name</label>' +
        '<input id="qf-template-name" class="template-name" type="text" autocomplete="off">' +
        '<div class="acts"><button class="primary">Save template</button><button class="secondary">Cancel</button></div>';
      templateEl.querySelector('.panel-eyebrow').textContent = `${PRODUCT} — Template this`;
      templateEl.querySelector('.template-name').value = initialName;

      const previewEl = templateEl.querySelector('.template-preview');
      const hintEl = templateEl.querySelector('.template-hint');
      const fieldAt = (pos) => fields.find((f) => pos.start < f.end && pos.end > f.start);

      function render() {
        previewEl.replaceChildren();
        for (const tok of tokens) {
          if (!tok.isWord) {
            previewEl.appendChild(document.createTextNode(tok.text));
            continue;
          }
          const span = document.createElement('span');
          span.className = 'tok';
          span.textContent = tok.text;
          if (fieldAt(tok)) span.classList.add('active');
          span.addEventListener('click', () => {
            const existing = fieldAt(tok);
            if (existing) {
              fields = fields.filter((f) => f !== existing);
            } else {
              counter++;
              fields.push({ start: tok.start, end: tok.end, label: `Field ${counter}` });
            }
            render();
          });
          previewEl.appendChild(span);
        }
        hintEl.textContent = fields.length
          ? `${fields.length} field${fields.length === 1 ? '' : 's'} detected — click any word to mark or unmark it.`
          : 'No fields yet — click any word to mark it as one.';
      }
      render();

      templateEl.querySelector('.primary').addEventListener('click', () => {
        onSave(templateEl.querySelector('.template-name').value.trim(), fields.map(({ start, end, label }) => ({ start, end, label })));
      });
      templateEl.querySelector('.secondary').addEventListener('click', onCancel);

      r.layer.appendChild(templateEl);
      place(templateEl, rect, 8);
    }

    function hideTemplatePanel() {
      templateEl?.remove();
      templateEl = null;
    }

    /**
     * The onboarding panel: the why line, the numbered steps (each with a
     * screenshot slot that shows only once its image has loaded), Get your
     * free key, the paste box, a status line, the one-key note, a link to the
     * options page and Close. Anchored like the bubble, in the same shadow
     * root, so page CSS cannot touch it. It is a setup surface, not a
     * message: nothing but Close, Escape, Try again or a new action removes it.
     */
    function onboarding({ rect, copy, onKeyEdited, onClose }) {
      hideOnboarding();
      const r = ensure();
      onboardClose = onClose;
      onboardEl = document.createElement('div');
      onboardEl.className = 'card onboard';
      onboardEl.innerHTML =
        '<div class="head"><span></span><button class="link close">Close</button></div>' +
        '<p class="why"></p><ol class="steps"></ol>' +
        '<div class="acts"><button class="primary getkey">Get your free key</button></div>' +
        '<div class="paste"><input type="password" spellcheck="false" autocomplete="off" placeholder="Paste your key here"><button class="link toggle">Show</button></div>' +
        '<div class="status"></div>' +
        '<p class="note"></p>' +
        '<div class="foot"><button class="link options">Open settings</button></div>';
      onboardEl.querySelector('.head span').textContent = `${PRODUCT} — set up your free key`;
      onboardEl.querySelector('.why').textContent = copy.whyLine || '';
      onboardEl.querySelector('.note').textContent = copy.oneKeyNote || '';
      onboardEl.querySelector('.steps').append(...(copy.steps || []).map(onboardingStep));
      onboardEl.querySelector('.close').addEventListener('click', hideOnboarding);
      // A content script cannot open a tab or the options page itself; the worker does both.
      onboardEl.querySelector('.getkey').addEventListener('click', () => tellBackground({ type: 'QF_OPEN_KEY_PAGE' }));
      onboardEl.querySelector('.options').addEventListener('click', () => tellBackground({ type: 'QF_OPEN_OPTIONS' }));

      // The paste box: a password field (the key is a credential and the page
      // may be on a shared screen) with a Show toggle, as on the options page.
      // A paste reports itself so the check can skip the typing debounce; the
      // paste's own input event fires before the timer resets the flag.
      const box = onboardEl.querySelector('input');
      let pastePending = false;
      box.addEventListener('paste', () => {
        pastePending = true;
        setTimeout(() => { pastePending = false; }, 0);
      });
      box.addEventListener('input', () => {
        const pasted = pastePending;
        pastePending = false;
        onKeyEdited(box.value, pasted);
      });
      onboardEl.querySelector('.toggle').addEventListener('click', (e) => {
        const showing = box.type === 'text';
        box.type = showing ? 'password' : 'text';
        e.target.textContent = showing ? 'Show' : 'Hide';
      });
      // Keystrokes in the panel are the panel's, not the page's (mail and
      // ticket editors have single-key shortcuts). This script's own
      // document-level handlers run first, in the capture phase, so Escape
      // still closes the panel.
      for (const type of ['keydown', 'keypress', 'keyup']) {
        onboardEl.addEventListener(type, (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
      }

      r.layer.appendChild(onboardEl);
      place(onboardEl, rect);
    }

    /** The panel's status line: `null` clears it; otherwise text, a kind (busy | ok | bad) and inline actions. */
    function onboardingStatus(state) {
      const el = onboardEl?.querySelector('.status');
      if (!el) return;
      el.className = 'status ' + (state?.kind || '');
      el.replaceChildren(
        ...(state?.text ? [state.text] : []),
        ...(state?.actions || []).map(({ label, onClick }) => actionButton(label, onClick))
      );
    }

    /** One numbered step. The image is hidden until it loads and dropped if it never does, so a missing file leaves plain text. */
    function onboardingStep({ text, screenshotUrl }) {
      const li = document.createElement('li');
      li.textContent = text;
      if (screenshotUrl) {
        const img = document.createElement('img');
        img.alt = '';
        img.hidden = true;
        img.addEventListener('load', () => { img.hidden = false; });
        img.addEventListener('error', () => img.remove());
        img.src = screenshotUrl;
        li.appendChild(img);
      }
      return li;
    }

    /** Close the panel, however it was asked for (Close, Escape, Try again, a new action), and tell the owner once. */
    function hideOnboarding() {
      if (!onboardEl) return;
      onboardEl.remove();
      onboardEl = null;
      const fn = onboardClose;
      onboardClose = null;
      fn?.();
    }

    /** A single circular toolbar button: an icon plus a label beneath it, always visible (never icon-only). */
    function toolbarButton({ label, title, icon, accent = SAGE }) {
      const btn = document.createElement('button');
      btn.title = title;
      btn.style.setProperty('--accent', accent);
      btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="${accent}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${icon}</svg><span></span>`;
      btn.querySelector('span').textContent = label;
      return btn;
    }

    function showToolbar(rect) {
      hideToolbar();
      const r = ensure();
      barEl = document.createElement('div');
      barEl.className = 'bar';

      const fix = toolbarButton({
        label: 'Fix grammar',
        title: 'Fix grammar (Alt+G)',
        icon: '<circle cx="10" cy="10" r="7.2"/><path d="M6.5 10.2l2.2 2.2 4.8-5"/>'
      });
      const tr = toolbarButton({
        label: 'Translate',
        title: `Translate to ${settings.targetLanguage} (Alt+T)`,
        icon: '<path d="M3 7h9M9 4l3 3-3 3"/><path d="M17 13H8m4 3l-3-3 3-3"/>'
      });
      const coach = toolbarButton({
        label: 'Coach',
        title: 'Coach — a quick writing check-up',
        icon: '<path d="M3.5 5.5h13a1 1 0 011 1v6a1 1 0 01-1 1H8l-3.5 3v-3H3.5a1 1 0 01-1-1v-6a1 1 0 011-1z"/><path d="M6.5 8.5h7M6.5 11h4.5"/>',
        accent: LAVENDER
      });
      // Editable-only by construction: this toolbar never renders at all for a
      // read-only selection (see maybeShowToolbar), so Template needs no extra
      // hide/disable logic of its own to stay off read-only text.
      const template = toolbarButton({
        label: 'Template',
        title: 'Template — save this as a reusable template',
        icon: '<rect x="4" y="3" width="12" height="14" rx="1.5"/><path d="M7 7.5h6" stroke-dasharray="1.6 1.6"/><path d="M7 10.5h6" stroke-dasharray="1.6 1.6"/><path d="M7 13.5h3.5" stroke-dasharray="1.6 1.6"/>',
        accent: SAND
      });

      // Do not let the click steal the selection out from under us.
      barEl.addEventListener('mousedown', (e) => e.preventDefault());
      fix.addEventListener('click', () => run('grammar'));
      tr.addEventListener('click', () => run('translate'));
      coach.addEventListener('click', () => run('coach'));
      template.addEventListener('click', () => run('template'));

      barEl.append(fix, tr, coach, template);
      r.layer.appendChild(barEl);
      place(barEl, rect, 6);
    }

    function hideToolbar() {
      barEl?.remove();
      barEl = null;
    }

    return {
      indicator, indicatorWithCancel, hideIndicator,
      bubble, hideBubble, flash, result, hidePanel, showToolbar, hideToolbar,
      onboarding, onboardingStatus, hideOnboarding,
      coachPanel, hideCoachPanel,
      templatePanel, hideTemplatePanel
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
    if (e.key === 'Escape') { UI.hideToolbar(); UI.hideBubble(); UI.hidePanel(); UI.hideOnboarding(); UI.hideCoachPanel(); UI.hideTemplatePanel(); }
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
