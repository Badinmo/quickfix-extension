# Kalam Privacy Policy

*Last updated: 2026-09-18*

Kalam is a browser extension for personal use that fixes grammar and translates text
inside web pages. This policy explains what it does and does not do with your data.

**No middleman: your text goes straight from your browser to your own AI account. We never
see it.**

## What Kalam reads

Kalam only reads text you have explicitly selected (or the single form field you are
currently focused in, if you trigger it with nothing selected), and only at the exact
moment you invoke it — by keyboard shortcut, the right-click menu, or the floating
toolbar.

Kalam never reads, scans, or stores anything else: not the rest of the page, not other
open tabs, not browsing history, not content you have not selected. It has no background
listeners that run without you explicitly triggering an action.

## Where your text goes

The text you select is sent to Google's Gemini API
(`https://generativelanguage.googleapis.com`), using your own personal Gemini API key, so
it can be corrected or translated. That request is made directly from the extension's
background service worker to Google's servers, under your own Google account. Google's
handling of that data is governed by
[Google's own privacy policy and Gemini API terms](https://ai.google.dev/gemini-api/terms) —
Kalam has no control over Google's retention or use of that data beyond what those terms
describe.

No other server, analytics service, or third party ever receives your text. Kalam has no
backend of its own, so there is nothing in between your browser and your AI account.
Gemini is the only cloud provider Kalam supports today.

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

## What Kalam stores

Your Gemini API key and your settings (target language, tone, and similar preferences)
are stored locally on your device only, using the browser's `chrome.storage.local` API.
This data:

- never leaves your device except as part of a request you triggered to Google's Gemini
  API (the API key is sent as a request header, as required to authenticate that call)
- is never synced through your browser account (Chrome/Edge sync is deliberately not
  used for this data)
- is never sent to the extension's developer or any analytics service — there is no
  analytics or telemetry of any kind in this extension

## Data retention and deletion

Removing the extension deletes all locally stored settings and your API key
immediately, since they exist only in the browser's local extension storage. Kalam
does not retain a copy anywhere else, because it has no server of its own.

## Changes to this policy

If this policy changes, the "Last updated" date above will change accordingly.

## Contact

This is a personal-use, individually distributed extension. If you have questions about
this policy, contact the person who shared this extension's listing with you.
