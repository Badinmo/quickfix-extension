/**
 * Local-only template storage: save, list, delete, rename, and fill in the
 * blanks of a saved template. Pure schema-and-storage, the same shape as
 * lib/config.js — no network call, no AI, no dependency on the provider seam
 * in lib/ai.js. Templates persist in their own `chrome.storage.local` key,
 * alongside settings and the API key, with the same "never leaves this
 * machine" guarantee.
 */

const TEMPLATES_KEY = 'templates';

/** Past this many saved templates, saveTemplate refuses rather than growing storage without bound. */
export const MAX_TEMPLATES = 50;

async function readAll() {
  const { [TEMPLATES_KEY]: templates } = await chrome.storage.local.get({ [TEMPLATES_KEY]: [] });
  return templates;
}

async function writeAll(templates) {
  await chrome.storage.local.set({ [TEMPLATES_KEY]: templates });
}

/**
 * Save a new template. `fields` are offsets into `text` marking the spans
 * that vary between uses (a name, an order number, a date) — the same shape
 * the Template action annotates a selection with. The concrete example
 * values sitting at those spans are never replayed by fillTemplate, only
 * each field's `label`, so a saved example never leaks into a later reuse.
 *
 * Throws a plain Error (not an AiError/provider code) past MAX_TEMPLATES,
 * for the UI to show directly and ask the user to delete one first.
 */
export async function saveTemplate({ name, text, fields }) {
  const templates = await readAll();
  if (templates.length >= MAX_TEMPLATES) {
    throw new Error(`You have ${MAX_TEMPLATES} saved templates already — delete one before saving another.`);
  }
  const template = {
    id: crypto.randomUUID(),
    name,
    text,
    fields: fields.map(({ start, end, label }) => ({ start, end, label })),
    createdAt: Date.now(),
    lastUsedAt: null
  };
  templates.push(template);
  await writeAll(templates);
  return template;
}

/** All saved templates, oldest first (storage order). */
export async function listTemplates() {
  return readAll();
}

export async function deleteTemplate(id) {
  const templates = await readAll();
  await writeAll(templates.filter((t) => t.id !== id));
}

export async function renameTemplate(id, name) {
  const templates = await readAll();
  const template = templates.find((t) => t.id === id);
  if (!template) throw new Error('That template no longer exists.');
  template.name = name;
  await writeAll(templates);
}

/** Record that a template was just used (Reuse's "Insert into page", #18) — for listTemplates' "last used" display. */
export async function recordTemplateUse(id) {
  const templates = await readAll();
  const template = templates.find((t) => t.id === id);
  if (!template) return; // nothing to record against — not the caller's problem
  template.lastUsedAt = Date.now();
  await writeAll(templates);
}

/**
 * Build the text for one use of a template. Each field is replaced by
 * `values[field.label]` when it is a non-empty string, else by a visible
 * `[Label]` placeholder — filling never blocks on a missing value and never
 * reproduces the example text the template was saved with.
 */
export function fillTemplate(template, values = {}) {
  const fields = [...template.fields].sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const field of fields) {
    out += template.text.slice(cursor, field.start);
    const value = values[field.label];
    out += typeof value === 'string' && value ? value : `[${field.label}]`;
    cursor = field.end;
  }
  out += template.text.slice(cursor);
  return out;
}
