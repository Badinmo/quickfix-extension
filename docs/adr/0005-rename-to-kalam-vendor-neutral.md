---
status: accepted
date: 2026-09-17
---

# Rename to Kalam and drop vendor branding

"QuickFix" is already a grammar extension on the Chrome Web Store, so publishing under it invites
confusion and a name complaint. The new name is Kalam (Arabic كلام, "words"): abstract enough to
grow into language learning later, pronounceable in Arabic and English, and it names the
behaviour rather than the supplier. "Powered by Google Gemini" leaves the name and description —
Gemini is mentioned only on the options page where the key lives — because the supplier name was
generating "why Gemini?" objections before anyone had installed it.

## Consequences

- Manifest name, description, Store listing, privacy policy and README all change in one ticket.
- The Store assigns a new ID on first upload regardless; the manifest `key` field is stripped by
  `tools/build-package.ps1` as before.
- Pending: a manual Chrome Web Store search for "Kalam" before the listing is created.
