# Kalima — product decisions (17 Sep 2026)

Output of a grilling session on two questions: should the extension support providers other than
Gemini, and how does it become usable by a general Chrome Web Store audience given the
API-key-in-settings friction. Vocabulary is in [CONTEXT.md](../CONTEXT.md); the hard-to-reverse
decisions each have an ADR in [adr/](./adr/).

## Positioning

- **Headline:** invisible until invoked. Inline, no tab-switching, no nagging underlines — the
  anti-Grammarly, ADHD-friendly.
- **Privacy line:** *"No middleman: your text goes straight from your browser to your own AI
  account. We never see it."* On-device is a bonus where the machine supports it — never the
  headline claim ([ADR 0001](./adr/0001-no-server-bring-your-own-key.md),
  [ADR 0003](./adr/0003-on-device-translate-is-experimental.md)).
- **Name:** Kalima — shipping name, after Kalam (the first replacement for the original QuickFix
  working name) turned out to collide with an unrelated, existing Chrome Web Store extension (an
  employee-monitoring tool) found during the pre-publish Store search ADR 0005 called for.
  "Powered by Google Gemini" comes out of the name and description
  ([ADR 0005](./adr/0005-rename-to-kalam-vendor-neutral.md),
  [ADR 0006](./adr/0006-rename-to-kalima.md)).

## Users

- **Primary:** non-native-English professionals, any employer, plus ordinary people at home —
  emails, replies, forms. **Then:** NHS/enterprise colleagues on managed Edge devices.
- **First ten:** NHS colleagues on Edge (key path) + family/friends at home. No public post until
  onboarding is smooth.

## Business model

- **Zero cost to the developer.** Bring-your-own Gemini key (free tier) + on-device where
  possible. No server, no accounts, no data held ([ADR 0001](./adr/0001-no-server-bring-your-own-key.md)).
- **Revenue:** deferred. One architectural rule: the provider layer is shaped so "Kalima Cloud"
  (Kalima's key, users subscribe) can slot in as just another provider later.
- Community tool first; product only if the community pulls it.

## Providers

- **Gemini only** ([ADR 0002](./adr/0002-gemini-is-the-only-provider.md)). OpenAI, Azure OpenAI
  and Claude are dropped. Add a `provider: 'gemini'` settings field now.

## Next release contains

1. **Rename** — manifest, description, Store listing, privacy policy, README.
2. **Key onboarding** — onboarding panel in-page the first time an action runs with no key, plus a
   better options page. Numbered steps with screenshots; "Get your free key" opens
   aistudio.google.com/apikey in a new tab; auto-validates on paste; "one key per person" note;
   Test button kept.
3. **Never-stuck rules** — 5 s: "Still working… Cancel". 20 s: hard stop. Every failure ends in
   the bubble with a readable message + Retry, and Open settings for key/model errors. Same rules
   on the Test button ([ADR 0004](./adr/0004-self-healing-model-list-and-never-stuck.md)).
4. **Live model list** — fetched from Gemini, cached 24 h, refreshed on a `BAD_MODEL` error,
   filtered to `generateContent`-capable, Flash first; hardcoded list stays as the offline
   fallback ([ADR 0004](./adr/0004-self-healing-model-list-and-never-stuck.md)).
5. **On-device translate (experimental)** — off by default; toggle greyed out with the reason on
   unsupported machines; explicit download consent with size; indicator shows when on-device was
   used; feature-detected (works on Edge 148+) but the listing claims Chrome only. Translate only
   ([ADR 0003](./adr/0003-on-device-translate-is-experimental.md)).
6. **Publish** — Chrome Web Store only. Edge users install from it via "Allow extensions from
   other stores".

## Parked — explicitly out of scope

- Compose / reply / draft actions
- Language learning; quizzes built on the user's own errors
- OpenAI / Azure OpenAI / Claude
- Hosted tier, pricing, accounts, Pro unlock, donations
- On-device grammar (until the Proofreader API leaves origin trial)
- Edge Add-ons store listing
- Streaming output

## Facts these decisions rest on (re-check before revisiting)

- "QuickFix" is already a grammar extension on the Chrome Web Store.
- Chrome 148: Translator + Language Detector stable; Proofreader / Rewriter / Writer in origin trial.
- On-device hardware floor: ~22 GB free disk plus 16 GB RAM or a 4 GB-VRAM GPU. Most target users
  have 8 GB machines.
- Edge 148 has its own Translator API (Phi-based models); Edge installs Chrome Web Store
  extensions after a one-time "Allow extensions from other stores".
- Gemini API has a free tier. OpenAI API requires a prepaid card. A ChatGPT subscription and a
  Microsoft 365 Copilot licence give no API access.
- Flash-class models answer a paragraph in 1–3 s; the previous 45 s timeout was far too long.

## Known inconsistency (resolved by the rename ticket, #2)

`README.md` used to describe "Phase 3: a second provider (Azure OpenAI / OpenAI)" under *Not
built yet* and carried the QuickFix name and "Powered by Google Gemini" throughout. Superseded by
ADR 0002 and ADR 0005; the README now carries the parked list above and the "no middleman" line.

## Known inconsistency (resolved by the second rename, ADR 0006)

ADR 0005's own body still says "Kalam" throughout — it documents the QuickFix → Kalam decision as
history and is deliberately left unedited, along with its filename
(`docs/adr/0005-rename-to-kalam-vendor-neutral.md`). Everywhere else (this file, `CONTEXT.md`,
`README.md`, ADR 0001, ADR 0002, the manifest, UI copy, docs and test-harness titles) now says
Kalima, the current shipping name, per [ADR 0006](./adr/0006-rename-to-kalima.md).
