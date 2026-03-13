# Daily Brain Maintenance Runbook

> This file is the reference for the `brain-maintenance` scheduled task.
> The task runs daily and performs all steps below in order.

## 1. Boot

Read `workbot-brain/context/ACTIVE.md` — this is the only file loaded at start.

## 2. ACTIVE.md Consolidation (60-line cap)

```
Count lines in context/ACTIVE.md
If > 60 lines:
  - Move completed tasks ([x]) to today's daily context
  - Move resolved blockers to daily context
  - Summarize and compress session notes
  - Keep only active/relevant items
```

## 3. Inbox Processing (3-day SLA)

```
Check inbox/ for files older than 3 days:
  For each stale capture:
    - Read content
    - Classify: decision | pattern | correction | entity | context
    - If matches existing note → merge into it
    - If new → create from _templates/ with proper tags + wikilinks
    - Delete the inbox capture after processing
```

## 4. QMD Re-index

```
cd workbot-brain/
qmd update    → re-index changed markdown files
qmd embed     → regenerate vectors for changed content
```

This ensures any notes created/updated since last run are searchable.

## 5. Orphan Check (Graph Health)

```
For each .md file in knowledge/ and context/:
  - Check if it contains at least one [[wikilink]]
  - If no wikilinks found:
    - Try to identify related notes via qmd search
    - Add appropriate links in ## Related section
    - Log the fix in daily context
```

## 6. Stale Context Archival (30-day lifecycle)

```
For each daily context file in context/ (format: YYYY-MM-DD.md):
  If older than 30 days:
    - Create/append summary to archive/summaries/YYYY-MM.md
    - Move file to archive/YYYY/MM/
    - Fix any broken wikilinks pointing to moved file
```

## 7. Corrections Review

```
If context/CORRECTIONS.md exists and has > 20 entries:
  - Move fully internalized corrections to knowledge/corrections/
  - Keep only active/recent corrections in CORRECTIONS.md
```

## 8. Write Daily Context

Create `context/YYYY-MM-DD.md` (today's date) using template with:
- Session: "Automated maintenance"
- Summary of actions taken (what was consolidated, processed, archived)
- Link any notes that were created or modified

## 9. Update ACTIVE.md

Add a note under `## Notes` that maintenance ran today with brief summary.

## Linking Rules (Apply to ALL created/modified notes)

- Every note gets ≥1 `[[wikilink]]` — no orphans
- Frontmatter tags: type + status + domain
- Use `aliases:` for flexible linking
- Typed link prefixes in `## Related`: See also | Part of | Corrected in | etc.
