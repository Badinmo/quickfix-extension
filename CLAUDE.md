# Kalima (working name: QuickFix)

Chrome/Edge extension that fixes or translates selected text in place. See `README.md` for how
it is put together, `CONTEXT.md` for vocabulary, and `docs/decisions.md` for the product
decisions behind the next release.

## Agent skills

### Issue tracker

Issues and specs live as GitHub Issues on `Badinmo/quickfix-extension`, via the `gh` CLI.
See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`.
See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at the root, ADRs in `docs/adr/`. See `docs/agents/domain.md`.
