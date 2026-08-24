# QuickFix Privacy Policy

*Last updated: 2026-08-20*

QuickFix is a browser extension for personal use that fixes grammar and translates text
inside web pages. This policy explains what it does and does not do with your data.

## What QuickFix reads

QuickFix only reads text you have explicitly selected (or the single form field you are
currently focused in, if you trigger it with nothing selected), and only at the exact
moment you invoke it — by keyboard shortcut, the right-click menu, or the floating
toolbar.

QuickFix never reads, scans, or stores anything else: not the rest of the page, not other
open tabs, not browsing history, not content you have not selected. It has no background
listeners that run without you explicitly triggering an action.

## Where your text goes

The text you select is sent to Google's Gemini API
(`https://generativelanguage.googleapis.com`), using your own personal Gemini API key, so
it can be corrected or translated. That request is made directly from the extension's
background service worker to Google's servers. Google's handling of that data is governed
by [Google's own privacy policy and Gemini API terms](https://ai.google.dev/gemini-api/terms) —
QuickFix has no control over Google's retention or use of that data beyond what those
terms describe.

No other server, analytics service, or third party ever receives your text. QuickFix has
no backend of its own.

## What QuickFix stores

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
immediately, since they exist only in the browser's local extension storage. QuickFix
does not retain a copy anywhere else, because it has no server of its own.

## Changes to this policy

If this policy changes, the "Last updated" date above will change accordingly.

## Contact

This is a personal-use, individually distributed extension. If you have questions about
this policy, contact the person who shared this extension's listing with you.
