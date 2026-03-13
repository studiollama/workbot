# Workbot

Reusable AI work automation architecture with a persistent Obsidian-based brain.

## Stateless Sessions — Brain is the Only Memory

**Do NOT use Claude Code's auto-memory system** (`~/.claude/projects/.../memory/`). This project is designed to be cloned per business — auto-memory would leak data between instances.

All persistent knowledge lives in `workbot-brain/`. Each conversation starts stateless and bootstraps from the brain.

## Brain Usage — Context Minimization

**Boot:** Read only `workbot-brain/context/ACTIVE.md` (60-line cap). Nothing else at startup.

**During work:** Search brain via QMD CLI — this is **required**, not optional:
- `qmd search "keyword"` — instant BM25 keyword search (use first)
- `qmd vsearch "natural language question"` — vector semantic search (~5s, use when keyword misses)
- `qmd get <path>` — read a specific brain note by path
- Fall back to Grep/Glob on `workbot-brain/` **only if QMD is broken/unavailable**
- Never preload brain files. Never read `_system/` unless you need procedural guidance.

**End of session:** Update `context/ACTIVE.md` with current state. Write to brain only if something reusable was learned. Use the templates in `_templates/` when creating new brain notes.

### Where to Write What

| Type | Brain Location | When |
|------|---------------|------|
| Current focus/tasks | `context/ACTIVE.md` | Every session end |
| User corrections | `knowledge/corrections/` | When corrected |
| Architecture decisions | `knowledge/decisions/` | When decided |
| Reusable patterns | `knowledge/patterns/` | When discovered |
| Project state | `knowledge/projects/` | When project changes |
| People/services/tools | `knowledge/entities/` | When learned |

## Obsidian Graph — Linking Rules

The brain is a **connected knowledge graph**, not a filing cabinet. Obsidian's graph view visualizes connections between notes. **Every note you create or update must follow these rules:**

### Wikilinks (Required)
- **Every note must have ≥1 outgoing `[[wikilink]]`** — no orphan notes allowed
- Use `[[Note Title]]` syntax (Obsidian resolves by title, not path)
- Link in the `## Related` section using typed prefixes:
  - `See also: [[Note]]` — general relationship
  - `Informed by: [[Decision]]` — decision dependency
  - `Confirmed by: [[Pattern]]` — pattern validation
  - `Corrected in: [[Correction]]` — correction reference
  - `Part of: [[Project]]` — project membership
  - `Supersedes: [[Old Decision]]` — decision evolution
- Also inline-link when mentioning another note in body text

### Tags (Required in Frontmatter)
Every note gets tags in YAML frontmatter for graph filtering:
- **Type tag:** `#decision`, `#pattern`, `#correction`, `#entity`, `#project`, `#context`, `#retrospective`
- **Status tag:** `#status/active`, `#status/superseded`, `#status/archived`
- **Domain tag:** `#domain/infrastructure`, `#domain/auth`, `#domain/ui`, etc.

### Aliases (Recommended)
Add `aliases: [short name, abbreviation]` in frontmatter so wikilinks resolve flexibly.

### Graph Color Key
The graph view color-codes nodes by type tag:
- 🟠 Orange = `#project`
- 🔵 Blue = `#decision`
- 🟢 Green = `#pattern`
- 🔴 Red = `#correction`
- 🟣 Purple = `#entity`
- 🟡 Yellow = `#context`
- ⚫ Gray = `#retrospective`

### Graph Health
- No orphan notes (every note linked to ≥1 other)
- Clusters form around projects and domains
- Decisions link to their context (patterns, corrections, entities)
- Use graph filters: `tag:#status/active` (depth 2), `path:knowledge/decisions` (depth 3)

## Dashboard & MCP Services

The workbot dashboard (`client/` + `server/`) manages connections to external services (GitHub, Airtable, Asana, Codex). Tokens are validated against each service's API and persisted to `.workbot/services.json` (project-local, gitignored).

**When you need to interact with external services**, read `_system/DASHBOARD.md` for:
- Available services and their APIs
- How to read stored tokens for automation
- How to add new services
- API endpoints reference

## Search Layer

QMD (`@tobilu/qmd`) indexes all brain markdown into SQLite with BM25 + vector semantic search. Available as MCP server. See `_system/QMD-SETUP.md` for install/config.

**CPU-only mode required** — Vulkan compute crashes the GTX 970. See `knowledge/corrections/qmd-gpu-crash.md`.

## Project Structure

- `workbot-brain/_system/` - Core brain mechanics (reference docs, not boot-loaded)
- `workbot-brain/_templates/` - Note templates (read only when creating new notes)
- `workbot-brain/_frameworks/` - Framework reference docs (read only when needed)
- `workbot-brain/context/` - Operational context (gitignored)
- `workbot-brain/knowledge/` - Deep knowledge by type (gitignored)
- `workbot-brain/inbox/` - Unprocessed captures (gitignored)
- `workbot-brain/archive/` - Cold storage (gitignored)
- `client/` - React/Vite/Tailwind frontend
- `server/` - Express/TypeScript backend

## Content Boundary

**Never commit:** business data, content dirs (`context/`, `knowledge/`, `inbox/`, `archive/`), names, credentials, `.workbot/`, `.codex/`
**Always commit:** framework files (`_system/`, `_templates/`, `_frameworks/`), vault config, app source code

## Dev Environment

- `npm run dev` — runs client (:5173) + server (:3001) via concurrently
- Vite proxies `/api` → Express
- Preview launch.json: use `node node_modules/vite/bin/vite.js` (npx broken on Windows)
- Service tokens persist in `.workbot/services.json` (gitignored)
