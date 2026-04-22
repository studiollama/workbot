#!/bin/bash
# Hook: Stop — runs after each Claude response for subagents
# Blocks (exit 2) until the agent saves context and knowledge to brain

BRAIN_DIR="${BRAIN_DIR:-$(pwd)}"
ACTIVE_FILE="$BRAIN_DIR/context/ACTIVE.md"
SAVE_MARKER="/tmp/.subagent-saved-$(echo "$BRAIN_DIR" | md5sum | cut -d' ' -f1)"

# Read stdin (hook input JSON)
cat > /dev/null

# If the save marker exists, the agent already saved this turn — let it finish
if [ -f "$SAVE_MARKER" ]; then
  rm -f "$SAVE_MARKER"
  exit 0
fi

# Check if ACTIVE.md was modified in the last 30 seconds (agent just saved)
if [ -f "$ACTIVE_FILE" ]; then
  MTIME=$(stat -c %Y "$ACTIVE_FILE" 2>/dev/null || echo 0)
  NOW=$(date +%s)
  DIFF=$((NOW - MTIME))
  if [ "$DIFF" -lt 30 ]; then
    exit 0
  fi
fi

# Create save marker so next Stop passes through
touch "$SAVE_MARKER"

# Block and instruct the agent to save (stderr = feedback to Claude on exit 2)
echo "BRAIN SAVE REQUIRED — You must complete these steps before your turn ends:

1. UPDATE context/ACTIVE.md with current session state (what you worked on, progress, next steps). Keep under 60 lines.

2. SAVE any new knowledge learned to the appropriate brain folder:
   - Decisions → knowledge/decisions/
   - Patterns → knowledge/patterns/
   - Corrections → knowledge/corrections/
   - Entities → knowledge/entities/
   - Projects → knowledge/projects/

3. If knowledge is broadly useful for OTHER agents, also save to common knowledge via common_write.

Use brain_write and brain_update MCP tools. Every note needs frontmatter tags and ≥1 [[wikilink]]." >&2

exit 2
