# PROTOCOLS

> Reference doc. Do NOT load at boot. Read only when you need procedural guidance.

## Task Execution

1. **Load** - Read ACTIVE.md. Pull specific brain notes only if the task topic matches.
2. **Orient** - Assess what's needed. Identify unknowns.
3. **Investigate** - Search brain, codebase, or web for unknowns.
4. **Execute** - Do the work.
5. **Verify** - Confirm it works.
6. **Capture** - Write to brain only if something reusable was learned.

**Bail out and ask the user if:** stuck 3+ attempts, need destructive action, or in unfamiliar territory.

## Memory Protocol

**Write when:** decision made, user corrects you, pattern confirmed 2+ times, non-obvious discovery.
**Skip when:** session-specific, already documented, speculative, or business data that belongs elsewhere.

Before writing: search via QMD `query` (or Grep fallback) for existing note. Update over create. Keep notes under 40 lines.
After writing: run `qmd update && qmd embed` to re-index if QMD is available.

## Correction Protocol

1. Acknowledge immediately
2. Append to `context/CORRECTIONS.md` (date + what to do instead)
3. Apply to current task
4. If it reveals a pattern, note in `knowledge/patterns/`

**Detection:** "Actually...", "No, I meant...", "Don't do that...", "Always/Never..."

## Session Handoff

1. Update `context/ACTIVE.md` with current state (keep under 60 lines)
2. Write daily context only if the session was substantial
3. Capture decisions in `knowledge/decisions/` only if they'll matter next session

## Content Boundaries

**Commit (framework):** templates, protocols, schemas, vault config
**Gitignored (content):** decisions, entities, corrections, daily context, projects
**Elsewhere:** business data, source code, credentials
