# Chrome Web Store / Edge Add-ons listing content

Paste these straight into the Developer Dashboard when submitting
`dist/quickfix-webstore.zip`. Written for an **unlisted/private** item — visible only to
people you share the link with, not searchable, not reviewed for a public audience.

---

## Store listing tab

**Title** (fits Chrome's 45-character limit)
```
QuickFix - Grammar & Translate
```

**Summary** (132 characters max — shown in search/list views)
```
Fix grammar or translate the text you've selected, replaced in place. Works in any text field. Powered by Gemini.
```

**Description**
```
QuickFix fixes grammar and structure, or translates text, right where you're typing -
a support ticket, a webmail reply, a form field - without switching tabs or copying
into a separate tool.

HOW IT WORKS
Select the text you want to change, then press Alt+G to fix grammar or Alt+T to
translate. The result replaces your selection in place. Ctrl+Z undoes it like any
other edit. A right-click menu and a small floating toolbar are also available as
alternatives to the keyboard shortcut.

WHAT IT TOUCHES
QuickFix only ever reads the text you've explicitly selected (or the single field
you're focused in), at the moment you trigger it. It never scans the rest of the
page, other open tabs, or anything you haven't selected.

WHERE YOUR TEXT GOES
Selected text is sent to Google's Gemini API to be processed, using your own API
key. Nothing is sent anywhere unless you actively trigger an action.

SETTINGS
Your Gemini API key, target language, tone, and behaviour are set once in Settings
and stored locally on your device (chrome.storage.local) - never synced through
your browser account.

This is a personal-use tool, distributed unlisted rather than through public search.
```

**Category**
```
Productivity
```

**Language**
```
English (United States)
```

**Screenshot** (at least one required, 1280x800 or 640x400)
```
dist/screenshot-settings.png
```

---

## Privacy practices tab

**Single purpose description**
```
QuickFix has a single purpose: when the user explicitly selects text in a web page
and triggers an action (keyboard shortcut, right-click menu, or floating toolbar),
it fixes that text's grammar or translates it, then replaces the selection with the
result. It performs no other function.
```

**Permission justifications** — the dashboard asks for one per sensitive permission:

| Permission | Justification |
|---|---|
| `storage` | Stores the user's Gemini API key and preferences (target language, tone, etc.) locally, so they're set once and reused. |
| `contextMenus` | Adds "Fix grammar" / "Translate" items to the right-click menu as an alternative to the keyboard shortcut. |
| `host_permissions` — `https://generativelanguage.googleapis.com/*` | The extension calls Google's Gemini API from the background service worker to process the user's selected text. No other host is contacted. |
| Content script on `<all_urls>`, all frames | The extension must be able to read the user's current text selection and write the replacement back, inside whichever page and iframe the user is typing in (e.g. a rich-text editor embedded in an iframe). It only acts on explicit user selection - see the single-purpose description above. |

**Data usage disclosure** — the dashboard will ask what user data the extension
collects/uses. Answer:

- **Collects:** the text the user has explicitly selected, at the moment they trigger
  an action. Nothing else.
- **Sent to:** Google's Gemini API (`generativelanguage.googleapis.com`), using the
  user's own API key, solely to produce the corrected/translated text.
- **Stored:** the API key and settings, locally on-device only
  (`chrome.storage.local`), never transmitted anywhere except to Google's API as part
  of a request, and never synced via the browser account.
- **Not collected:** browsing history, page content the user hasn't selected, analytics,
  telemetry. There is no tracking of any kind.

**Privacy policy URL** — required once any host permission plus remote data
processing is declared. Host `docs/privacy-policy.md` (or its content) somewhere
public - GitHub Pages, a Gist rendered as raw text, or any URL you control - and
paste that URL here. The full policy text is in `docs/privacy-policy.md` in this
project, ready to publish as-is.
