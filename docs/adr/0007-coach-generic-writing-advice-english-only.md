---
status: accepted
date: 2026-09-19
---

# Coach: a generic writing-advice framework, English-only for v1

The five-action expansion (issue #13) adds Coach: a breakdown of a selection's writing quality
across grammar & accuracy, word choice, clarity & flow, and tone & register — always these four,
always in this order. The four dimensions are structured after IELTS's writing-assessment
categories, the clearest existing public vocabulary for "what makes writing good" along exactly
these lines. But Kalima's audience is emails and everyday business writing, not exam preparation,
and a numeric or letter grade reads as judgment rather than help for someone just trying to write
a clearer message. So the framework is generic: never named or scored like an exam anywhere a
user (or the model, via the prompt) can see it — no "IELTS", no "band", no numeric score, in any
prompt, string or doc aimed at users. Each category gets a plain strength signal (weak / fair /
good / strong) and one specific, non-jargon note instead.

Coach is Gemini-only and English-only for this v1 pilot (up to 20 users, per issue #13's spec).
Rather than a separate language-detection call, the same prompt that asks for the breakdown also
asks the model to report `{"nonEnglish": true}` for non-English text — one seam, one request,
consistent with Coach reusing the single existing provider seam (`runAction`) rather than
inventing a new one.

## Considered options

- **Score out of a number, or a letter grade**: rejected — reads as being tested, not helped, and
  a fix/translate tool has no business grading anyone.
- **A separate on-device or provider call to detect language before running Coach**: rejected for
  v1 — a second network/API dependency for a problem the same JSON-only Gemini call can already
  answer, at the cost of one more field in the response shape.

## Consequences

- `lib/prompts.js` gains `buildCoachSystemInstruction` (via `buildSystemInstruction(action, settings, opts)`,
  a new `'coach'` branch) and `COACH_CATEGORY_NAMES`; `lib/ai.js` gains `runCoach`, requesting
  `responseMimeType: 'application/json'` and validating the four-category shape before trusting it.
- A response that fails to parse as the required shape retries once with a stricter reminder; a
  second failure degrades to an overall-only result (no per-category breakdown, no spans) rather
  than surfacing as an error — a content-shape failure is not a network one, and must never look
  like `TIMEOUT` or `SERVER` to the user.
- If Kalima later serves a language other than English, or a genuinely different assessment
  framework, this ADR's "generic, non-exam" constraint stays — only the "English-only" scope
  would need revisiting, in a later ADR.
