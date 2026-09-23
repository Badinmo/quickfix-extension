# Kalima Privacy Policy

*Last updated: 2026-09-23*

Kalima is a browser extension for personal use that fixes grammar, translates text,
gives a plain-language writing check-up, and lets you save and reuse text as
templates, inside web pages. This policy explains what it does and does not do with
your data.

**No middleman: your text goes straight from your browser to your own AI account. We never
see it.**

## What Kalima reads

Kalima only reads text you have explicitly selected (or the single form field you are
currently focused in, if you trigger it with nothing selected), and only at the exact
moment you invoke it — by keyboard shortcut, the right-click menu, or the floating
toolbar.

Kalima never reads, scans, or stores anything else: not the rest of the page, not other
open tabs, not browsing history, not content you have not selected. It has no background
listeners that run without you explicitly triggering an action.

## Where your text goes

The text you select is sent to Google's Gemini API
(`https://generativelanguage.googleapis.com`), using your own personal Gemini API key, so
it can be corrected, translated, or assessed for a writing check-up (Coach), or so its
likely-to-change parts can be suggested (Template). That request is made directly from
the extension's background service worker to Google's servers, under your own Google
account. Google's handling of that data is governed by
[Google's own privacy policy and Gemini API terms](https://ai.google.dev/gemini-api/terms) —
Kalima has no control over Google's retention or use of that data beyond what those terms
describe.

Reusing a saved template (Reuse) makes no request to Google, or anywhere else: it is
looked up and filled in entirely on your device.

No other server, analytics service, or third party ever receives your text. Kalima has no
backend of its own, so there is nothing in between your browser and your AI account.
Gemini is the only cloud provider Kalima supports today.

## On-device translate (optional, experimental)

On a machine that supports it, Settings offers an experimental "On-device translate"
toggle, off by default. When it is turned on and the browser's own built-in Translator
supports the language pair, a translate action runs entirely on your machine using that
built-in model: the selected text is never sent to Gemini, or anywhere else, for that
action. When the toggle is off, or the pair isn't supported, translate goes to Gemini as
described above. This setting never affects the grammar action, which always uses
Gemini. The listing describes this feature as available in Chrome; it happens to also
work in Microsoft Edge (version 148 and later), which ships its own implementation of
the same browser API.

## What Kalima stores

Your Gemini API key, your settings (target language, tone, and similar preferences),
and any templates you save with the Template action (the template's name, its text,
and which parts of that text you've marked as fields) are stored locally on your
device only, using the browser's `chrome.storage.local` API. This data:

- never leaves your device except as part of a request you triggered to Google's Gemini
  API (the API key is sent as a request header, as required to authenticate that call;
  a template's text is never sent anywhere by saving or reusing it)
- is never synced through your browser account (Chrome/Edge sync is deliberately not
  used for this data)
- is never sent to the extension's developer or any analytics service — there is no
  analytics or telemetry of any kind in this extension

A saved template is only ever text you chose to save, kept only on your device, and
visible only to you — the same way your settings are.

## Data retention and deletion

Removing the extension deletes all locally stored settings, your API key, and any
saved templates immediately, since they exist only in the browser's local extension
storage. Kalima does not retain a copy anywhere else, because it has no server of its
own. You can also delete a saved template individually at any time, from the
Templates section of Settings, without removing the extension.

## Changes to this policy

If this policy changes, the "Last updated" date above will change accordingly.

## Contact

This is a personal-use, individually distributed extension. If you have questions about
this policy, contact the person who shared this extension's listing with you.
