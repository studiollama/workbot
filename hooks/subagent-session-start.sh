#!/bin/bash
# Hook: SessionStart — runs when a subagent session begins
# Injects brain context so the agent knows its state
#
# Environment: SUBAGENT_ID, BRAIN_DIR set by the hook command wrapper

BRAIN_DIR="${BRAIN_DIR:-$(pwd)}"
ACTIVE_FILE="$BRAIN_DIR/context/ACTIVE.md"

# Clean up any stale save markers from previous sessions
rm -f /tmp/.subagent-saved-* 2>/dev/null

# Read ACTIVE.md content
ACTIVE_CONTENT=""
if [ -f "$ACTIVE_FILE" ]; then
  ACTIVE_CONTENT=$(cat "$ACTIVE_FILE")
fi

# Build context injection
cat << EOF
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"BRAIN BOOT — Your saved context:\n\n${ACTIVE_CONTENT}\n\nYou MUST use your scoped MCP tools for all brain and service operations. At the end of each conversation turn, you will be required to save your context and any learned knowledge to your brain."}}
EOF

exit 0
