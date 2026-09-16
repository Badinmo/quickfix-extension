---
status: accepted
date: 2026-09-17
---

# The extension must self-heal: live model list and never-stuck rules

Because there is no server (ADR 0001), a retired model id or an API change cannot be hot-fixed;
users who never open settings would simply see it stop working. So the model list is fetched live
from the provider (cached 24 h, refreshed on a `BAD_MODEL` error, hardcoded list only as an offline
fallback), and every action obeys the never-stuck rules: Cancel offered at 5 s, hard stop at 20 s
(down from 45 s — Flash-class models answer in 1–3 s), and every failure ends in a bubble with a
readable message, Retry, and Open settings for key/model errors.

## Considered options

- **Hardcoded list + Store update when Google changes something**: the obvious path, rejected
  because Store review latency means days of a broken extension for every user.
