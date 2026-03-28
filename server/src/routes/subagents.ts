import { Router } from "express";
import { spawn } from "child_process";
import { resolve } from "path";
import {
  loadSubagents,
  getSubagent,
  createSubagent,
  updateSubagent,
  deleteSubagent,
  ensureBrainDir,
} from "../subagents.js";
import { SERVICES, loadStore } from "../services.js";
import { readLogs } from "../mcp-logger.js";
import { PROJECT_ROOT } from "../paths.js";

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

  // Spawn Claude CLI with subagent-scoped MCP
  const mcpServerCmd = `node ${resolve(PROJECT_ROOT, "node_modules/tsx/dist/cli.mjs")} ${resolve(PROJECT_ROOT, "server/src/mcp.ts")} --subagent ${s.id}`;
  const prompt = req.body.prompt;

  const args = prompt
    ? ["-p", prompt, "--permission-mode", "bypassPermissions"]
    : ["--permission-mode", "bypassPermissions"];

  // Set cwd to subagent brain for context
  const cwd = resolve(PROJECT_ROOT, "workbot-brain", "subagents", s.id);

  const proc = spawn("claude", args, {
    cwd,
    stdio: "pipe",
    detached: true,
    env: {
      ...process.env,
      MCP_SERVER_CMD: mcpServerCmd,
    },
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

export default router;
