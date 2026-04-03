# Workbot

Reusable AI work automation architecture with a persistent Obsidian-based brain.

## CRITICAL — Do Not Modify These Files

**NEVER read, write, delete, or modify any of these files or directories. They contain encrypted secrets, auth state, and system config that will break the entire workbot if tampered with.**

| Path | What it is | Why it's dangerous |
|------|-----------|-------------------|
| `.workbot/services.json` | Encrypted service tokens (AES-256-GCM) | Modifying = permanent loss of all service connections |
| `.workbot/auth.json` | Dashboard login credentials (bcrypt) | Modifying = locked out of dashboard |
| `.workbot/.active-key` | Ephemeral decryption key | Deleting = can't decrypt services until re-login |
| `.workbot/certs/` | TLS certificates | Modifying = HTTPS breaks |
| `.workbot/subagent-claude-home/` | Subagent Claude credentials | Modifying = subagents lose auth |
| `.workbot/dashboard.json` | Dashboard layout config | Only modify via dashboard Settings UI |
| `.mcp.json` | MCP server configuration | Only modify via dashboard MCP tab |
| `.claude/` | Claude Code project settings | Auto-managed, do not touch |
| `entrypoint.sh` | Container startup script | Modifying = container may not start |

**If you need to check service status**, use the `service_status` MCP tool — never read services.json directly.

**If you need to check auth status**, use `claude auth status` — never read auth files directly.

**If something is broken**, tell the user — do not attempt to "fix" encrypted files, credentials, or system config.

## Service Credentials — Always Use MCP First

**NEVER store API keys, tokens, passwords, or credentials in brain notes, environment variables, config files, or code.** All service credentials are managed through the workbot dashboard and accessed via MCP tools.

When you need to connect to any external service:
1. **Check first:** Use `service_status` to see what's already connected
2. **Use existing:** Use `service_request` to make authenticated API calls — the workbot injects auth headers automatically
3. **Need a new service?** Tell the user to connect it via the dashboard — do NOT ask for tokens or store them yourself
4. **Need a new instance?** Tell the user to add it via "+ Add Instance" on the service card in the dashboard

Available services include: GitHub, Airtable, Asana, Gmail, Outlook, SharePoint, Stripe, Supabase, Zendesk, Freshdesk, and more. Each supports multiple named instances with different credentials.

### How to make API calls

**ALWAYS use `service_request`** — never use `curl`, `gh`, `fetch`, or any CLI tool with raw tokens. The MCP injects auth headers automatically.

```
service_request(service="github:universe-rd", method="GET", url="https://api.github.com/user/repos")
service_request(service="github:workbot-wr", method="POST", url="https://api.github.com/repos/owner/repo/issues", body='{"title":"Bug fix"}')
service_request(service="airtable:allbase-rd", method="GET", url="https://api.airtable.com/v0/appXXX/TableName")
```

### Git operations (clone, push, pull)

For git operations, use `git_credentials` first to set up authentication, then use normal git commands:

```
git_credentials(service="github:workbot-wr")   # sets up git auth
# Now git commands work:
git clone https://github.com/org/repo.git
git push origin main
```

**Do NOT:**
- Run `gh` CLI commands with `--token` flags
- Use `curl` with `-H Authorization` (you don't have the token)
- Ask the user for tokens (they're already in the dashboard)
- Store tokens in files, env vars, or brain notes

**If `service_request` fails**, check:
1. Is the service connected? (`service_status`)
2. Is the instance name correct? (e.g., `github:universe-rd` not just `github`)
3. Is the API URL correct? (must be the full URL including https://)

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

## Agent Context Bridge — AGENTS.md

Workbot manages cloud agents (Codex, Jules, etc.) that work on the project but don't have brain access. `AGENTS.md` is the two-way context bridge.

### How it works

- **AGENTS.md** lives in the project root (path configurable in dashboard Settings)
- Workbot (you) curates what context cloud agents need
- Cloud agents append findings to the `## Agent Reports` section
- Workbot assimilates agent reports back into the brain

### When to sync (outbound: brain → AGENTS.md)

At end of session, after updating `context/ACTIVE.md`, also update AGENTS.md if:
- Active tasks or focus changed
- New decisions were made that agents need to respect
- New patterns or corrections were discovered

Use `agents_read` to check current state, then `agents_write` with updated content.

**What to include:** Project context, active tasks, key decisions, patterns/corrections — only what's actionable for agents. Keep it concise (<200 lines). Strip brain-internal details (graph links, tags, aliases).

**What NOT to include:** Credentials, token paths, brain structure details, personal info.

### When to assimilate (inbound: AGENTS.md → brain)

At start of session, after reading `context/ACTIVE.md`, check AGENTS.md for new agent reports:
1. `agents_read` — check the `## Agent Reports` section
2. If reports exist, extract reusable knowledge into brain notes
3. Clear the processed reports from AGENTS.md (rewrite without them)

### AGENTS.md sections

| Section | Managed by | Purpose |
|---------|-----------|---------|
| `## Project` | Workbot (🔒) | Tech stack, structure, conventions |
| `## Active Context` | Workbot (🔒) | Current focus, tasks, blockers |
| `## Key Decisions` | Workbot (🔒) | Architecture choices to respect |
| `## Patterns & Corrections` | Workbot (🔒) | What works / what to avoid |
| `## Agent Reports` | Cloud agents | Findings to be assimilated |

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
**Always commit:** framework files (`_system/`, `_templates/`, `_frameworks/`), vault config, app source code, `AGENTS.md`

## Dev Environment

- `npm run dev` — runs client (:5173) + server (:3001) via concurrently
- Vite proxies `/api` → Express
- Preview launch.json: use `node node_modules/vite/bin/vite.js` (npx broken on Windows)
- Service tokens persist in `.workbot/services.json` (gitignored)


## Docker Container Environment

When running inside a Docker container:

- **Internal ports are 3001 (server) and 5173 (client)** — Docker maps these to host ports. Never change `.workbot/mcp.json` ports from 3001/5173.
- **Vite uses `host: "0.0.0.0"`** in vite.config.ts so Docker port forwarding works.
- **npm install works normally** — `node_modules` is on a Linux-native volume with full symlink support.
- **Do not modify `.workbot/mcp.json` ports** — the entrypoint resets them on container restart.
