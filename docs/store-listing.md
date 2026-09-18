# Chrome Web Store listing content

Paste these straight into the Developer Dashboard when submitting
`dist/kalima-webstore.zip`. Written for an **unlisted/private** item — visible only to
people you share the link with, not searchable, not reviewed for a public audience.

**Chrome Web Store only, for now.** Kalima is submitted to the Chrome Web Store; there is
no Microsoft Edge Add-ons listing (parked — see `docs/decisions.md`). Edge users install
the same Chrome Web Store item — see the Edge note in the description below.

---

## Store listing tab

**Title** (fits Chrome's 45-character limit)
```
Kalima - Grammar & Translate
```

**Summary** (132 characters max — shown in search/list views)
```
Fix or translate text in place. No middleman: your text goes straight from your browser to your own AI account. We never see it.
```

**Description**
```
Kalima is invisible until invoked: no underlines, no scanning, no prompts, until you
select some text and ask. Fix grammar and structure, or translate, right where you're
typing - a support ticket, a webmail reply, a form field - without switching tabs or
copying into a separate tool.

No middleman: your text goes straight from your browser to your own AI account. We
never see it.

HOW IT WORKS
Select the text you want to change, then press Alt+G to fix grammar or Alt+T to
translate. The result replaces your selection in place. Ctrl+Z undoes it like any
other edit. A right-click menu and a small floating toolbar are also available as
alternatives to the keyboard shortcut.

WHAT IT TOUCHES
Kalima only ever reads the text you've explicitly selected (or the single field
you're focused in), at the moment you trigger it. It never scans the rest of the
page, other open tabs, or anything you haven't selected.

WHERE YOUR TEXT GOES
Selected text is sent to your own AI provider account using your own key, and
nothing is sent anywhere unless you actively trigger an action. Kalima has no server
of its own.

ON-DEVICE TRANSLATE (EXPERIMENTAL)
On machines that support it, Kalima can optionally translate using Chrome's built-in,
on-device Translator instead of the cloud - so that text never leaves your machine
for that action. This is an experimental, opt-in bonus: off by default, translate
only, and grayed out on machines that don't meet the hardware floor. Grammar always
uses your AI provider account.

WORKS IN EDGE TOO
Enable "Allow extensions from other stores" in edge://extensions, then install this
same Chrome Web Store item.

SETTINGS
Your API key, target language, tone, and behaviour are set once in Settings and
stored locally on your device (chrome.storage.local) - never synced through your
browser account.

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

**Screenshots** (1280x800, Chrome's required listing size)
```
docs/images/listing-toolbar.png       - the floating toolbar on a selection
docs/images/listing-grammar-fix.png   - a grammar-fix result (success flash)
docs/images/listing-translate.png     - a translate result (success flash)
docs/images/listing-onboarding.png    - the in-page onboarding panel (first-run,
                                         no key set)
```

---

## Privacy practices tab

**Single purpose description**
```
Kalima has a single purpose: when the user explicitly selects text in a web page
and triggers an action (keyboard shortcut, right-click menu, or floating toolbar),
it fixes that text's grammar or translates it, then replaces the selection with the
result. It performs no other function.
```

**Permission justifications** — the dashboard asks for one per sensitive permission.
This is the full, current permission set from `manifest.json`; no permission beyond
these is requested, and none was added purely for the on-device feature.

| Permission | Justification |
|---|---|
| `storage` | Stores the user's Gemini API key and preferences (target language, tone, on-device toggle, etc.) locally, so they're set once and reused. |
| `contextMenus` | Adds "Fix grammar" / "Translate" items to the right-click menu as an alternative to the keyboard shortcut. |
| `offscreen` | Used only when the user opts in to the experimental on-device translate toggle (off by default) on Chrome, which does not expose the built-in Translator/Language Detector APIs to the extension's background service worker. An invisible, hidden offscreen document runs those on-device calls instead; it never loads or contacts any URL and exists solely to reach an API the worker's own context cannot. It is feature-detected, not created at all unless the on-device toggle is on and needed. |
| `host_permissions` — `https://generativelanguage.googleapis.com/*` | The extension calls Google's Gemini API from the background service worker to process the user's selected text. No other host is contacted. |
| Content script on `<all_urls>`, all frames | The extension must be able to read the user's current text selection and write the replacement back, inside whichever page and iframe the user is typing in (e.g. a rich-text editor embedded in an iframe). It only acts on explicit user selection - see the single-purpose description above. |
| `web_accessible_resources` — `images/onboarding-*.png` on `<all_urls>` | Lets the in-page onboarding panel (shown the first time an action runs with no key set) load its optional numbered-step screenshots via `chrome.runtime.getURL`. These are static bundled images, not a live web resource; the panel works fine with no images present. |

**Data usage disclosure** — the dashboard will ask what user data the extension
collects/uses. Answer:

- **Collects:** the text the user has explicitly selected, at the moment they trigger
  an action. Nothing else.
- **Sent to:** Google's Gemini API (`generativelanguage.googleapis.com`), using the
  user's own API key, solely to produce the corrected/translated text. When the
  on-device translate toggle is on and the browser supports the language pair, a
  translate action is instead processed entirely on the user's machine and nothing
  is sent anywhere for that action.
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
