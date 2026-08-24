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
 * @param {'grammar'|'translate'} action
 * @param {object} settings
 * @returns {string} system instruction
 */
export function buildSystemInstruction(action, settings) {
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
 */
export function buildUserPrompt(text) {
  return [
    'Here is the selected text, between the markers. Rewrite it according to your instructions and output only the result, without the markers.',
    '',
    '<<<TEXT',
    text,
    'TEXT>>>'
  ].join('\n');
}
