import { Router } from "express";
import { spawn } from "child_process";
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
} from "../subagents.js";

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

// Active spawned sessions
const activeSessions = new Map<string, { pid: number; startedAt: string }>();

// GET /api/subagents
router.get("/", (_req, res) => {
  const subagents = loadSubagents();
  const result = subagents.map((s) => ({
    ...s,
    session: activeSessions.get(s.id) ?? null,
  }));
  res.json(result);
});

// GET /api/subagents/:id
router.get("/:id", (req, res) => {
  const s = getSubagent(req.params.id);
  if (!s) return res.status(404).json({ error: "Subagent not found" });
  res.json({ ...s, session: activeSessions.get(s.id) ?? null });
});

// POST /api/subagents
router.post("/", (req, res) => {
  const { name, description, allowedServices, claudeAuth, systemPromptPath } = req.body;
  if (!name) return res.status(400).json({ error: "Name is required" });
  try {
    const s = createSubagent({ name, description, allowedServices, claudeAuth, systemPromptPath });
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
  const deleteBrain = req.query.deleteBrain === "true";
  if (!deleteSubagent(req.params.id, deleteBrain)) {
    return res.status(404).json({ error: "Subagent not found" });
  }
  // Kill active session if any
  const session = activeSessions.get(req.params.id);
  if (session) {
    try { process.kill(session.pid); } catch { /* already dead */ }
    activeSessions.delete(req.params.id);
  }
  res.json({ ok: true });
});

// POST /api/subagents/:id/spawn — spawn Claude session in subagent context
router.post("/:id/spawn", (req, res) => {
  const s = getSubagent(req.params.id);
  if (!s) return res.status(404).json({ error: "Subagent not found" });
  if (!s.enabled) return res.status(400).json({ error: "Subagent is disabled" });

  // Ensure brain directory exists
  ensureBrainDir(s);

  // Check if already running
  const existing = activeSessions.get(s.id);
  if (existing) {
    try {
      process.kill(existing.pid, 0); // Check if still alive
      return res.json({ sessionId: s.id, pid: existing.pid, alreadyRunning: true });
    } catch {
      activeSessions.delete(s.id);
    }
  }

  // Spawn Claude remote-control session for this subagent
  const cwd = resolve(PROJECT_ROOT, "workbot-brain", "subagents", s.id);

  const args = [
    "remote-control",
    "--name", s.name,
    "--spawn", "same-dir",
    "--verbose",
  ];

  // Add bypass permissions if enabled on the subagent
  if (s.bypassPermissions) {
    args.push("--permission-mode", "bypassPermissions");
  }

  // Set HOME for oauth mode so Claude uses subagent-specific credentials
  const spawnEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
  };
  if (s.claudeAuth.mode === "oauth") {
    spawnEnv.HOME = getSubagentClaudeHome(s.id);
  }

  const proc = spawn("claude", args, {
    cwd,
    stdio: "pipe",
    detached: true,
    env: spawnEnv,
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

// ── Subagent Claude Auth ────────────────────────────────────────────────

// Active login processes (device-code flow)
const pendingLogins = new Map<string, { proc: ReturnType<typeof spawn>; output: string }>();

// POST /api/subagents/:id/auth/login — Start OAuth device-code flow
router.post("/:id/auth/login", (req, res) => {
  const s = getSubagent(req.params.id);
  if (!s) return res.status(404).json({ error: "Subagent not found" });

  const home = getSubagentClaudeHome(s.id);
  const proc = spawn("claude", ["auth", "login", "--claudeai"], {
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
