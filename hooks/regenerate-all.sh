#!/bin/bash
# Regenerate hook configs for all existing subagents
# Run inside the container: bash /app/hooks/regenerate-all.sh

HOOKS_DIR=/app/hooks
BRAIN_ROOT=/app/workbot-brain

# Find all subagent brain dirs
for BRAIN_DIR in "$BRAIN_ROOT"/subagents/*/; do
  [ -d "$BRAIN_DIR" ] || continue
  ID=$(basename "$BRAIN_DIR")
  CLAUDE_DIR="$BRAIN_DIR/.claude"
  MCP_NAME="workbot-$ID"
  PREFIX="mcp__${MCP_NAME}__"

  mkdir -p "$CLAUDE_DIR"

  cat > "$CLAUDE_DIR/settings.local.json" << EOF
{
  "permissions": {
    "allow": [
      "${PREFIX}brain_search", "${PREFIX}brain_vsearch", "${PREFIX}brain_get",
      "${PREFIX}brain_write", "${PREFIX}brain_update", "${PREFIX}brain_list",
      "${PREFIX}brain_context", "${PREFIX}service_status", "${PREFIX}service_request",
      "${PREFIX}git_credentials", "${PREFIX}common_search", "${PREFIX}common_vsearch",
      "${PREFIX}common_get", "${PREFIX}common_list", "${PREFIX}common_write",
      "${PREFIX}common_commit", "${PREFIX}debug_env"
    ],
    "deny": []
  },
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "SUBAGENT_ID=${ID} BRAIN_DIR=${BRAIN_DIR%/} bash ${HOOKS_DIR}/subagent-session-start.sh",
        "statusMessage": "Loading brain context..."
      }]
    }],
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "SUBAGENT_ID=${ID} BRAIN_DIR=${BRAIN_DIR%/} bash ${HOOKS_DIR}/subagent-stop.sh",
        "statusMessage": "Saving brain context..."
      }]
    }]
  }
}
EOF

  echo "Updated hooks for $ID"
done

echo "Done"
