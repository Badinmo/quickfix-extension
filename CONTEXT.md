# Kalima

A browser extension that fixes or translates the text you have selected, in place, in any text
field — invisible until invoked. It has no server: text goes from the user's browser straight to
the AI provider under the user's own account.

## Product

**Kalima**:
The product and extension name (Arabic كلمة, "word"). Replaces Kalam, itself a rename of the
original QuickFix working name — Kalam turned out to collide with an unrelated, existing Store
extension (an employee-monitoring tool), so the name changed again before publishing.
_Avoid_: QuickFix and Kalam (both different, existing Store extensions), the extension, the tool

**Invisible until invoked**:
The core positioning: the extension does nothing — no underlines, no scanning, no prompts —
until the user explicitly triggers an action on a selection.
_Avoid_: passive, always-on, assistant

**No middleman**:
The privacy property that text travels browser → provider under the user's own account, with no
Kalima server in between. True for every user, cloud or on-device.
_Avoid_: private, secure, local (those mean different things; see On-device mode)

## Actions and text

**Action**:
One of the operations a user can run on a selection. Today: grammar and translate.
_Avoid_: command, feature, mode, tool

**Selection**:
The exact text the user highlighted. The only text the extension ever reads, and only at the
moment an action is invoked.
_Avoid_: input, content, page text

**Replacement**:
The text written back in place of the selection.
_Avoid_: result, output, response, answer

**Whole-field fallback**:
With nothing selected in an `<input>` or `<textarea>`, an action operates on the whole field.
Deliberately never applies to contenteditable.
_Avoid_: auto-select, select-all

**Read-only selection**:
A selection with nowhere to write back to (an article, someone else's post). The replacement is
shown in a panel with a Copy button instead of being written.
_Avoid_: non-editable, view-only

**Staleness check**:
Before writing, the captured range is re-read and compared to what was sent; if it changed, nothing
is written and the user gets a message.
_Avoid_: race check, validation

## UI surfaces

**Toolbar**:
The floating control that appears next to a selection inside an editable field.
_Avoid_: floating menu, popover, widget

**Indicator**:
The small status element that shows an action is running or which mode produced the replacement.
_Avoid_: spinner (that is one state of the indicator, not the thing itself), badge

**Bubble**:
The message surface anchored to the toolbar where progress, errors, Retry and Open settings
appear. Every action ends either in a replacement or in a bubble — never in a silent nothing.
_Avoid_: toast, notification, alert, error dialog

**Onboarding panel**:
The in-page panel shown the first time an action is invoked with no key set. Walks the user to a
free key without leaving the page they were writing on.
_Avoid_: wizard, setup screen, welcome page

**Options page**:
The full settings page (`options/`). Holds the key, model, languages, tone and the on-device
toggle.
_Avoid_: settings dialog, preferences, config

**Never-stuck rules**:
The timing guarantees on every action: at 5 s the indicator offers Cancel; at 20 s the action
hard-stops; every failure ends in a bubble with a readable message.
_Avoid_: timeout handling, error handling

## Providers and keys

**Provider**:
The AI backend an action runs against. Today Gemini only; the provider layer is shaped so others
(on-device, Kalima Cloud) can slot in behind the same seam.
_Avoid_: model, engine, backend, vendor, API

**Model**:
A specific model id offered by a provider (e.g. `gemini-3.7-flash`). Distinct from provider.
_Avoid_: engine, version

**Key**:
The user's own API credential for their provider account. Stored in `chrome.storage.local`, never
synced, never seen by Kalima.
_Avoid_: token, licence, password, secret

**Bring-your-own-key (BYOK)**:
The arrangement where each user supplies their own key, one per person, so Kalima carries no cost
and holds no data.
_Avoid_: user-provided key, personal key

**Validate key**:
The cheapest authenticated call to the provider, made the moment a key is pasted, to answer
"does this key work?" before the user runs anything. Ends in one of three states: checking,
working, or failed with the reason. Exposed to extension pages as a background message only.
_Avoid_: test key (the Test button runs a real action on top of it), verify, ping

**Live model list**:
The list of models fetched from the provider at runtime and cached for 24 h, so a retired model
can never strand a user. The hardcoded list is only the offline fallback.
_Avoid_: dynamic models, model discovery

**On-device mode**:
Translation performed by the browser's built-in model (Chrome's `Translator` API) so nothing leaves
the machine. Experimental, off by default, translate only. Unavailable on machines below the
hardware floor.
_Avoid_: local AI, offline mode, Nano, private mode

**Kalima Cloud**:
A hypothetical future provider where Kalima holds the key and users subscribe. Parked; exists only
as a constraint on the provider layer's shape.
_Avoid_: hosted tier, backend, pro

## Settings

**Tone**:
The style option for the grammar action (preserve, professional, plain, concise, friendly,
formal).
_Avoid_: style, voice, register

**Target language**:
The language the translate action produces.
_Avoid_: output language, to-language

**Secondary language**:
The language translate swaps to when the selection is already in the target language and
auto-swap is on.
_Avoid_: fallback language, source language
