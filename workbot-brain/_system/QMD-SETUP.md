# QMD Setup - Semantic Search Layer

> QMD (`@tobilu/qmd`) is the brain's search engine. It indexes all markdown
> in the vault and provides BM25 keyword + vector semantic search via MCP.

## Install

```bash
npm install -g @tobilu/qmd
```

## Initialize the Brain Index

```bash
cd workbot-brain
qmd collection add . --name brain
qmd context add brain "Workbot brain - persistent knowledge store with decisions, patterns, corrections, entities, projects, and daily context"
qmd update
qmd embed
```

## MCP Integration (Claude Code)

Add to `~/.claude/settings.json` or project `.claude/settings.json`:

```json
{
  "mcpServers": {
    "qmd": {
      "command": "qmd",
      "args": ["mcp"]
    }
  }
}
```

Or use HTTP mode for persistent server (keeps models in VRAM):

```bash
qmd mcp --http --daemon
```

## Search Commands

| Need | Command | Mode |
|------|---------|------|
| Keyword search | `qmd search "query"` | BM25 (fast) |
| Semantic search | `qmd vsearch "query"` | Vector (meaning-based) |
| Best quality | `qmd query "query"` | Hybrid + LLM reranking |
| Get specific doc | `qmd get "path/to/file.md"` | Direct retrieval |
| Batch retrieve | `qmd multi-get "knowledge/decisions/*.md"` | Glob pattern |

## MCP Tools (Available to Claude)

When running as MCP server, Claude gets these tools:
- `query` - Hybrid search with reranking (primary search method)
- `get` - Retrieve a specific document
- `multi_get` - Batch retrieval by pattern
- `status` - Index health info

## Re-indexing

Run after adding/modifying brain notes:

```bash
qmd update && qmd embed
```

## Index Location

QMD stores its SQLite index alongside the configuration. The index file
should be gitignored (it's derived data, rebuilt from the markdown files).
