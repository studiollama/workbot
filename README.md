# Workbot

AI work automation platform with a persistent Obsidian-based brain, service integrations, DAG workflow engine, and multi-tenant subagent system.

## Features

- **Dashboard** — HTTPS web UI with dark/light mode (glassmorphism), service management, brain viewer, MCP tools, skills, workflows, logs, and subagents
- **Brain** — Obsidian vault with QMD-powered BM25 + vector search, wikilinked knowledge graph, interactive graph view, folder navigation, inline editor, cross-brain linking
- **Common Knowledge** — Shared brain accessible to all agents with git-tracked changes, per-agent commit identity, and read-only mode option
- **Services** — 25+ integrations with multi-instance support (multiple keys per service type), encrypted tokens (AES-256-GCM), and `git_credentials` tool for native git operations
- **Workflows** — DAG-based orchestration with shell, Python, MCP tool, Claude prompt, and brain write nodes. Cron scheduling, webhooks, conditional edges
- **Subagents** — Isolated agents with Linux user separation, scoped brains, filtered services, web terminals (ttyd), auto-spawn, tmux sessions, independent Claude accounts, per-agent dashboard logins with key holder support
- **Development** — Multi-project management with GitHub integration, per-project clone/pull, commits/issues/PRs view, automatic migration from legacy single-folder setup
- **Security** — HTTPS (auto-generated certs), bcrypt auth, AES-256-GCM encrypted secrets, MCP audit logging with secret redaction, subagent process isolation (uid validation, file permissions), internal-only decryption API
- **MCP Server** — 40+ tools for brain search, common knowledge, service requests, git credentials, workflow management, subagent control, and service context

## Requirements

- **Node.js** 22+
- **npm** 10+
- **Git**
- **Claude Code CLI** (`npm install -g @anthropic-ai/claude-code`)
- **QMD** (optional, for brain search): `npm install -g @tobilu/qmd`

For Docker deployments:
- **Docker** 24+ with Docker Compose v2
- **WSL2** (Windows only)

---

## Installation (Local)

### 1. Clone

```bash
git clone https://github.com/studiollama/workbot.git
cd workbot
```

### 2. Install dependencies

```bash
npm install
npm install -w client
npm install -w server
```

### 3. Configure

```bash
cp .env.example .env
# Edit .env — set SESSION_SECRET to a random string
```

### 4. Start

```bash
npm run dev
```

This starts:
- **Server** on `https://localhost:3001`
- **Client** on `https://localhost:5173`

On first visit, you'll be prompted to create dashboard credentials. This password also encrypts your service tokens at rest.

### 5. Claude Code integration

The MCP server is configured in `.mcp.json`. Claude Code auto-discovers it when you run `claude` from the project directory.

---

## Installation (Windows + WSL2 + Docker)

### Prerequisites

1. **Enable WSL2**
   ```powershell
   wsl --install
   ```

2. **Install Docker in WSL**
   ```bash
   sudo apt-get update
   sudo apt-get install -y docker.io docker-compose-v2
   ```

3. **Add your user to the docker group**
   ```bash
   sudo usermod -aG docker $USER
   newgrp docker
   ```

### Setup

1. **Create the workbots directory**
   ```bash
   mkdir -p /mnt/d/docker/workbots
   cd /mnt/d/docker/workbots
   ```

2. **Create the Dockerfile**
   ```dockerfile
   FROM node:22-slim

   RUN apt-get update && apt-get install -y \
       git curl sudo \
       libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
       libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
       libpango-1.0-0 libcairo2 libasound2 libxshmfence1 libglib2.0-0 \
       fonts-liberation libx11-xcb1 \
       && rm -rf /var/lib/apt/lists/*

   RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
         -o /usr/share/keyrings/githubcli-archive-keyring.gpg && \
       echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
         > /etc/apt/sources.list.d/github-cli.list && \
       apt-get update && apt-get install -y gh && rm -rf /var/lib/apt/lists/*

   RUN npm install -g @anthropic-ai/claude-code@latest @tobilu/qmd

   RUN useradd -m -s /bin/bash workbot && \
       echo "workbot ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/workbot

   RUN mv /usr/local/bin/claude /usr/local/bin/claude-real && \
       printf '#!/bin/bash\nexport HOME=/home/workbot\nexec /usr/local/bin/claude-real "$@"\n' > /usr/local/bin/claude && \
       chmod +x /usr/local/bin/claude

   RUN git config --global --add safe.directory '*'
   RUN mkdir -p /app/node_modules && chown workbot:workbot /app/node_modules && \
       chown -R workbot:workbot /var/log

   USER workbot
   ENV HOME=/home/workbot
   RUN git config --global --add safe.directory '*'

   WORKDIR /app
   COPY --chown=workbot:workbot entrypoint.sh /entrypoint.sh
   RUN chmod +x /entrypoint.sh
   ENTRYPOINT ["/entrypoint.sh"]
   ```

3. **Create the entrypoint.sh**
   ```bash
   #!/bin/bash
   set -e

   WORKBOT_DIR="/app/.workbot"
   mkdir -p "$WORKBOT_DIR"

   # Reset mcp.json to container defaults
   cat > "$WORKBOT_DIR/mcp.json" << EOF
   {
     "qmdCliPath": "/usr/local/lib/node_modules/@tobilu/qmd/dist/cli/qmd.js",
     "nodePath": "$(which node)",
     "agentsFilePath": "AGENTS.md",
     "claudeMdPath": "CLAUDE.md",
     "serverPort": 3001,
     "clientPort": 5173
   }
   EOF

   # Bootstrap dashboard config
   if [ ! -f "$WORKBOT_DIR/dashboard.json" ]; then
     cat > "$WORKBOT_DIR/dashboard.json" << EOF
   {
     "enabledServices": [],
     "workbotName": "${WORKBOT_NAME:-Workbot}",
     "accentColor": "orange-1"
   }
   EOF
   fi

   # Bootstrap services
   if [ ! -f "$WORKBOT_DIR/services.json" ]; then
     echo "{}" > "$WORKBOT_DIR/services.json"
   fi

   # Install dependencies if missing
   if [ ! -d "/app/node_modules/concurrently" ]; then
     echo "[entrypoint] Installing dependencies..."
     cd /app && npm install && npm install -w client && npm install -w server
   fi

   # Generate TLS certs if missing
   if [ ! -f "$WORKBOT_DIR/certs/server.key" ]; then
     echo "[entrypoint] Generating TLS certificates..."
     cd /app && node node_modules/tsx/dist/cli.mjs -e "
       import { ensureCerts } from './server/src/certs.ts';
       ensureCerts().then(() => process.exit(0));
     "
   fi

   # Start dashboard
   echo "[entrypoint] Starting dashboard..."
   cd /app
   node node_modules/tsx/dist/cli.mjs watch server/src/index.ts &
   cd /app/client && node /app/node_modules/vite/bin/vite.js --host 0.0.0.0 &
   cd /app
   sleep 3

   echo "[entrypoint] Starting Claude remote-control (${WORKBOT_NAME})..."
   exec claude remote-control --name "${WORKBOT_NAME}" \
     --permission-mode bypassPermissions \
     --spawn same-dir \
     --verbose
   ```

4. **Create docker-compose.yml**
   ```yaml
   services:
     workbot-myproject:
       build: .
       container_name: workbot-myproject
       hostname: workbot-myproject
       environment:
         - WORKBOT_NAME=My Project
         - SESSION_SECRET=change-me-to-something-random
       ports:
         - "3010:3001"   # Server (HTTPS)
         - "5190:5173"   # Dashboard (HTTPS)
       volumes:
         - ./workbot-myproject:/app
         - nm-myproject:/app/node_modules
         - claude-home-myproject:/home/workbot
       networks:
         - myproject-net
       restart: unless-stopped
       tty: true
       tmpfs:
         - /tmp:size=512M
         - /run:size=64M
       cap_drop:
         - ALL
       cap_add:
         - KILL
         - SETUID
         - SETGID
         - CHOWN
         - DAC_OVERRIDE
         - FOWNER
       pids_limit: 1024
       mem_limit: 4g
       cpus: 2.0
       healthcheck:
         test: ["CMD", "claude", "auth", "status"]
         interval: 5m
         timeout: 10s
         retries: 2
         start_period: 60s

   volumes:
     nm-myproject:
     claude-home-myproject:

   networks:
     myproject-net:
       driver: bridge
   ```

5. **Clone your workbot repo**
   ```bash
   git clone https://github.com/studiollama/workbot.git workbot-myproject
   ```

6. **Build and start**
   ```bash
   docker compose build
   docker compose up -d
   ```

7. **Authenticate Claude Code**
   ```bash
   docker run -it --rm \
     --user workbot \
     -v workbots_claude-home-myproject:/home/workbot \
     --entrypoint claude \
     workbots-workbot-myproject login
   ```
   Follow the OAuth flow in your browser. Auth persists in the Docker volume.

8. **Access the dashboard**
   - Dashboard: `https://localhost:5190`
   - First visit: create credentials (this password encrypts your service tokens)
   - Accept the self-signed certificate warning in your browser

### Adding more instances

Duplicate the service block in `docker-compose.yml` with different names and ports:

```yaml
workbot-second:
  build: .
  container_name: workbot-second
  hostname: workbot-second
  environment:
    - WORKBOT_NAME=Second Bot
  ports:
    - "3011:3001"
    - "5191:5173"
  volumes:
    - ./workbot-second:/app
    - nm-second:/app/node_modules
    - claude-home-second:/home/workbot
  # ... same security settings
```

Then `git clone` another copy and `docker compose up -d`.

---

## Installation (Linux)

### Prerequisites

```bash
# Node.js 22+
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git curl

# Claude Code CLI
npm install -g @anthropic-ai/claude-code

# QMD (optional, for brain search)
npm install -g @tobilu/qmd

# GitHub CLI (optional, for Development tab)
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list
sudo apt-get update && sudo apt-get install -y gh
```

### Local setup

```bash
git clone https://github.com/studiollama/workbot.git
cd workbot
npm install && npm install -w client && npm install -w server
cp .env.example .env
npm run dev
```

### Docker setup (Linux)

```bash
# Install Docker
sudo apt-get install -y docker.io docker-compose-v2
sudo usermod -aG docker $USER
newgrp docker

# Follow the same Docker setup as Windows (steps 1-8 above)
# Skip WSL-specific steps — everything runs natively
mkdir -p ~/docker/workbots
cd ~/docker/workbots
# Create Dockerfile, entrypoint.sh, docker-compose.yml as above
git clone https://github.com/studiollama/workbot.git workbot-myproject
docker compose build && docker compose up -d
```

### Running as a service (systemd)

```bash
sudo tee /etc/systemd/system/workbot.service << EOF
[Unit]
Description=Workbot Dashboard
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=/path/to/workbot
ExecStart=/usr/bin/npm run dev
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable workbot
sudo systemctl start workbot
```

---

## Configuration

### Port Configuration

Ports are stored in `.workbot/mcp.json` (gitignored):
```json
{
  "serverPort": 3001,
  "clientPort": 5173
}
```

In Docker, internal ports are always 3001/5173. Docker maps them to host ports via the compose file.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3001 | Override server port |
| `SESSION_SECRET` | auto-generated | Session cookie secret |
| `WORKBOT_NAME` | "Workbot" | Dashboard display name (Docker) |

### Dashboard Authentication

On first visit, create a username and password. This password:
- Protects the dashboard (session-based auth, 24h expiry)
- Derives the AES-256 encryption key for service tokens
- Is stored as a bcrypt hash in `.workbot/auth.json`

If you delete `auth.json`, the setup flow re-runs. If you have existing encrypted services, provide your old password to preserve them.

### Service Connections

Connect services via the dashboard Services tab. Supported auth methods:
- **API Key** — GitHub, Airtable, Asana, Render, Stripe, Supabase, etc.
- **OAuth** — Gmail, Google Ads, Google Admin
- **Enterprise (Azure AD)** — Entra, Intune, SharePoint, Outlook, Security Center

### MCP Server

The workbot MCP server provides 30+ tools to Claude Code:
- `brain_search`, `brain_vsearch`, `brain_get`, `brain_write`, etc.
- `service_request`, `service_status`, `service_context_set`
- `workflow_create`, `workflow_run`, `workflow_status`
- `subagent_create`, `subagent_list`, `subagent_spawn`

Configure in `.mcp.json`:
```json
{
  "mcpServers": {
    "workbot": {
      "command": "node",
      "args": ["node_modules/tsx/dist/cli.mjs", "server/src/mcp.ts"]
    }
  }
}
```

---

## Project Structure

```
workbot/
  client/                  # React/Vite/Tailwind frontend
  server/                  # Express/TypeScript backend + MCP server
  workbot-brain/           # Obsidian vault (knowledge graph)
    _system/               # System protocols (committed)
    _templates/            # Note templates (committed)
    _frameworks/           # Framework docs (committed)
    context/               # Operational context (gitignored)
    knowledge/             # Decisions, patterns, corrections (gitignored)
    subagents/             # Per-subagent isolated brains (gitignored)
  .workbot/                # Runtime config (gitignored)
    mcp.json               # Port and path config
    services.json          # Encrypted service tokens
    auth.json              # Dashboard credentials
    workflows.json         # Workflow definitions
    subagents.json         # Subagent definitions
    certs/                 # TLS certificates
    logs/                  # MCP tool logs, workflow run logs
  CLAUDE.md                # Claude Code project instructions
  AGENTS.md                # Context bridge for cloud agents
  .mcp.json                # MCP server configuration
```


---

## Upgrading from Previous Versions

### Single → Multi-Project Development

If your workbot has a `development/` folder with a single cloned repo (the old setup), the Dev tab will show a migration banner. Click **Convert** to automatically move it into the new multi-project structure (`development/{project-id}/`).

### Old Docker Setup → Current

Key changes if upgrading an existing Docker deployment:

1. **Claude Code native installer** — Replace `npm install -g @anthropic-ai/claude-code` with `curl -fsSL https://claude.ai/install.sh | bash` (run as workbot user)
2. **tmux** — Add `tmux` to the Dockerfile's apt-get install line (sessions survive disconnects)
3. **Subagent Linux users** — The `subagents` group and user bootstrap in the entrypoint are required for subagent isolation
4. **init: true** — Add to docker-compose.yml for proper signal handling (kill switch)
5. **Port range 7700-7719** — Add to docker-compose ports for subagent web terminals
6. **No cap_drop** — Remove `cap_drop: ALL` and `cap_add` sections (sudo/useradd need full caps)
7. **Permission mode** — Use `--permission-mode auto` instead of `bypassPermissions` (org may block it)
8. **Active key persistence** — The encryption key now persists across session timeouts (only deleted on explicit logout or container shutdown)
9. **Multi-instance services** — Old single-key services auto-migrate to `{type}:default` instances on first load

### Docker Files Reference

The production Dockerfile, entrypoint.sh, and docker-compose.yml are maintained in the deployment directory (not in the repo). See the Installation section above for the current recommended versions.

Key Dockerfile additions since initial release:
- `tmux` for session persistence
- `groupadd subagents` + `useradd` for agent isolation
- Native Claude Code installer (not npm)
- `ttyd` for web terminals
- Oracle Instant Client (optional, for Oracle DB connections)
