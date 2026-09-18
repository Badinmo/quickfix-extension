# Kalima — inline grammar & translation

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
4. The options page opens on first install. Follow the numbered steps at the top (**Get your
   free key** opens <https://aistudio.google.com/apikey>), paste the key — it is checked and
   saved the moment it lands — then **Test connection** if you want to see a real round trip.

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
   dev-only `"key"` field, and zips it to `dist\kalima-webstore.zip`. Run
   `tools\verify-package.ps1` afterwards if you want independent proof every file's CRC-32 in the
   zip matches what's on disk — it re-parses the archive from scratch rather than trusting the
   builder's own math.

2. **Host the privacy policy.** `docs/privacy-policy.md` is ready to publish as-is — the Web
   Store requires a public URL for it once you declare a host permission plus remote data
   processing (which this extension does: it calls Gemini's API). GitHub Pages, a raw Gist, or
   any URL you control all work.

3. **Register as a developer** at the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   (one-time $5 fee) if you haven't already.

4. **Create a new item**, upload `dist\kalima-webstore.zip`, and fill in the Store Listing and
   Privacy Practices tabs using `docs/store-listing.md` — every field, permission justification,
   and the single-purpose description are written out ready to paste in. Use the four
   1280x800 screenshots in `docs/images/listing-*.png` (toolbar, grammar fix, translate,
   onboarding panel) — see **Listing screenshots** below for what they show and how to
   regenerate them.

5. **Set visibility to Unlisted** (Distribution tab) before submitting.

6. **After it's approved**, the dashboard shows the assigned extension ID. Give that ID (not the
   one above) to whoever manages your organisation's extension allowlist, and share the item's
   private Store link so it can be installed from there instead of "Load unpacked".

7. **Renaming later:** both the manifest's `name` (via a new package upload) and the Store
   listing's title (Store Listing tab, independent of the manifest) can be changed anytime after
   publishing — neither creates a new listing or changes the ID.

### Listing screenshots

`docs/images/listing-*.png` are the four Chrome Web Store screenshots (1280x800, checked
into the repo — unlike `dist/`, these are not build output):

| File | Shows |
|---|---|
| `listing-toolbar.png` | The floating toolbar next to a text selection. |
| `listing-grammar-fix.png` | A grammar-fix result: the replaced text and the "Fixed" success flash. |
| `listing-translate.png` | A translate result: the replaced text and the "Translated" success flash. |
| `listing-onboarding.png` | The in-page onboarding panel that opens the first time an action runs with no key set. |

They were captured by driving `test/playground.html` in headless Edge over the DevTools
Protocol (Page.navigate, a same-world `Runtime.evaluate` to make a selection and click the
toolbar button, `Page.captureScreenshot`) with the real extension loaded via
`--load-extension`, served over a throwaway local HTTP server rather than `file://` so no
"Allow access to file URLs" toggle is needed. The toolbar and onboarding shots need no
network and no key — they exercise the real, unmodified code paths (`NO_API_KEY` genuinely
opens the onboarding panel). The two result shots need a successful round trip, which this
environment has no live Gemini key for; those two were captured with a throwaway one-line
patch to `sendToBackground` in `content/content.js` that short-circuits `QF_AI` messages to
a canned success reply, reverted with `git checkout -- content/content.js` immediately
after — that stub must never be present in a commit.

To regenerate: write an equivalent driver script (Node's built-in `fetch`/`WebSocket` are
enough, no npm packages needed) against the headless-Edge pattern in
`test/smoke-test.html`'s header comment, but add `--load-extension=<repo root>
--disable-extensions-except=<repo root>` and drive the page over CDP instead of using the
static `--screenshot`/`--dump-dom` flags, since these shots need interaction (a selection,
a click) rather than a page's initial render.

## Use

| Trigger | What it does |
|---|---|
| `Alt+G` | Fix grammar / structure of the selection |
| `Alt+T` | Translate the selection (Arabic by default) |
| Right-click → Kalima | Same two actions — works when a shortcut is inconvenient |
| Floating toolbar | Appears next to a selection inside an editable field |

`Ctrl+Z` undoes a replacement like any other edit — the extension writes through
`execCommand('insertText')` specifically so the page's own undo stack stays intact.

If a page steals `Alt+G`/`Alt+T`, rebind them at `edge://extensions/shortcuts` or
`chrome://extensions/shortcuts` (there is a button for this in the options page).

## Testing

Five harnesses in `test/`, in increasing order of realism.

**`smoke-test.html` — run this after touching `content.js`.** It loads the content script into a
normal page against a stubbed `chrome.*` API, then drives it through 88 assertions: whole-field
rewrite, partial selection, newline collapsing in single-line inputs, whitespace preservation,
contenteditable replacement with a quoted thread that must stay untouched, refusing to act on a
contenteditable with no selection, aborting when the field changes mid-request, the floating
toolbar, read-only selections, the never-stuck rules — Cancel at 5 s, the 20 s hard stop,
a bubble with Retry (and Open settings for key/model codes) for every failure code, bubble
dismissal, the indicator setting, the on-device label and stale-reply dropping — and the
onboarding panel: a `NO_API_KEY` reply opens it (no bubble, busy clear), its copy and buttons,
screenshot slots that show a loaded image and drop a missing one, the paste box (debounce,
trimmed key, `save: true`), the checking → working + Try again / failed states, Try again
re-sending the pending action, late-reply dropping, Cancel at 5 s and the 20 s stop inside the
panel, Escape / Close / a new action closing it, and the bubble fallback when the worker cannot
be reached. Time is faked the same way as in the provider harness, so the 5 s and 20 s cases
run in milliseconds. No API key or network needed. Open it in a browser, or headless:

```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new `
  --disable-gpu --no-first-run --user-data-dir="$env:TEMP\qf-edge" `
  --allow-file-access-from-files --virtual-time-budget=20000 --dump-dom `
  "file:///C:/Users/motha/Projects/Extensions/New%20folder/quickfix-extension/quickfix-extension/test/smoke-test.html"
```

The page title becomes `ALL PASS` or `FAILED n`. `test/syntax-check.html` is the same idea for
parse errors across every JS file — useful because a syntax error in a service worker is
otherwise silent until you open its console.

**`provider-test.html` — run this after touching `lib/ai.js`, `lib/config.js`,
`lib/on-device.js`, `lib/on-device-offscreen.js` or `lib/never-stuck.js`.** It loads the
provider seam (`runAction`, `validateKey`, `listModels`, `getSettings`, `onDeviceStatus`) as a
real ES module against a stubbed `fetch` and `chrome.storage.local`, then checks the result
object, every error code the provider can throw (key, model, rate limit, server, network,
blocked, truncated, empty), what is sent to Gemini, the thinking-variant discovery and what it
remembers in storage, the settings defaults, the live model list: filtering, ordering, the 24 h
cache and its key fingerprint, pagination, the built-in fallback, the `BAD_MODEL` self-heal (one
refresh, one retry, one deadline) and the stale-model check preferring the cached live list;
validate key (one GET with the key in the header, 400-key / 401 / 403 / API-disabled →
`BAD_KEY`, rate limit, server, network, a hang → `TIMEOUT` at 20 s, a blank key → `NO_API_KEY`
with no fetch) and the `apiKey` override on `listModels`; the on-device translate route (ADR
0003) with a stubbed Translator/LanguageDetector pair: route choice (pair available → the
on-device result with no fetch; unavailable, absent or throwing → the Gemini fallback; grammar
always Gemini; no key + on-device translate still runs; no key + grammar → `NO_API_KEY`),
auto-swap and source detection, the shared 20 s deadline (a hanging on-device call → `TIMEOUT`,
never a fresh Gemini budget), the `BAD_MODEL` heal never firing on the on-device path,
`onDeviceStatus` for every availability value, a pair made unavailable purely by a language
change since the toggle was turned on still falling back to Gemini mid-action with no prompt,
the download-consent helpers (`pairKey`/`hasConsent`/`addConsent`) and `downloadOnDeviceLanguage`
— forwarding `downloadprogress` fractions in order, resolving and destroying the translator when
nothing needed downloading, rejecting with a named `AbortError` when cancelled mid-download, and
a plain error naming the browser or the language when either is missing (#10) — and the BCP-47
table covering every `LANGUAGES` entry; and the never-stuck helper the options page wraps the
Test button in (Still working at 5 s, Cancel, hard stop at 20 s, late replies dropped). 183
assertions. Time is faked, so the 20 s hard stop is exercised in milliseconds. Same headless
command as above with `provider-test.html` in place of `smoke-test.html` (and
`--virtual-time-budget=10000` is plenty); the title reads `ALL PASS` or `FAILED n` the same way.

**`templates-test.html` — run this after touching `lib/templates.js`.** It loads the template
storage module as a real ES module against a stubbed `chrome.storage.local`, then checks save,
list, delete and rename round-tripping; filling a template (every field given a value, none
given, and a partial mix), including that an unfilled field shows a `[Label]` placeholder and
never replays the example value the template was saved with; renaming a template that no longer
exists; the `MAX_TEMPLATES` cap throwing a plain error (not a provider error code) and leaving
storage unchanged; and a static source check that the module makes no `fetch` call and does not
import from `lib/ai.js`. 16 assertions, no fake time needed. Same headless command as above with
`templates-test.html` in place of `smoke-test.html`.

The options page has no harness by design (spec: checked by hand). After touching `options/`,
open it from the extension card and walk the key section: paste a key and watch the
checking → working / failed line, press Test with the network off to see Cancel at 5 s and the
"took too long" line at 20 s.

**`playground.html` — the real extension, on a real page.** A textarea, a single-line input, a
contenteditable with a quoted thread, a same-origin iframe, an open shadow root and read-only
text, plus a live log of the `input`/`change` events each field receives — which is the thing
that actually breaks on real apps. There is a "Run check" button that confirms the content script
is alive on the page.

To use it from disk you must tick **Allow access to file URLs** on the extension's details page;
extensions get no access to `file://` otherwise, and the liveness check will report failure.

**Real sites.** None of the harnesses exercises a real Gemini call, the keyboard shortcuts, or
the context menu — those need the extension actually loaded and a key in settings. FreshService's ticket
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
  config.js                settings schema, model/language/tone lists, BCP-47 language codes, storage helpers
  prompts.js               system instructions for both actions
  ai.js                    runAction's route decision, Gemini client, validate key, live model list, error mapping
  on-device.js             on-device translate: feature detection, auto-swap, source detection (ADR 0003)
  on-device-offscreen.js   the service worker's half of the offscreen bridge (Chrome only — see below)
  never-stuck.js           the 5 s Cancel / 20 s hard-stop rules as a module, for extension pages
  onboarding.js            key onboarding copy: why line, numbered steps, one-key note, key page URL
  templates.js             local template storage: save/list/delete/rename/fill, no network, no AI
offscreen/
  on-device.html/.js       invisible document that runs Translator/LanguageDetector for the worker on Chrome
images/                    optional onboarding-N.png screenshots, one per step (see below)
options/                   settings page
popup/                     toolbar popup: status, quick language switch, link to settings
test/
  smoke-test.html          drives content.js against a stubbed chrome API, with fake time (88 assertions)
  provider-test.html       drives lib/ai.js, lib/on-device.js and lib/never-stuck.js against stubbed
                           fetch + storage + Translator/LanguageDetector, with fake time (183 assertions)
  templates-test.html      drives lib/templates.js against a stubbed chrome.storage.local (16 assertions)
  syntax-check.html        parse-checks every JS file
  playground.html          live test page: fields, iframe, shadow DOM, event log
tools/
  make-icons.ps1            regenerates icons/*.png
  build-package.ps1         stages dist/package and builds dist/kalima-webstore.zip for Store submission
  verify-package.ps1        independently re-checks every file in that zip
docs/
  guide.html                the beginner install/use walkthrough (also published as an Artifact)
  store-listing.md           listing copy, permission justifications, single-purpose text
  privacy-policy.md          the Store's required privacy policy, ready to host
  images/listing-*.png       the four Store listing screenshots, checked in (see below)
dist/                        build output — package/ and the zip
                              (not checked in; regenerate with tools/build-package.ps1)
```

**Request path.** Content script captures the selection → `chrome.runtime.sendMessage` →
service worker calls the Gemini REST API → response goes back → content script writes it into
the field. The content script never calls the API itself: page CSP would block it on many sites,
and this keeps the API key out of anything the page can reach.

**Live model list.** The model picker is fetched from Gemini (`listModels` in `lib/ai.js`, behind
the `QF_LIST_MODELS` message) and filtered by an **allowlist, not a blocklist**: only the mainline
`gemini-<version>-flash` / `gemini-<version>-flash-lite` family (`FLASH_FAMILY` in `lib/ai.js`)
survives, capped to the newest three Flash models plus the newest Flash-Lite. Everything else —
Pro, every preview/experimental build, image/audio/TTS/live variants, Gemma, embeddings, whatever
niche model ships next — is dropped, on purpose: this is a fix/translate tool, not a model picker,
so "generic, fast, cheap, currently supported" is the whole brief. Because the match is on shape
rather than a hardcoded version number, a future `gemini-4.0-flash` appears automatically and a
retired one simply stops being returned by the endpoint. The list is cached for 24 h in
`chrome.storage.local` under `modelCache` with a fingerprint of the key it was fetched with, never
the key itself. A `BAD_MODEL` error mid-action refreshes the list once on the action's own 20 s
deadline, saves the recommended model and retries once, so a retired model can never strand a user
([ADR 0004](docs/adr/0004-self-healing-model-list-and-never-stuck.md)). The hardcoded `MODELS` list
(currently 3.8/3.7/3.6-flash + 3.5-flash-lite) is only the offline fallback and before-a-key
default; it is worth re-checking against
[ai.google.dev/gemini-api/docs/models](https://ai.google.dev/gemini-api/docs/models) every so
often since the live path can't help before a key is entered.

**On-device translate (experimental, ADR 0003).** `runAction` decides its route inside the
action's one 20 s deadline, before the key check: a translate with the "On-device translate"
toggle on and the language pair available runs on the browser's built-in `Translator` (and
`LanguageDetector`, for auto-swap) with no network call and no key, and comes back
`{ text, via: 'on-device' }`; anything that isn't a fit — the toggle is off, the pair is
unavailable, the API is missing, or the on-device call throws — falls straight through to
Gemini, silently. Grammar always goes to Gemini. The globals are Window-only per spec
(`Exposed=Window`) and Chrome does not expose them to the extension service worker, so
`lib/on-device.js` reaches for them through a seam: the worker's own globals when the browser
puts them there (Edge does), otherwise an invisible `offscreen/on-device.html` document that
`lib/on-device-offscreen.js` creates on first use and messages per call (`chrome.offscreen`,
the `"offscreen"` permission) — feature-detected, never a browser check, so Chrome adding
worker support later needs no code change. Settings store languages as display names
(`"Arabic"`); `LANGUAGE_CODES` in `lib/config.js` maps every `LANGUAGES` entry to BCP-47 for the
on-device calls. The options page's "Translation" section queries the new
`QF_ON_DEVICE_STATUS { sourceLanguage, targetLanguage }` message (answered by `onDeviceStatus`
in `lib/on-device.js`) for the secondary → target pair on load and whenever either language
changes, and greys the toggle out with a human-readable reason unless the browser reports
`'available'`. Default is off; nothing changes for a user who never touches it.

**Download consent, progress and cancel (#10).** Turning the toggle on for a `'downloadable'`
pair opens a consent panel in the options page — Continue / Not now — before anything downloads;
declining leaves the toggle off and asks nothing else. Continue calls
`downloadOnDeviceLanguage` in `lib/on-device.js`, which runs `Translator.create()` with a
`monitor` and an `AbortSignal` and resolves once the pair is ready to translate. This runs
directly in the options page, not through the background or the offscreen bridge: Chrome and
Edge both expose `Translator` to a Window context per spec, and an extension's options page is
one, so no new background message type is needed here — the offscreen bridge exists solely
because the *service worker* lacks that exposure on Chrome, which is irrelevant to a page. The
panel shows a progress bar driven by the monitor's `downloadprogress` event (`e.loaded`, a 0–1
fraction — Chrome's own docs multiply it by 100 for a percentage) and a Cancel button that aborts
the signal; Chrome's `Translator.create()` does accept an `AbortSignal` per spec, so Cancel is a
real abort request, but whether the browser actually tears down the in-progress download rather
than just abandoning this page's interest in it isn't something the extension can verify, so the
cancelled message says so honestly rather than promising a guarantee it can't back. Completion
leaves the toggle on, shows a brief success line, and records the pair in the new
`onDeviceConsentedPairs` setting (`"source>target"` display-name keys, e.g. `"English>Arabic"`,
via `pairKey`/`hasConsent`/`addConsent` in `lib/on-device.js`) so re-toggling, or coming back to
an already-consented pair, never asks again — including across a language change: `onDeviceStatus`
is re-checked on every language edit, and a toggle already on that lands on a new, unconsented,
downloadable pair is turned off and asked again from this page, never mid-`Alt+T`.

**The size line is deliberately hedged.** Chrome's Translator API reports download *progress*
once a download starts, but never a size in bytes beforehand (checked directly against Chrome's
own docs and the spec for this ticket) — the options page's consent text says a one-time
download of "typically 100–300 MB" rather than inventing a precise figure the browser cannot
supply.

**Removing a downloaded pack** is outside the extension entirely — Kalima has no API for it. The
note under the toggle currently names Chrome's `chrome://on-device-translation-internals` page,
found via web search and a Chromium bug report rather than Chrome's own developer docs, so the
note is explicit that it's undocumented and may move, and that Edge's equivalent may differ.

**Key onboarding.** Getting a stranger to a free key is the critical path
([ADR 0001](docs/adr/0001-no-server-bring-your-own-key.md)), so the options page leads with it:
a one-line why, numbered steps, a **Get your free key** button that opens
`aistudio.google.com/apikey` in a new tab, and a "one key per person" note. The copy lives once,
in `lib/onboarding.js`, so the in-page onboarding panel says the same thing. Pasting a key sends
`QF_VALIDATE_KEY { apiKey, save: true }` to the service worker, which calls `validateKey` in
`lib/ai.js` — one GET on the models endpoint with the key in the header, on its own 20 s
deadline, mapped through the same error codes as an action — and the page shows checking →
"Working — you're set up" or the failure reason with Try again. A working key is saved by the
worker at once (trimmed) — the one save path both surfaces use — and the page refreshes the
model list for it; `QF_LIST_MODELS` accepts an `apiKey` override for exactly that, so the page
never has to save the rest of the form first. **Test connection** runs the key check, then one
real grammar action so the thinking-variant diagnostic survives, under the never-stuck rules
from `lib/never-stuck.js` (Cancel at 5 s, hard stop at 20 s). Screenshots are optional: drop
`images/onboarding-1.png` … `onboarding-4.png` (one per step, in step order) into the package
and each step shows its image; with no file there is no image and no broken icon.

**Onboarding panel.** The first action that comes back `NO_API_KEY` opens the onboarding panel
in the page instead of a bubble, so a new user gets to a working key without leaving what they
were writing. It lives in the same shadow root as the toolbar, indicator and bubble (so page
CSS cannot touch it), is anchored like the bubble, and remembers the action and the captured
target. A content script can import no module and open no tab, so the worker serves it:
`QF_ONBOARDING_COPY` → `{ ok, copy: { whyLine, steps: [{ text, screenshotUrl }], oneKeyNote,
successLine } }` (the copy from `lib/onboarding.js`, screenshot paths resolved with
`chrome.runtime.getURL`; `images/onboarding-*.png` is listed under `web_accessible_resources`
so a page may load them, and each slot is hidden until its image loads and dropped if it never
does) and `QF_OPEN_KEY_PAGE` → opens the key page in a new tab. The paste box is a password
field with a Show toggle; a paste is checked at once, typing 400 ms after it stops, through the
same `QF_VALIDATE_KEY { apiKey, save: true }` under the never-stuck rules inside the panel
(Still checking… with Cancel at 5 s, a timed-out line at 20 s), ending in checking → "Working —
you're set up" with **Try again** (re-runs the pending action on the pending target, subject to
the staleness check, and closes the panel) or the failure reason with the box still editable
and a Check again. It is a setup surface, not a message: it never auto-dismisses and survives a
scroll and a click outside; Escape, Close, Try again or starting a new action close it. If the
worker cannot be reached for the copy, the failure falls back to the bubble with Open settings.

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
- On-device translate is optional (off by default) and only ever a bonus: it needs a
  Chromium-based browser with the built-in Translator API and a supported language pair, and the
  Store listing claims Chrome only even though Edge 148+ is feature-detected and works too
  (ADR 0003).

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Nothing happens, toolbar icon flashes a red `!` | No content script in that tab. Extension pages, the Web Store, PDFs and `view-source:` are off limits; on a normal page, reload it after loading/reloading the extension. |
| Shortcut does nothing on one specific site | Something else has claimed `Alt+G`/`Alt+T`. Check `edge://extensions/shortcuts`, or use the right-click menu. |
| "Select the text you want Kalima to work on first" in an email/ticket editor | Rich-text editors are contenteditable, which requires a real selection — by design (see above). |
| Text is replaced but the app does not notice (Send stays greyed out) | Open `test/playground.html` and watch the event log to confirm `input` is firing, then check whether the app listens for something else. The write path is `replaceInInput` / `replaceInEditable` in `content/content.js`. |
| Manifest fails to load on an older browser | `match_origin_as_fallback` in `manifest.json` needs Chromium 111+. Replace that line with `"match_about_blank": true`. |
| "Gemini rejected the API key" | Key is wrong, or the Generative Language API is not enabled for that Google project. Regenerate at aistudio.google.com/apikey. |

## Data handling

No middleman: your text goes straight from your browser to your own AI account. We never see
it. Kalima has no server; the selection travels from the background service worker directly to
the provider (today Gemini, under your own key — [ADR 0001](docs/adr/0001-no-server-bring-your-own-key.md),
[ADR 0002](docs/adr/0002-gemini-is-the-only-provider.md)) and the reply comes straight back.
The key lives in `chrome.storage.local`, never synced, never seen by Kalima.

The provider is still external to your organisation's systems, however narrowly the extension
reads the page (§10 / §11.5) — worth a check against your trust's IG policy before using it on
anything that could contain patient-identifiable information. On-device translate
([ADR 0003](docs/adr/0003-on-device-translate-is-experimental.md)) is optional, off by default,
translate-only and Chrome-only in what the listing claims (Edge 148+ happens to work too — see
Limits): turned on and supported, the selection never leaves the machine for that action, but
it is an experimental bonus, never the headline claim, and grammar always still goes to Gemini.

## Parked — explicitly out of scope

From [`docs/decisions.md`](docs/decisions.md). Gemini is the only cloud provider
([ADR 0002](docs/adr/0002-gemini-is-the-only-provider.md)); the provider layer is shaped so a
future "Kalima Cloud" could slot in behind `runAction(action, text, settings)` in `lib/ai.js`,
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
