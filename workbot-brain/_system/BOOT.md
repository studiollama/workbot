# BOOT - Brain Initialization Protocol

> Minimize context usage. Load the least possible to orient, then pull on demand.

## Boot Sequence

### Phase 1: Orient (1 file only)
Read `context/ACTIVE.md` only. This single file contains current focus, tasks, blockers, and recent corrections summary. Everything needed to orient is here.

Skip IDENTITY.md, PROTOCOLS.md, MEMORY-GUIDE.md at boot - these are reference docs, not session context. Only read them when their specific guidance is needed.

### Phase 2: Work
Start working on whatever the user asks. Pull from the brain **only when a specific question arises** during the task.

**Use QMD MCP tools as the primary search method:**
- `query "what was decided about X"` - semantic + keyword hybrid search (best quality)
- `get "path/to/file.md"` - retrieve a specific known file
- `multi_get "knowledge/decisions/*.md"` - batch retrieve by pattern

**Fallback to Grep/Glob** only if QMD MCP is unavailable. Never scan entire directories.

### Phase 3: Capture (end of session)
Update `context/ACTIVE.md` with new state. Write other notes only if something genuinely reusable was learned.

## Rules

- **Load 1 file at boot, not 3-6.** ACTIVE.md is the only hot file.
- **Search before reading.** Use QMD `query` to find relevant notes semantically rather than reading files speculatively. Fall back to Grep if QMD unavailable.
- **Read sections, not files.** Use line offsets to read only relevant portions of large notes.
- **Never preload.** No file is read "just in case."
- **ACTIVE.md cap: 60 lines.** If it grows past this, consolidate immediately.
- **Templates are write-time references.** Read a template only when creating a new note, not at boot.

## First Boot (New Instance)

When no content exists:
1. Create `context/ACTIVE.md` - minimal: current focus + empty task list (~15 lines)
2. Ask the user about the workbot's purpose, populate `_system/IDENTITY.md`
3. Start working. The brain fills organically.
