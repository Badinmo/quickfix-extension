---
status: accepted
date: 2026-09-17
---

# On-device translate ships as an experimental, off-by-default mode

Chrome's built-in `Translator` API is stable (Chrome 148) and lets translate run with no key and no
network, but the Proofreader/Rewriter APIs are still in origin trial and the hardware floor
(~22 GB disk plus 16 GB RAM or a 4 GB GPU) excludes most of our users' machines. So on-device
covers translate only, is off by default behind an "Experimental" toggle, is greyed out with the
reason on unsupported machines, asks for consent (with size) before the model download, and is
feature-detected so it also works on Edge 148+ while the Store listing claims Chrome only.

## Consequences

- "Nothing leaves your machine" is **not** the headline privacy claim — it would be false for most
  users. The claim is "no middleman" (ADR 0001); on-device is a bonus where available.
- Grammar stays cloud until Proofreader leaves origin trial; re-evaluate then.
