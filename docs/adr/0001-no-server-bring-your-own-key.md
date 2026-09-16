---
status: accepted
date: 2026-09-17
---

# No server: users bring their own key

Kalam runs no backend. Each user supplies their own provider key (one per person), stored in
`chrome.storage.local` and never synced; text goes browser → provider under the user's own account.
We chose this over the category-normal model (developer holds the key, runs a server, charges a
subscription) because it costs the developer nothing, holds no user data, and makes "no middleman"
a true claim for every user — which Grammarly, QuillBot and LanguageTool cannot make.

## Considered options

- **Hosted key + subscription** (the consumer norm): needs a server, accounts, billing, abuse
  prevention, and makes Kalam a data processor. Rejected for now: don't build a business before
  there are users. Kept open as a future provider ("Kalam Cloud"), not as the default.
- **On-device only**: zero setup and zero cost, but most target users have 8 GB machines below
  Chrome's hardware floor, so it cannot be the only path.

## Consequences

- Onboarding the user to a free key is the critical path for adoption, not a side task.
- The extension cannot be hot-fixed; it must self-heal (see ADR 0004).
- The provider layer must be shaped so a hosted provider can slot in later without a rewrite.
