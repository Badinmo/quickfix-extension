---
status: accepted
date: 2026-09-18
---

# Rename to Kalima

ADR 0005 renamed the product from "QuickFix" to "Kalam" and flagged one open item: "a manual
Chrome Web Store search for 'Kalam' before the listing is created." That search, run before
publishing (issue #12), found an existing, unrelated Chrome Web Store item also called "Kalam
app extension" — an employee-monitoring tool, nothing to do with grammar or translation, but a
real name collision on the same store. Publishing under it risks a rejected or contested listing
and confusion with an unrelated (and, for a workplace-monitoring tool, reputationally unhelpful)
product.

The name changes again, to **Kalima** (Arabic كلمة, "word") — close enough to Kalam to keep the
same register and the same reasoning that made Kalam the choice over "QuickFix" in the first
place (abstract enough to grow into language learning later, pronounceable in Arabic and
English, names the behaviour rather than the supplier), but distinct enough not to collide with
the discovered listing. "Powered by Google Gemini" stays out of the name and description, per
ADR 0005 — that reasoning is unaffected by which word the name itself is.

## Consequences

- Every user-visible occurrence of "Kalam" changes to "Kalima": manifest name/description, the
  context-menu title, popup, options page, onboarding panel copy, content-script and provider
  error messages that name the product, README, CONTEXT.md, docs/decisions.md, the store listing,
  privacy policy, install guide, and the test-harness titles. This is a pure display-name change:
  internal identifiers untouched by ADR 0005 (`QF_*` message types, storage keys,
  `data-quickfix`, `window.__quickfixLoaded`, CSS classes, file/folder names) stay untouched again
  — nothing about the codebase's internal naming changes for this ticket either.
- `tools/build-package.ps1` now zips to `dist\kalima-webstore.zip` (was `dist\kalam-webstore.zip`);
  `tools/verify-package.ps1` checks that name.
- ADR 0005's own body is left as written — it documents the QuickFix → Kalam decision as history,
  and rewriting "Kalam" to "Kalima" inside it would misrepresent what was actually decided at the
  time. Its filename (`0005-rename-to-kalam-vendor-neutral.md`) is likewise left alone for the
  same reason. See the "Known inconsistency" note in `docs/decisions.md`.
- The Store assigns a new ID on first upload regardless of listing name, same as noted in ADR
  0005; no change to that mechanism.
- Pending: the actual Chrome Web Store listing form (title, description) still needs a human to
  type "Kalima" into it at submission time — this ticket only changes the repo. Any hosting URL
  for the privacy policy or listing images that happens to embed "kalam" would need the same
  care, but none currently does (checked: `docs/images/listing-*.png` filenames don't encode the
  product name).
