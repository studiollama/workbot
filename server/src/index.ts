import "dotenv/config";
import express from "express";
import https from "https";
import { spawn } from "child_process";
import { PROJECT_ROOT } from "./paths.js";
import { loadStore } from "./services.js";
import session from "express-session";
import cors from "cors";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { randomBytes } from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import authRoutes from "./routes/auth.js";
import codexRoutes from "./routes/codex.js";
import servicesRoutes from "./routes/services.js";
import mcpRoutes from "./routes/mcp.js";
import devRoutes from "./routes/development.js";
import skillsRoutes from "./routes/skills.js";
import dashboardAuthRoutes from "./routes/dashboard-auth.js";
import logsRoutes from "./routes/logs.js";
import workflowRoutes from "./routes/workflows.js";
import subagentRoutes, { activeSessions } from "./routes/subagents.js";
import brainRoutes from "./routes/brain.js";
import { loadMcpConfig, saveMcpConfig } from "./mcp-config.js";
import { ensureCerts } from "./certs.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { deleteActiveKey } from "./crypto.js";
import { STORE_DIR } from "./paths.js";
import { WorkflowEngine } from "./workflow-engine.js";

// Bootstrap gitignored config files with defaults for fresh clones
function ensureDefaults() {
  const launchDir = resolve(__dirname, "../../.claude");
  const launchPath = resolve(launchDir, "launch.json");
  if (!existsSync(launchPath)) {
    const config = loadMcpConfig();
    const launch = {
      version: "0.0.1",
      configurations: [
        {
          name: "workbot-server",
          runtimeExecutable: "node",
          runtimeArgs: ["../node_modules/tsx/dist/cli.mjs", "watch", "src/index.ts"],
          port: config.serverPort,
          cwd: "server",
        },
        {
          name: "workbot-client",
          runtimeExecutable: "node",
          runtimeArgs: ["../node_modules/vite/bin/vite.js"],
          port: config.clientPort,
          cwd: "client",
        },
      ],
    };
    if (!existsSync(launchDir)) mkdirSync(launchDir, { recursive: true });
    writeFileSync(launchPath, JSON.stringify(launch, null, 2) + "\n");
    console.log("Created .claude/launch.json with default ports");
  }
}
ensureDefaults();

// Persistent session secret — generate once, reuse across restarts
function getSessionSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const secretPath = resolve(STORE_DIR, ".session-secret");
  if (existsSync(secretPath)) {
    return readFileSync(secretPath, "utf-8").trim();
  }
  const secret = randomBytes(48).toString("hex");
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
  writeFileSync(secretPath, secret, { mode: 0o600 });
  console.log("Generated persistent session secret");
  return secret;
}

declare module "express-session" {
  interface SessionData {
    apiKey?: string;
    chatgptAuth?: boolean;
    org?: string | null;
    authenticated?: boolean;
    username?: string;
    [key: `svc_${string}`]: { token: string; user: string } | undefined;
  }
}

const app = express();
const mcpConfig = loadMcpConfig();
const PORT = parseInt(process.env.PORT ?? String(mcpConfig.serverPort), 10);

app.use(cors({
  origin: (_origin, cb) => cb(null, true),
  credentials: true,
}));
app.use(express.json());
app.use(
  session({
    secret: getSessionSecret(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true,
      httpOnly: true,
      sameSite: "none",
      maxAge: 24 * 60 * 60 * 1000, // 24h
    },
  })
);

// Public auth routes (no requireAuth)
app.use("/api/dashboard-auth", dashboardAuthRoutes);

// All other routes require authentication
app.use("/api/auth", requireAuth, authRoutes);
app.use("/api/codex", requireAuth, codexRoutes);
app.use("/api/services", requireAuth, servicesRoutes);
app.use("/api/mcp", requireAuth, mcpRoutes);
app.use("/api/dev", requireAuth, devRoutes);
app.use("/api/skills", requireAuth, skillsRoutes);
app.use("/api/logs", requireAuth, logsRoutes);
// Webhook triggers bypass auth (validated by webhook ID) — must be before requireAuth
app.post("/api/workflows/:id/trigger/:webhookId", (req, res, next) => {
  const engine = req.app.get("workflowEngine");
  const run = engine.handleWebhook(req.params.id, req.params.webhookId, req.body);
  if (!run) return res.status(404).json({ error: "Invalid webhook" });
  res.json({ runId: run.runId, status: run.status });
});
app.use("/api/workflows", requireAuth, workflowRoutes);
app.use("/api/subagents", requireAuth, subagentRoutes);
app.use("/api/brain", requireAuth, brainRoutes);

// Kill switch — shuts down the container
// PID 1 is bash with a SIGTERM trap that kills claude and exits cleanly
app.post("/api/shutdown", requireAuth, (_req, res) => {
  res.json({ ok: true });
  console.log("[shutdown] Kill switch activated — sending SIGTERM to PID 1...");
  setTimeout(() => {
    const { execSync } = require("child_process");
    try { execSync("kill -TERM 1", { stdio: "ignore" }); } catch {}
  }, 500);
});

// Internal API: decrypted store for MCP processes (localhost only, no auth)
// MCP subagent processes call this instead of reading the active-key file
app.get("/api/internal/store", (req, res) => {
  // Only allow from localhost
  const ip = req.ip || req.socket.remoteAddress || "";
  if (!ip.includes("127.0.0.1") && !ip.includes("::1") && !ip.includes("::ffff:127.0.0.1")) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const store = loadStore();
  res.json(store);
});

// Active key persists across restarts — only deleted on explicit logout
// This keeps MCP service access alive even when the dashboard session expires

// HTTPS server
const { key, cert } = await ensureCerts();
const server = https.createServer({ key, cert }, app);
server.listen(PORT, () => {
  console.log(`Server running on https://localhost:${PORT}`);

  // Sync actual running port back to mcp.json
  if (PORT !== mcpConfig.serverPort) {
    saveMcpConfig({ serverPort: PORT });
    console.log(`Updated mcp.json serverPort: ${mcpConfig.serverPort} → ${PORT}`);
  }
});
app.set("server", server);
app.set("actualPort", PORT);

// Start workflow engine
const workflowEngine = new WorkflowEngine();
workflowEngine.start();
app.set("workflowEngine", workflowEngine);

// Auto-spawn subagents after a delay (let remote-control start first)
import { loadSubagents, getSubagentClaudeHome, getSubagentLinuxUser } from "./subagents.js";
import { resolve as resolvePath } from "path";
setTimeout(() => {
  const subs = loadSubagents().filter((s) => s.autoSpawn && s.enabled);
  if (subs.length === 0) return;
  console.log(`[auto-spawn] Spawning ${subs.length} subagent(s)...`);
  for (const s of subs) {
    // Skip if already running
    const existing = activeSessions.get(s.id);
    if (existing) {
      try { process.kill(existing.pid, 0); console.log(`[auto-spawn] ${s.id} already running (PID ${existing.pid}), skipping`); continue; }
      catch { activeSessions.delete(s.id); }
    }
    const cwd = resolvePath(PROJECT_ROOT, "workbot-brain", "subagents", s.id);
    const args = ["remote-control", "--name", s.name, "--spawn", "same-dir", "--verbose"];
    args.push("--permission-mode", s.bypassPermissions ? "bypassPermissions" : "auto");

    const envArgs: string[] = [];
    if (s.claudeAuth.mode === "oauth") envArgs.push(`HOME=${getSubagentClaudeHome(s.id)}`);
    envArgs.push(`PATH=/home/workbot/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`);

    const envStr = envArgs.map((e) => `export ${e}`).join(" && ");
    const claudeCmd = `${envStr} && cd ${cwd} && exec claude ${args.join(" ")}`;
    const linuxUser = getSubagentLinuxUser(s.id);
    const tmuxSession = `sa-${s.id}`;

    // Use tmux so session survives disconnects
    const proc = spawn("runuser", ["-u", linuxUser, "--", "tmux", "new-session", "-d", "-s", tmuxSession, "-x", "200", "-y", "50", claudeCmd], {
      cwd, stdio: "ignore", detached: true,
    });
    proc.unref();
    activeSessions.set(s.id, { pid: proc.pid!, startedAt: new Date().toISOString() });
    proc.on("exit", () => { activeSessions.delete(s.id); });
    console.log(`[auto-spawn] ${s.name} (${s.id}) → PID ${proc.pid}`);
  }
}, 15_000);

// Clean up on shutdown — delete active key so services require re-login after restart
function cleanup() {
  workflowEngine.stop();
  deleteActiveKey();
}
process.on("SIGINT", () => { cleanup(); process.exit(0); });
process.on("SIGTERM", () => { cleanup(); process.exit(0); });
process.on("exit", cleanup);
