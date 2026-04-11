import { Router } from "express";
import { spawn, execFileSync } from "child_process";
import { resolve } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  loadSubagents,
  getSubagent,
  createSubagent,
  updateSubagent,
  deleteSubagent,
  ensureBrainDir,
  getSubagentClaudeHome,
  getSubagentLinuxUser,
  regenerateSubagentHooks,
} from "../subagents.js";
import { STORE_DIR } from "../paths.js";

const execFileAsync = promisify(execFile);
import { SERVICES, loadStore } from "../services.js";
import { readLogs } from "../mcp-logger.js";
import { PROJECT_ROOT } from "../paths.js";
import {
  loadWorkflows,
  getWorkflow as getWf,
  upsertWorkflow,
  deleteWorkflow as removeWorkflow,
  loadRuns,
  getRun,
  type WorkflowDefinition,
} from "../workflows-config.js";
import { randomUUID } from "crypto";
import cron from "node-cron";

const router = Router();

// Active spawned sessions (exported for auto-spawn registration)
export const activeSessions = new Map<string, { pid: number; startedAt: string }>();

// Check if a subagent's tmux session is actually running
function isTmuxSessionAlive(subagentId: string): boolean {
  const linuxUser = getSubagentLinuxUser(subagentId);
  const tmuxSession = `sa-${subagentId}`;
  try {
    execFileSync("runuser", ["-u", linuxUser, "--", "tmux", "has-session", "-t", tmuxSession], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// Get session info, checking tmux as source of truth
function getSessionStatus(subagentId: string): { pid: number; startedAt: string } | null {
  const tracked = activeSessions.get(subagentId);
  if (tracked) return tracked;
  // Not in memory map — check if tmux session exists anyway (e.g. after auto-spawn where runuser exited)
  if (isTmuxSessionAlive(subagentId)) {
    const session = { pid: 0, startedAt: new Date().toISOString() };
    activeSessions.set(subagentId, session);
    return session;
  }
  return null;
}

// Active web terminals (ttyd instances)
const activeTerminals = new Map<string, { pid: number; port: number; startedAt: string }>();
const TERMINAL_PORT_MIN = 7700;
const TERMINAL_PORT_MAX = 7719;

function getNextTerminalPort(): number | null {
  const usedPorts = new Set([...activeTerminals.values()].map((t) => t.port));
  for (let p = TERMINAL_PORT_MIN; p <= TERMINAL_PORT_MAX; p++) {
    if (!usedPorts.has(p)) return p;
  }
  return null;
}

// GET /api/subagents
router.get("/", (_req, res) => {
  const subagents = loadSubagents();
  const result = subagents.map((s) => ({
    ...s,
    session: getSessionStatus(s.id),
  }));
  res.json(result);
});

// GET /api/subagents/:id
router.get("/:id", (req, res) => {
  const s = getSubagent(req.params.id);
  if (!s) return res.status(404).json({ error: "Subagent not found" });
  res.json({ ...s, session: getSessionStatus(s.id) });
});

// POST /api/subagents
router.post("/", (req, res) => {
  const { name, description, allowedServices, claudeAuth, commonReadOnly, systemPromptPath } = req.body;
  if (!name) return res.status(400).json({ error: "Name is required" });
  try {
    const s = createSubagent({ name, description, allowedServices, claudeAuth, commonReadOnly, systemPromptPath });
    res.status(201).json(s);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/subagents/:id
router.put("/:id", (req, res) => {
  try {
    const s = updateSubagent(req.params.id, req.body);
    res.json(s);
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

// DELETE /api/subagents/:id
router.delete("/:id", (req, res) => {
  try {
    const result = deleteSubagent(req.params.id);

    // Clean up tracked sessions/terminals (processes already killed by deleteSubagent)
    activeSessions.delete(req.params.id);
    activeTerminals.delete(req.params.id);

    res.json({
      ok: true,
      archived: result.archived,
      archivePath: result.archivePath,
    });
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

// POST /api/subagents/auto-spawn — spawn all subagents with autoSpawn=true
router.post("/auto-spawn", (_req, res) => {
  const subagents = loadSubagents();
  const results: { id: string; spawned: boolean; error?: string }[] = [];

  for (const s of subagents) {
    if (!s.autoSpawn || !s.enabled) continue;

    // Check if already running (tmux is source of truth)
    if (isTmuxSessionAlive(s.id)) {
      results.push({ id: s.id, spawned: false, error: "already running" });
      continue;
    }

    // Reuse the spawn logic by making an internal request
    try {
      const cwd = resolve(PROJECT_ROOT, "workbot-brain", "subagents", s.id);
      const args = ["remote-control", "--name", s.name, "--spawn", "same-dir", "--verbose"];
      if (s.bypassPermissions) {
        args.push("--permission-mode", "bypassPermissions");
      } else {
        args.push("--permission-mode", "auto");
      }

      const spawnEnv: Record<string, string> = { ...process.env as Record<string, string> };
      if (s.claudeAuth.mode === "oauth") {
        spawnEnv.HOME = getSubagentClaudeHome(s.id);
      }

      const linuxUser = getSubagentLinuxUser(s.id);
      const envArgs: string[] = [];
      if (spawnEnv.HOME) envArgs.push(`HOME=${spawnEnv.HOME}`);
      envArgs.push(`PATH=${spawnEnv.PATH || "/home/workbot/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"}`);

      const envStr = envArgs.map((e) => `export ${e}`).join(" && ");
      const claudeCmd = `${envStr} && cd ${cwd} && exec claude ${args.join(" ")}`;

      const tmuxSession = `sa-${s.id}`;
      // Kill any existing tmux session for this subagent first
      try { execFileSync("runuser", ["-u", linuxUser, "--", "tmux", "kill-session", "-t", tmuxSession], { stdio: "pipe" }); } catch {}
      const proc = spawn("runuser", ["-u", linuxUser, "--", "tmux", "new-session", "-d", "-s", tmuxSession, "-x", "200", "-y", "50", claudeCmd], {
        cwd, stdio: "ignore", detached: true,
      });
      proc.unref();
      activeSessions.set(s.id, { pid: proc.pid!, startedAt: new Date().toISOString() });
      proc.on("exit", () => { activeSessions.delete(s.id); });
      results.push({ id: s.id, spawned: true });
    } catch (err: any) {
      results.push({ id: s.id, spawned: false, error: err.message });
    }
  }

  res.json({ results });
});

// POST /api/subagents/regenerate-hooks — update hook configs for all subagents
router.post("/regenerate-hooks", (_req, res) => {
  const subagents = loadSubagents();
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const s of subagents) {
    try {
      regenerateSubagentHooks(s.id);
      results.push({ id: s.id, ok: true });
    } catch (err: any) {
      results.push({ id: s.id, ok: false, error: err.message });
    }
  }
  res.json({ results });
});

// POST /api/subagents/:id/stop — kill all processes for this subagent
router.post("/:id/stop", (req, res) => {
  const s = getSubagent(req.params.id);
  if (!s) return res.status(404).json({ error: "Subagent not found" });

  const linuxUser = getSubagentLinuxUser(s.id);

  // Kill all processes running as this subagent's user
  try {
    execFileSync("pkill", ["-9", "-u", linuxUser], { stdio: "pipe" });
  } catch { /* no processes or user doesn't exist */ }

  // Clean up tracked sessions and terminals
  activeSessions.delete(s.id);
  activeTerminals.delete(s.id);

  res.json({ ok: true });
});

// POST /api/subagents/:id/spawn — spawn Claude session in subagent context
router.post("/:id/spawn", (req, res) => {
  const s = getSubagent(req.params.id);
  if (!s) return res.status(404).json({ error: "Subagent not found" });
  if (!s.enabled) return res.status(400).json({ error: "Subagent is disabled" });

  // Ensure brain directory exists
  ensureBrainDir(s);

  // Check if already running (tmux is source of truth)
  if (isTmuxSessionAlive(s.id)) {
    const session = getSessionStatus(s.id);
    return res.json({ sessionId: s.id, pid: session?.pid ?? 0, alreadyRunning: true });
  }

  // Spawn Claude remote-control session for this subagent
  const cwd = resolve(PROJECT_ROOT, "workbot-brain", "subagents", s.id);

  const args = [
    "remote-control",
    "--name", s.name,
    "--spawn", "same-dir",
    "--verbose",
  ];

  // Add permission mode — bypass if enabled, otherwise auto
  if (s.bypassPermissions) {
    args.push("--permission-mode", "bypassPermissions");
  } else {
    args.push("--permission-mode", "auto");
  }

  // Set HOME for oauth mode so Claude uses subagent-specific credentials
  const spawnEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
  };
  if (s.claudeAuth.mode === "oauth") {
    spawnEnv.HOME = getSubagentClaudeHome(s.id);
  }

  // Run as the subagent's isolated Linux user via runuser (container runs as root)
  const linuxUser = getSubagentLinuxUser(s.id);

  // Build env args to pass through runuser (which doesn't inherit parent env)
  const envArgs: string[] = [];
  if (spawnEnv.HOME) envArgs.push(`HOME=${spawnEnv.HOME}`);
  envArgs.push(`PATH=${spawnEnv.PATH || "/home/workbot/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"}`);

  // Use tmux so session survives disconnects and provides a PTY
  const envStr = envArgs.map((e) => `export ${e}`).join(" && ");
  const claudeCmd = `${envStr} && cd ${cwd} && exec claude ${args.join(" ")}`;
  const tmuxSession = `sa-${s.id}`;

  // Kill any existing tmux session for this subagent first
  try { execFileSync("runuser", ["-u", linuxUser, "--", "tmux", "kill-session", "-t", tmuxSession], { stdio: "pipe" }); } catch {}

  const proc = spawn("runuser", ["-u", linuxUser, "--", "tmux", "new-session", "-d", "-s", tmuxSession, "-x", "200", "-y", "50", claudeCmd], {
    cwd,
    stdio: "ignore",
    detached: true,
  });

  proc.unref();

  activeSessions.set(s.id, {
    pid: proc.pid!,
    startedAt: new Date().toISOString(),
  });

  proc.on("exit", () => {
    activeSessions.delete(s.id);
  });

  res.json({ sessionId: s.id, pid: proc.pid });
});

// GET /api/subagents/:id/services — filtered service status
router.get("/:id/services", (req, res) => {
  const s = getSubagent(req.params.id);
  if (!s) return res.status(404).json({ error: "Subagent not found" });

  const store = loadStore();
  const allowedSet = new Set(s.allowedServices);
  const result: Record<string, { connected: boolean; user?: string; allowed: boolean }> = {};

  for (const key of Object.keys(SERVICES)) {
    const allowed = allowedSet.has(key);
    const saved = store[key];
    result[key] = {
      connected: allowed && !!saved,
      user: allowed && saved ? saved.user : undefined,
      allowed,
    };
  }

  res.json(result);
});

// GET /api/subagents/:id/logs — filtered MCP logs
router.get("/:id/logs", (req, res) => {
  const limit = parseInt(String(req.query.limit ?? "100"), 10);
  const offset = parseInt(String(req.query.offset ?? "0"), 10);
  const allLogs = readLogs({ limit: limit + offset });

  // Filter to logs that start with the subagent ID prefix
  const filtered = allLogs.entries.filter((e) => e.tool.startsWith(`${req.params.id}/`));
  const sliced = filtered.slice(offset, offset + limit);

  res.json({ entries: sliced, total: filtered.length });
});

// ── Subagent-scoped Workflow Routes ─────────────────────────────────────

// GET /api/subagents/:id/workflows
router.get("/:id/workflows", (req, res) => {
  const scope = req.params.id;
  const workflows = loadWorkflows(scope);
  const runs = loadRuns({ limit: 200, scope });
  const result = workflows.map((wf) => {
    const wfRuns = runs.filter((r) => r.workflowId === wf.id);
    const lastRun = wfRuns[0] ?? null;
    return {
      ...wf,
      lastRun: lastRun ? { runId: lastRun.runId, status: lastRun.status, trigger: lastRun.trigger, startedAt: lastRun.startedAt, completedAt: lastRun.completedAt } : null,
      nextRun: null, // TODO: compute from cron
    };
  });
  res.json(result);
});

// POST /api/subagents/:id/workflows
router.post("/:id/workflows", (req, res) => {
  const scope = req.params.id;
  const { name, description, schedule, triggers, nodes, edges } = req.body;
  if (!name) return res.status(400).json({ error: "Name is required" });
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || randomUUID().slice(0, 8);
  if (getWf(id, scope)) return res.status(409).json({ error: `Workflow "${id}" already exists` });
  const now = new Date().toISOString();
  const wf: WorkflowDefinition = { id, name, description: description ?? "", enabled: false, createdAt: now, updatedAt: now, schedule, triggers, nodes: nodes ?? [], edges: edges ?? [] };
  upsertWorkflow(wf, scope);
  res.status(201).json(wf);
});

// GET /api/subagents/:id/workflows/:wfId
router.get("/:id/workflows/:wfId", (req, res) => {
  const wf = getWf(req.params.wfId, req.params.id);
  if (!wf) return res.status(404).json({ error: "Workflow not found" });
  const runs = loadRuns({ workflowId: wf.id, limit: 20, scope: req.params.id });
  res.json({ ...wf, runs });
});

// PUT /api/subagents/:id/workflows/:wfId
router.put("/:id/workflows/:wfId", (req, res) => {
  const scope = req.params.id;
  const existing = getWf(req.params.wfId, scope);
  if (!existing) return res.status(404).json({ error: "Workflow not found" });
  const updated = { ...existing, ...req.body, id: existing.id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() };
  upsertWorkflow(updated, scope);
  res.json(updated);
});

// DELETE /api/subagents/:id/workflows/:wfId
router.delete("/:id/workflows/:wfId", (req, res) => {
  if (!removeWorkflow(req.params.wfId, req.params.id)) return res.status(404).json({ error: "Workflow not found" });
  res.json({ ok: true });
});

// PUT /api/subagents/:id/workflows/:wfId/toggle
router.put("/:id/workflows/:wfId/toggle", (req, res) => {
  const scope = req.params.id;
  const existing = getWf(req.params.wfId, scope);
  if (!existing) return res.status(404).json({ error: "Workflow not found" });
  existing.enabled = !existing.enabled;
  existing.updatedAt = new Date().toISOString();
  upsertWorkflow(existing, scope);
  res.json({ ok: true, enabled: existing.enabled });
});

// POST /api/subagents/:id/workflows/:wfId/run
router.post("/:id/workflows/:wfId/run", (req, res) => {
  const scope = req.params.id;
  const wf = getWf(req.params.wfId, scope);
  if (!wf) return res.status(404).json({ error: "Workflow not found" });
  const engine = req.app.get("workflowEngine");
  try {
    const run = engine.executeWorkflow(wf.id, "manual", req.body.triggerData);
    res.json({ runId: run.runId, status: run.status });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/subagents/:id/workflows/:wfId/runs
router.get("/:id/workflows/:wfId/runs", (req, res) => {
  const runs = loadRuns({ workflowId: req.params.wfId, limit: 20, scope: req.params.id });
  res.json(runs);
});

// GET /api/subagents/:id/workflows/:wfId/runs/:runId
router.get("/:id/workflows/:wfId/runs/:runId", (req, res) => {
  const run = getRun(req.params.runId, req.params.id);
  if (!run) return res.status(404).json({ error: "Run not found" });
  res.json(run);
});

// ── Subagent Web Terminal (ttyd) ───────────────────────────────────────

// POST /api/subagents/:id/terminal — Start or get existing ttyd instance
router.post("/:id/terminal", (req, res) => {
  const s = getSubagent(req.params.id);
  if (!s) return res.status(404).json({ error: "Subagent not found" });

  // Check if already running
  const existing = activeTerminals.get(s.id);
  if (existing) {
    try {
      process.kill(existing.pid, 0);
      const host = req.headers.host?.split(":")[0] ?? "localhost";
      return res.json({ url: `http://${host}:${existing.port}`, port: existing.port, pid: existing.pid, alreadyRunning: true });
    } catch {
      activeTerminals.delete(s.id);
    }
  }

  const port = getNextTerminalPort();
  if (!port) return res.status(503).json({ error: "No terminal ports available (max 20)" });

  const linuxUser = getSubagentLinuxUser(s.id);
  const brainDir = resolve(PROJECT_ROOT, "workbot-brain", "subagents", s.id);
  const claudeHome = getSubagentClaudeHome(s.id);

  // Spawn ttyd as the subagent's Linux user, scoped to their brain dir
  const proc = spawn("runuser", [
    "-u", linuxUser, "--",
    "ttyd", "-p", String(port), "-W",
    "--cwd", brainDir,
    "bash", "-c",
    `export HOME=${claudeHome} && export PATH="/home/workbot/.local/bin:$PATH" && cd ${brainDir} && exec bash`,
  ], {
    stdio: "pipe",
    detached: true,
  });

  proc.unref();

  activeTerminals.set(s.id, {
    pid: proc.pid!,
    port,
    startedAt: new Date().toISOString(),
  });

  proc.on("exit", () => {
    activeTerminals.delete(s.id);
  });

  // Give ttyd a moment to bind the port
  setTimeout(() => {
    const host = req.headers.host?.split(":")[0] ?? "localhost";
    res.json({ url: `http://${host}:${port}`, port, pid: proc.pid });
  }, 500);
});

// GET /api/subagents/:id/terminal — Check terminal status
router.get("/:id/terminal", (req, res) => {
  const existing = activeTerminals.get(req.params.id);
  if (!existing) return res.json({ active: false });

  try {
    process.kill(existing.pid, 0);
    const host = req.headers.host?.split(":")[0] ?? "localhost";
    res.json({ active: true, url: `http://${host}:${existing.port}`, port: existing.port });
  } catch {
    activeTerminals.delete(req.params.id);
    res.json({ active: false });
  }
});

// DELETE /api/subagents/:id/terminal — Kill terminal
router.delete("/:id/terminal", (req, res) => {
  const existing = activeTerminals.get(req.params.id);
  if (!existing) return res.json({ ok: true });

  try { process.kill(existing.pid); } catch { /* already dead */ }
  activeTerminals.delete(req.params.id);
  res.json({ ok: true });
});

// ── Subagent Claude Auth ────────────────────────────────────────────────

// Active login processes (device-code flow)
const pendingLogins = new Map<string, { proc: ReturnType<typeof spawn>; output: string }>();

// POST /api/subagents/:id/auth/login — Start OAuth device-code flow
router.post("/:id/auth/login", (req, res) => {
  const s = getSubagent(req.params.id);
  if (!s) return res.status(404).json({ error: "Subagent not found" });

  const home = getSubagentClaudeHome(s.id);
  const linuxUser = getSubagentLinuxUser(s.id);
  const proc = spawn("runuser", ["-u", linuxUser, "--", "claude", "auth", "login", "--claudeai"], {
    env: { ...process.env, HOME: home },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let output = "";
  proc.stdout.on("data", (d) => { output += d.toString(); });
  proc.stderr.on("data", (d) => { output += d.toString(); });

  pendingLogins.set(s.id, { proc, output: "" });

  // Wait a few seconds for the verification URL to appear
  setTimeout(() => {
    const pending = pendingLogins.get(s.id);
    if (pending) pending.output = output;

    // Try to extract verification URL and user code
    const urlMatch = output.match(/https?:\/\/[^\s]+/);
    const codeMatch = output.match(/code[:\s]+([A-Z0-9-]+)/i);

    res.json({
      started: true,
      verificationUrl: urlMatch?.[0] ?? null,
      userCode: codeMatch?.[1] ?? null,
      rawOutput: output.slice(0, 500),
    });
  }, 5000);
});

// POST /api/subagents/:id/auth/check — Check if login completed
router.post("/:id/auth/check", async (req, res) => {
  const s = getSubagent(req.params.id);
  if (!s) return res.status(404).json({ error: "Subagent not found" });

  const home = getSubagentClaudeHome(s.id);
  try {
    const { stdout } = await execFileAsync("claude", ["auth", "status"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000,
    });
    const loggedIn = stdout.includes("Logged in") || stdout.includes("loggedIn");
    res.json({ authenticated: loggedIn, raw: stdout.trim() });
  } catch {
    res.json({ authenticated: false });
  }
});

// POST /api/subagents/:id/auth/token — Manual token paste
router.post("/:id/auth/token", (req, res) => {
  const s = getSubagent(req.params.id);
  if (!s) return res.status(404).json({ error: "Subagent not found" });

  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "Token is required" });

  const home = getSubagentClaudeHome(s.id);
  const credPath = join(home, ".claude", ".credentials.json");

  // Write credentials file in Claude's expected format
  const creds = {
    claudeAiOauth: {
      accessToken: token,
      refreshToken: token, // If it's a refresh token, it works for both
      expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 year
    },
  };
  writeFileSync(credPath, JSON.stringify(creds, null, 2));

  // Update subagent mode to oauth
  if (s.claudeAuth.mode !== "oauth") {
    updateSubagent(s.id, { claudeAuth: { mode: "oauth" } });
  }

  res.json({ ok: true });
});

// GET /api/subagents/:id/auth/status — Check auth status
router.get("/:id/auth/status", async (req, res) => {
  const s = getSubagent(req.params.id);
  if (!s) return res.status(404).json({ error: "Subagent not found" });

  if (s.claudeAuth.mode === "host-spawned") {
    return res.json({ mode: "host-spawned", authenticated: true });
  }

  const home = getSubagentClaudeHome(s.id);
  const credPath = join(home, ".claude", ".credentials.json");

  if (!existsSync(credPath)) {
    return res.json({ mode: "oauth", authenticated: false });
  }

  try {
    const { stdout } = await execFileAsync("claude", ["auth", "status"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000,
    });
    const loggedIn = stdout.includes("Logged in") || stdout.includes("loggedIn");
    res.json({ mode: "oauth", authenticated: loggedIn, raw: stdout.trim() });
  } catch {
    // Credentials file exists but auth check failed — might be expired
    res.json({ mode: "oauth", authenticated: false, hasCredentials: true });
  }
});

// POST /api/subagents/:id/auth/logout — Logout
router.post("/:id/auth/logout", async (req, res) => {
  const s = getSubagent(req.params.id);
  if (!s) return res.status(404).json({ error: "Subagent not found" });

  const home = getSubagentClaudeHome(s.id);
  try {
    await execFileAsync("claude", ["auth", "logout"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000,
    });
  } catch { /* may already be logged out */ }

  // Also remove credentials file
  const credPath = join(home, ".claude", ".credentials.json");
  if (existsSync(credPath)) {
    const { unlinkSync } = await import("fs");
    try { unlinkSync(credPath); } catch { /* ignore */ }
  }

  res.json({ ok: true });
});

export default router;
