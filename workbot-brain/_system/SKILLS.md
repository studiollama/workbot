# Skills Integration

Skills are Claude Code instruction files (SKILL.md) that modify Claude's behavior during sessions. They provide workflow guidance, code patterns, and guardrails.

## Priority Hierarchy

1. **CLAUDE.md** — always highest priority, establishes brain-first behavior
2. **Brain knowledge** — decisions, corrections, patterns from `workbot-brain/`
3. **Skills** — workflow guidance from `.claude/skills/`
4. **Development project context** — the cloned repo in `development/`

If a skill conflicts with a brain decision or correction, **the brain wins**.

## Skill Storage

- **Workbot skills**: `.claude/skills/<skill-id>/SKILL.md` (gitignored, local only)
- **Skill state**: `.workbot/skills.json` (gitignored, tracks enabled/installed/risk)
- **Development project skills**: `development/.claude/skills/` (managed by the dev project)

Workbot stays a blank clonable template — no skills are committed to git.

## Skill Lifecycle

1. **Curated** — Pre-assessed skills built into the dashboard. Risk level and source verified.
2. **Added** — User provides GitHub URL. Defaults to disabled + unassessed risk.
3. **Installed** — SKILL.md fetched from GitHub and written to `.claude/skills/<id>/SKILL.md`.
4. **Enabled** — Active in Claude Code sessions. Only enabled + installed skills take effect.
5. **Disabled/Uninstalled** — Skill file removed from disk, stops affecting behavior.

## Development Project Skills

When a development project is set (cloned into `development/`):
- The dev project manages its own `.claude/skills/` independently
- Workbot does NOT auto-sync skills into the dev project
- Cloud agents working on the dev project use the dev project's own skills
- Brain knowledge is bridged to agents via AGENTS.md, not via skills

## Brain Entity Notes for Skills

When a skill is installed and provides significant value, create a brain entity note:
- Path: `knowledge/entities/skill-<name>.md`
- Tags: `#entity`, `#status/active`, `#domain/<relevant-domain>`
- Link to related decisions and patterns

This tracks why a skill was chosen and how it integrates with the workflow.
