---
status: accepted
date: 2026-09-17
---

# Gemini is the only cloud provider

Kalam supports Gemini and no other cloud provider, despite the README's earlier "Phase 3" plan for
OpenAI / Azure OpenAI, and despite target users being more familiar with ChatGPT and Copilot.

## Why the familiar names don't help

- A ChatGPT subscription does not include API access; Microsoft 365 Copilot exposes no API a
  third-party extension can call. Neither gives the user a key.
- OpenAI's API requires a separate platform account with a prepaid card; Gemini's API has a free
  tier. For the people we are building for (family, non-native-English professionals), Gemini BYOK
  is the *easier* onboarding, not the harder one.
- The users' real complaint — "why Gemini?" — is a branding and onboarding problem, fixed by
  vendor-neutral naming and a guided key flow, not by adding vendors.
- Every provider is a permanent maintenance tax: its own error mapping, its own model list going
  stale, its own `host_permissions` entry making the install prompt scarier. Gemini's thinking
  config alone has broken this extension twice.

## Consequences

- Add a `provider: 'gemini'` settings field now so a second provider needs no storage migration.
- Revisit only when Kalam owns a backend and key (see ADR 0001); consumer OpenAI will never be the
  answer for this audience.
