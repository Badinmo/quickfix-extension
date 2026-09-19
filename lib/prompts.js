/**
 * Prompt construction. Kept in one place so the wording is easy to tune.
 *
 * Every prompt is built around one rule: the model receives ONLY the text the
 * user selected, and must return ONLY the rewritten version of that text — no
 * preamble, no commentary, no markdown fences. Anything else breaks inline
 * replacement.
 */

const TONE_CLAUSE = {
  preserve: 'Match the tone and register of the original text.',
  professional: 'Use a professional, workplace-appropriate tone.',
  plain: 'Use plain, everyday English. Avoid jargon and long sentences.',
  concise: 'Be concise. Remove padding and repetition, but keep every fact.',
  friendly: 'Use a warm, friendly, approachable tone.',
  formal: 'Use a formal tone.'
};

const SHARED_RULES = [
  'Preserve line breaks, blank lines, bullet/number markers and indentation exactly as they appear.',
  'Never alter URLs, email addresses, file paths, code, command names, ticket/reference numbers, IDs, dates, times or numbers.',
  'Never alter people\'s names, team names, product names or acronyms.',
  'The input may be a fragment of a larger sentence. Treat it as-is: do not complete it, do not add a greeting or sign-off, do not add a heading.',
  'Do not wrap the output in quotation marks, backticks or markdown code fences.',
  'Do not explain what you changed. Do not add any commentary before or after.',
  'Output the resulting text and nothing else.'
];

function block(lines) {
  return lines.map((l) => `- ${l}`).join('\n');
}

/**
 * The four dimensions every Coach breakdown covers, in this fixed order
 * (ADR 0007). Named after what a general-audience writer actually notices —
 * never framed as an exam or given a numeric score.
 */
export const COACH_CATEGORY_NAMES = ['Grammar & accuracy', 'Word choice', 'Clarity & flow', 'Tone & register'];

const COACH_JSON_SHAPE = `{
  "overall": { "level": "weak" | "fair" | "good" | "strong", "note": string },
  "categories": [
    { "name": string, "level": "weak" | "fair" | "good" | "strong", "note": string, "spans": [{ "start": number, "end": number }] }
  ]
}`;

/** The Coach system instruction. `strict` is used for the one retry after a response that failed to parse. */
function buildCoachSystemInstruction(strict) {
  const reminder = strict
    ? 'Your previous reply could not be read as valid JSON in the required shape. This time, output ONLY the JSON object below (or, if the text is not in English, only {"nonEnglish": true}) — nothing else, no markdown fences, no commentary.\n\n'
    : '';

  return [
    reminder +
      'You are a friendly writing coach embedded in a browser extension. You look at a snippet of text the user selected and give a short, encouraging breakdown of its quality — you never rewrite it.',
    '',
    'If the text is not written primarily in English, respond with exactly this JSON and nothing else:',
    '{"nonEnglish": true}',
    '',
    'Otherwise, respond with exactly one JSON object, and nothing else, in this exact shape:',
    COACH_JSON_SHAPE,
    '',
    'Rules:',
    block([
      `"categories" must contain exactly these four entries, in this exact order: ${COACH_CATEGORY_NAMES.join(', ')}.`,
      '"level" is a simple strength signal only — never a numeric score, percentage or letter grade.',
      '"note" is one short, specific, plain-language sentence per category. No jargon.',
      '"spans" is optional: when you can point to the exact part of the text a note is about, give its 0-based character offsets into the text between the markers below (end exclusive). Omit "spans" entirely when you cannot.',
      'Never rewrite the text or suggest a full replacement for it — that is a different action.',
      'Do not wrap the output in quotation marks, backticks or markdown code fences.',
      'Do not explain anything before or after the JSON.',
      'Output the JSON object and nothing else.'
    ])
  ].join('\n');
}

/**
 * @param {'grammar'|'translate'|'coach'} action
 * @param {object} settings
 * @param {{ strict?: boolean }} [opts]  strict: Coach's one stricter retry after a malformed reply
 * @returns {string} system instruction
 */
export function buildSystemInstruction(action, settings, opts = {}) {
  if (action === 'coach') {
    return buildCoachSystemInstruction(Boolean(opts.strict));
  }

  const custom = (settings.customInstructions || '').trim();
  const customBlock = custom
    ? `\n\nAdditional standing instructions from the user (these take priority where they conflict, except for the output-format rules above):\n${custom}`
    : '';

  if (action === 'translate') {
    const target = settings.targetLanguage || 'Arabic';
    const secondary = settings.secondaryLanguage || 'English';
    const swap = settings.autoSwapLanguage
      ? `If the text is already written in ${target}, translate it into ${secondary} instead.`
      : `If the text is already written in ${target}, return it unchanged.`;

    return [
      'You are a translation engine embedded in a browser extension. You translate a snippet of text that the user has selected inside a text field, and the translation is inserted back in its place.',
      '',
      `Translate the text into ${target}.`,
      swap,
      '',
      'Rules:',
      block([
        'Translate meaning, not words. The result must read naturally to a native speaker.',
        'Keep the same register as the source (formal stays formal, casual stays casual).',
        ...SHARED_RULES
      ])
    ].join('\n') + customBlock;
  }

  const tone = TONE_CLAUSE[settings.tone] || TONE_CLAUSE.preserve;

  return [
    'You are a copy-editor embedded in a browser extension. You edit a snippet of text that the user has selected inside a text field, and your output is inserted back in its place.',
    '',
    'Fix grammar, spelling, punctuation and awkward phrasing, and improve clarity and structure.',
    '',
    'Rules:',
    block([
      'Preserve the original meaning, intent and level of detail. Never add information that is not there, and never drop information that is.',
      'Keep the text in its original language. Do not translate it.',
      tone,
      'Make the minimum number of changes needed. If the text is already correct, return it unchanged.',
      ...SHARED_RULES
    ])
  ].join('\n') + customBlock;
}

/**
 * The user turn. The text is fenced with sentinels so the model can tell where
 * the selection starts and ends even when it contains blank lines, and is told
 * explicitly not to echo the sentinels.
 *
 * @param {'grammar'|'translate'|'coach'} [action]  coach is assessed, not rewritten; everything else is a rewrite
 */
export function buildUserPrompt(text, action) {
  const instruction =
    action === 'coach'
      ? 'Here is the selected text, between the markers. Assess it according to your instructions and output only the JSON, without the markers.'
      : 'Here is the selected text, between the markers. Rewrite it according to your instructions and output only the result, without the markers.';
  return [instruction, '', '<<<TEXT', text, 'TEXT>>>'].join('\n');
}
