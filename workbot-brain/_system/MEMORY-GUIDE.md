# MEMORY GUIDE

> Reference doc. Do NOT load at boot. Read only when you need guidance on memory operations.

## Architecture

```
context/ACTIVE.md          ← Only hot file. 60-line cap.
context/CORRECTIONS.md     ← Read on demand when relevant.
context/YYYY-MM-DD.md      ← Daily logs. Read only today's if needed.
knowledge/{decisions,patterns,corrections,entities,projects}/
                           ← Search by keyword, read individual files.
inbox/                     ← Quick captures. Process within 3 days.
archive/                   ← Cold storage. Search only when stuck.
```

## Search Strategy

**Primary: QMD CLI** (required — not optional)

| Need | Command | Speed |
|------|---------|-------|
| Keyword match | `qmd search "keyword"` | Instant (BM25) |
| Semantic question | `qmd vsearch "natural language"` | ~5s (vector) |
| Read specific note | `qmd get "path/to/note.md"` | Instant |

**Fallback: Grep/Glob** (only if QMD is broken/unavailable)

| Need | Action |
|------|--------|
| Keyword match | `Grep "keyword" workbot-brain/knowledge/` |
| Find file by name | `Glob "workbot-brain/**/*auth*.md"` |

**Always loaded (no search needed):** `context/ACTIVE.md` (~60 lines at boot)

**Never** read a directory listing and then read each file. Search first, read the hit.

## Memory Types

| Type | Location | Lifespan | When to Create |
|------|----------|----------|----------------|
| Decision | `knowledge/decisions/` | Until superseded | Choice made between options |
| Pattern | `knowledge/patterns/` | Until invalidated | Same thing works 2+ times |
| Correction | `context/CORRECTIONS.md` | Permanent | User corrects you |
| Entity | `knowledge/entities/` | Permanent | New person/system/service |
| Context | `context/YYYY-MM-DD.md` | 30 days | Significant session work |
| Project | `knowledge/projects/` | Project duration | New project starts |

## Writing Rules

- Check for existing note first (`qmd search` before creating)
- Update existing notes over creating new ones
- Use template from `_templates/` when creating new notes
- Keep individual notes under 40 lines

## Obsidian Linking Rules (Required)

Every note must follow these to keep the graph connected:

1. **≥1 wikilink per note** — no orphans allowed
2. **`## Related` section** — use typed link prefixes:
   - `See also: [[Note]]` | `Informed by: [[Decision]]` | `Confirmed by: [[Pattern]]`
   - `Corrected in: [[Correction]]` | `Part of: [[Project]]` | `Supersedes: [[Old]]`
3. **Inline links** — when mentioning another note in body text, use `[[Note Title]]`
4. **Frontmatter tags** — every note gets:
   - Type: `#decision`, `#pattern`, `#correction`, `#entity`, `#project`, `#context`
   - Status: `#status/active`, `#status/superseded`, `#status/archived`
   - Domain: `#domain/infrastructure`, `#domain/auth`, `#domain/ui`, etc.
5. **Aliases** — add `aliases: [short name]` in frontmatter for flexible wikilink resolution

## ACTIVE.md Budget (60 lines)

| Section | Lines |
|---------|-------|
| Current Focus | 5 |
| Tasks | 15 |
| Blockers | 5 |
| Recent Corrections | 10 |
| Next Actions | 5 |
| Session Notes | 20 |

Exceeds 60? Move completed tasks and resolved items to daily context or archive.
