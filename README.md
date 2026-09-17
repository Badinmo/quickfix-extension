# Kalam — inline grammar & translation

A Manifest V3 extension for Chrome and Edge. Select text in any field on any page, press a
shortcut, and the corrected or translated text replaces your selection in place. Invisible
until invoked. No middleman: your text goes straight from your browser to your own AI
account. We never see it. Built from `inline-text-assistant-requirements_1.md` (v1: Gemini
only, `Alt+G` / `Alt+T`); the product decisions behind the next release are in
[`docs/decisions.md`](docs/decisions.md), the vocabulary in [`CONTEXT.md`](CONTEXT.md).

---

## Distribution: unpacked vs. private Web Store

Two ways to install this, and which one applies depends on the machine:

- **Unpacked (`Load unpacked`)** — works on unmanaged machines. `manifest.json` pins a
  permanent ID via its `"key"` field (`fpbmbdgjgncghlnokoaelgiohgnnkili`), so the ID stays the
  same regardless of which machine or folder path loads it. The matching private key was never
  saved to disk — it only existed long enough to derive the ID, then was deleted — so it's an
  identifier, not a credential.
- **Private/unlisted Chrome Web Store item** — needed on managed devices where Developer-Mode
  extension loading is blocked by policy, even after the extension's ID is allowlisted (a common
  setup: the allowlist governs *which* extensions can run, but a separate, stricter policy blocks
  *unpacked loading as an install method* outright — allowlisting alone doesn't unblock it). See
  **Publishing to the Chrome Web Store** below.

**Important:** these produce *different IDs*. The Store assigns its own ID on first upload and
ignores the manifest's `"key"` field entirely — that's why `dist/package/manifest.json` (built by
`tools/build-package.ps1`) has the key stripped out. If you publish to the Store, whoever manages
the Defender/Intune allowlist needs the *new* Store-assigned ID, not the one above.

## Install unpacked (personal use, no store)

1. Open `edge://extensions` (or `chrome://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick this folder (`quickfix-extension`).
4. The options page opens on first install. Paste a Gemini API key from
   <https://aistudio.google.com/apikey> and click **Save settings**, then **Test connection**.

After any code change: hit the reload icon on the extension card, then reload the page you are
testing on (the content script is injected at page load).

## Publishing to the Chrome Web Store (private/unlisted)

For a machine where Developer-Mode loading itself is blocked by policy. Unlisted means it's
never publicly searchable — only reachable by whoever has the direct link, and installable only
by people your Google Workspace/organisation allows (or anyone, if your account isn't managed).

1. **Build the upload package.**
   ```powershell
   powershell -ExecutionPolicy Bypass -File tools\build-package.ps1
   ```
   This copies the extension into `dist\package` (rerun after any code change), strips the
   dev-only `"key"` field, and zips it to `dist\kalam-webstore.zip`. Run
   `tools\verify-package.ps1` afterwards if you want independent proof every file's CRC-32 in the
   zip matches what's on disk — it re-parses the archive from scratch rather than trusting the
   builder's own math.

2. **Host the privacy policy.** `docs/privacy-policy.md` is ready to publish as-is — the Web
   Store requires a public URL for it once you declare a host permission plus remote data
   processing (which this extension does: it calls Gemini's API). GitHub Pages, a raw Gist, or
   any URL you control all work.

3. **Register as a developer** at the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   (one-time $5 fee) if you haven't already.

4. **Create a new item**, upload `dist\kalam-webstore.zip`, and fill in the Store Listing and
   Privacy Practices tabs using `docs/store-listing.md` — every field, permission justification,
   and the single-purpose description are written out ready to paste in. Use
   `dist/screenshot-settings.png` as the required screenshot.

5. **Set visibility to Unlisted** (Distribution tab) before submitting.

6. **After it's approved**, the dashboard shows the assigned extension ID. Give that ID (not the
   one above) to whoever manages your organisation's extension allowlist, and share the item's
   private Store link so it can be installed from there instead of "Load unpacked".

7. **Renaming later:** both the manifest's `name` (via a new package upload) and the Store
   listing's title (Store Listing tab, independent of the manifest) can be changed anytime after
   publishing — neither creates a new listing or changes the ID.

## Use

| Trigger | What it does |
|---|---|
| `Alt+G` | Fix grammar / structure of the selection |
| `Alt+T` | Translate the selection (Arabic by default) |
| Right-click → Kalam | Same two actions — works when a shortcut is inconvenient |
| Floating toolbar | Appears next to a selection inside an editable field |

`Ctrl+Z` undoes a replacement like any other edit — the extension writes through
`execCommand('insertText')` specifically so the page's own undo stack stays intact.

If a page steals `Alt+G`/`Alt+T`, rebind them at `edge://extensions/shortcuts` or
`chrome://extensions/shortcuts` (there is a button for this in the options page).

## Testing

Three harnesses in `test/`, in increasing order of realism.

**`smoke-test.html` — run this after touching `content.js`.** It loads the content script into a
normal page against a stubbed `chrome.*` API, then drives it through 18 assertions: whole-field
rewrite, partial selection, newline collapsing in single-line inputs, whitespace preservation,
contenteditable replacement with a quoted thread that must stay untouched, refusing to act on a
contenteditable with no selection, aborting when the field changes mid-request, error handling,
the floating toolbar, and read-only selections. No API key or network needed. Open it in a
browser, or headless:

```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new `
  --disable-gpu --no-first-run --user-data-dir="$env:TEMP\qf-edge" `
  --allow-file-access-from-files --virtual-time-budget=20000 --dump-dom `
  "file:///C:/Users/motha/Projects/Extensions/New%20folder/quickfix-extension/quickfix-extension/test/smoke-test.html"
```

The page title becomes `ALL PASS` or `FAILED n`. `test/syntax-check.html` is the same idea for
parse errors across every JS file — useful because a syntax error in a service worker is
otherwise silent until you open its console.

**`playground.html` — the real extension, on a real page.** A textarea, a single-line input, a
contenteditable with a quoted thread, a same-origin iframe, an open shadow root and read-only
text, plus a live log of the `input`/`change` events each field receives — which is the thing
that actually breaks on real apps. There is a "Run check" button that confirms the content script
is alive on the page.

To use it from disk you must tick **Allow access to file URLs** on the extension's details page;
extensions get no access to `file://` otherwise, and the liveness check will report failure.

**Real sites.** Neither harness exercises the Gemini call, the keyboard shortcuts, or the context
menu — those need the extension actually loaded and a key in settings. FreshService's ticket
editor and Outlook on the web are the two named targets in the requirements and are worth testing
by hand.

---

## How it is put together

```
manifest.json              MV3, content script in all frames, Alt+G / Alt+T commands
background/
  service-worker.js        commands + context menu, routes actions, calls Gemini
content/
  content.js               capture selection → send → replace inline; toolbar & indicator UI
lib/
  config.js                settings schema, model/language/tone lists, storage helpers
  prompts.js               system instructions for both actions
  ai.js                    Gemini client, error mapping, output cleanup
options/                   settings page
popup/                     toolbar popup: status, quick language switch, link to settings
test/
  smoke-test.html          drives content.js against a stubbed chrome API (18 assertions)
  syntax-check.html        parse-checks every JS file
  playground.html          live test page: fields, iframe, shadow DOM, event log
tools/
  make-icons.ps1            regenerates icons/*.png
  build-package.ps1         stages dist/package and builds dist/kalam-webstore.zip for Store submission
  verify-package.ps1        independently re-checks every file in that zip
docs/
  guide.html                the beginner install/use walkthrough (also published as an Artifact)
  store-listing.md           listing copy, permission justifications, single-purpose text
  privacy-policy.md          the Store's required privacy policy, ready to host
dist/                        build output — package/, the zip, and the listing screenshot
                              (not checked in; regenerate with tools/build-package.ps1)
```

**Request path.** Content script captures the selection → `chrome.runtime.sendMessage` →
service worker calls the Gemini REST API → response goes back → content script writes it into
the field. The content script never calls the API itself: page CSP would block it on many sites,
and this keeps the API key out of anything the page can reach.

**Frame routing.** `Alt+G` is a browser-level command, so it arrives at the service worker, which
broadcasts to every frame in the active tab. Each frame answers only if it owns focus
(`document.hasFocus()` and its own `activeElement` is not itself a frame) — so exactly one frame
acts, including editors nested in iframes. Context-menu clicks carry a `frameId`, so those are
addressed directly.

**Writing the text back.** `document.execCommand('insertText')` first, for both form fields and
contenteditable: it preserves undo and fires real `beforeinput`/`input` events, which is what
Outlook and FreshService listen for. If that fails, it falls back to `setRangeText`-style value
replacement (through the native `value` setter, so React's change tracking still notices) or
direct `Range` manipulation, then dispatches `input` and `change` manually.

**Staleness check.** The API call takes a second or two, during which you might type or click
elsewhere. Before writing, the extension re-reads the exact range it captured and compares it to
what it sent. If it no longer matches, nothing is replaced and you get a message instead of a
mangled field.

**Whitespace.** Leading/trailing whitespace in your selection is stripped before sending and
re-attached after, so selecting `" the printer is broke "` does not come back glued to the
neighbouring words.

---

## Deliberate decisions worth knowing

**Whole-field fallback only for `<input>`/`<textarea>`.** With nothing selected in a plain form
field, `Alt+G` rewrites the whole box (requirements §5.1). There is deliberately **no** such
fallback for contenteditable: in Outlook and FreshService the editable region also contains the
quoted thread under your reply, and grabbing it would violate the hard requirement in §5.1 that
the extension only ever reads what you explicitly selected. In a contenteditable you must select
something.

**Storage is `chrome.storage.local`** (§7, and open question 4 — resolved to local). Settings and
the API key never leave this machine through browser account sync. The cost is that you re-enter
the key when you load the extension on a second machine, which for one or two machines is
cheaper than syncing a credential.

**Read-only selections** (an article, someone else's post) have nowhere to write back to, so the
result appears in a small panel with a Copy button rather than being discarded.

**No page scanning of any kind.** There are no passive listeners that read text. The only
listeners on the page are pointer/key events used to decide whether to show the floating toolbar,
and those read selection *boundaries*, never surrounding content. Text is read only at the moment
you invoke an action.

## Limits

- **New Outlook for Windows and classic Outlook desktop are not supported** (§8.1). New Outlook
  runs on WebView2, which does not load browser extensions at all. Only Outlook *on the web*, in
  an actual Chrome/Edge tab, works.
- **Closed shadow roots** cannot be reached — out of scope per §3. Open shadow roots work.
- **Cross-origin iframes** work (the content script is injected into all frames), but a frame
  that blocks extension injection via CSP sandboxing will not.
- Selections are capped at 20,000 characters per request.
- Gemini's free tier is rate-limited; a burst of requests can return "rate limit hit".

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Nothing happens, toolbar icon flashes a red `!` | No content script in that tab. Extension pages, the Web Store, PDFs and `view-source:` are off limits; on a normal page, reload it after loading/reloading the extension. |
| Shortcut does nothing on one specific site | Something else has claimed `Alt+G`/`Alt+T`. Check `edge://extensions/shortcuts`, or use the right-click menu. |
| "Select the text you want Kalam to work on first" in an email/ticket editor | Rich-text editors are contenteditable, which requires a real selection — by design (see above). |
| Text is replaced but the app does not notice (Send stays greyed out) | Open `test/playground.html` and watch the event log to confirm `input` is firing, then check whether the app listens for something else. The write path is `replaceInInput` / `replaceInEditable` in `content/content.js`. |
| Manifest fails to load on an older browser | `match_origin_as_fallback` in `manifest.json` needs Chromium 111+. Replace that line with `"match_about_blank": true`. |
| "Gemini rejected the API key" | Key is wrong, or the Generative Language API is not enabled for that Google project. Regenerate at aistudio.google.com/apikey. |

## Data handling

No middleman: your text goes straight from your browser to your own AI account. We never see
it. Kalam has no server; the selection travels from the background service worker directly to
the provider (today Gemini, under your own key — [ADR 0001](docs/adr/0001-no-server-bring-your-own-key.md),
[ADR 0002](docs/adr/0002-gemini-is-the-only-provider.md)) and the reply comes straight back.
The key lives in `chrome.storage.local`, never synced, never seen by Kalam.

The provider is still external to your organisation's systems, however narrowly the extension
reads the page (§10 / §11.5) — worth a check against your trust's IG policy before using it on
anything that could contain patient-identifiable information. The planned on-device translate
mode ([ADR 0003](docs/adr/0003-on-device-translate-is-experimental.md)) keeps translate on the
machine where the hardware allows it, but it is an experimental bonus, never the headline claim.

## Parked — explicitly out of scope

From [`docs/decisions.md`](docs/decisions.md). Gemini is the only cloud provider
([ADR 0002](docs/adr/0002-gemini-is-the-only-provider.md)); the provider layer is shaped so a
future "Kalam Cloud" could slot in behind `runAction(action, text, settings)` in `lib/ai.js`,
but nothing is built.

- Compose / reply / draft actions
- Language learning; quizzes built on the user's own errors
- OpenAI / Azure OpenAI / Claude
- Hosted tier, pricing, accounts, Pro unlock, donations
- On-device grammar (until the Proofreader API leaves origin trial)
- Edge Add-ons store listing
- Streaming output

## Regenerating the icons

```powershell
powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1
```

`tools/make-icons.ps1` is a self-contained PNG encoder in plain PowerShell — no `Add-Type`,
no `System.Drawing`, no `[Math]` — so it also runs under Constrained Language Mode on a locked
down corporate build.
