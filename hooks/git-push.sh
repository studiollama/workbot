#!/bin/bash
# Push current changes to GitHub using the workbot-wr service token
cd /app

# Get token from internal API
TOKEN=$(curl -sk https://localhost:3001/api/internal/store | node -e '
let d="";
process.stdin.on("data",c=>d+=c);
process.stdin.on("end",()=>{
  try{const s=JSON.parse(d);const g=s["github:workbot-wr"];if(g)console.log(g.token);else process.exit(1);}
  catch{process.exit(1);}
});
' 2>/dev/null)

if [ -z "$TOKEN" ]; then
  echo "ERROR: Could not get GitHub token from internal API"
  exit 1
fi

# Configure git
git config credential.helper "!f() { echo username=x-access-token; echo password=$TOKEN; }; f"
git config user.email "workbot@sherwood-mgmt.com"
git config user.name "Workbot"

# Stage and commit
git add -A
git status
echo "---"
git commit -m "Update: hooks, Oracle client, auto-spawn fixes, tmux session tracking

- Add subagent Stop/SessionStart hooks for automatic brain saves
- Add Oracle Instant Client to Docker image for 11g thick mode
- Fix auto-spawn tmux session tracking (runuser exits immediately)
- Use tmux has-session as source of truth for running status
- Add regenerate-hooks endpoint and utility script
- Replace require() with ESM imports in subagents route

Co-Authored-By: Claude <noreply@anthropic.com>"

git push origin main
