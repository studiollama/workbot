import { Router } from "express";
import { randomUUID } from "crypto";
import cron from "node-cron";
import {
  loadWorkflows,
  getWorkflow,
  upsertWorkflow,
  deleteWorkflow as removeWorkflow,
  loadRuns,
  getRun,
  type WorkflowDefinition,
} from "../workflows-config.js";
import type { WorkflowEngine } from "../workflow-engine.js";

/** Compute the next run time for a cron expression */
function getNextCronRun(cronExpr: string): string | null {
  if (!cron.validate(cronExpr)) return null;
  // Parse cron fields and compute next occurrence
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const now = new Date();
  // Brute-force: check each minute for the next 48 hours
  for (let i = 1; i <= 48 * 60; i++) {
    const candidate = new Date(now.getTime() + i * 60_000);
    candidate.setSeconds(0, 0);
    if (cronMatches(parts, candidate)) {
      return candidate.toISOString();
    }
  }
  return null;
}

function cronMatches(parts: string[], date: Date): boolean {
  const minute = date.getMinutes();
  const hour = date.getHours();
  const dom = date.getDate();
  const month = date.getMonth() + 1;
  const dow = date.getDay();

  return (
    fieldMatches(parts[0], minute, 0, 59) &&
    fieldMatches(parts[1], hour, 0, 23) &&
    fieldMatches(parts[2], dom, 1, 31) &&
    fieldMatches(parts[3], month, 1, 12) &&
    fieldMatches(parts[4], dow, 0, 7)
  );
}

function fieldMatches(field: string, value: number, min: number, max: number): boolean {
  if (field === "*") return true;
  for (const part of field.split(",")) {
    if (part.includes("/")) {
      const [range, stepStr] = part.split("/");
      const step = parseInt(stepStr, 10);
      const start = range === "*" ? min : parseInt(range, 10);
      for (let v = start; v <= max; v += step) {
        if (v === value) return true;
      }
    } else if (part.includes("-")) {
      const [lo, hi] = part.split("-").map(Number);
      if (value >= lo && value <= hi) return true;
    } else {
      if (parseInt(part, 10) === value) return true;
    }
  }
  return false;
}

const router = Router();

function getEngine(req: any): WorkflowEngine {
  return req.app.get("workflowEngine");
}

// GET /api/workflows — list all
router.get("/", (_req, res) => {
  const workflows = loadWorkflows();
  const runs = loadRuns({ limit: 200 });

  const result = workflows.map((wf) => {
    const wfRuns = runs.filter((r) => r.workflowId === wf.id);
    const lastRun = wfRuns[0] ?? null;
    const nextRun = wf.enabled && wf.schedule?.cron ? getNextCronRun(wf.schedule.cron) : null;
    return {
      ...wf,
      lastRun: lastRun
        ? { runId: lastRun.runId, status: lastRun.status, trigger: lastRun.trigger, startedAt: lastRun.startedAt, completedAt: lastRun.completedAt }
        : null,
      nextRun,
    };
  });

  res.json(result);
});

// GET /api/workflows/:id — get single with recent runs
router.get("/:id", (req, res) => {
  const wf = getWorkflow(req.params.id);
  if (!wf) return res.status(404).json({ error: "Workflow not found" });

  const engine = getEngine(req);
  const recentRuns = loadRuns({ workflowId: wf.id, limit: 20 });

  // Merge active run state (in-memory) with persisted
  const enrichedRuns = recentRuns.map((r) => {
    const active = engine.getActiveRun(r.runId);
    return active ?? r;
  });

  res.json({ ...wf, runs: enrichedRuns });
});

// POST /api/workflows — create
router.post("/", (req, res) => {
  const { name, description, schedule, triggers, nodes, edges } = req.body;

  if (!name) return res.status(400).json({ error: "Name is required" });

  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    || randomUUID().slice(0, 8);

  // Check for duplicate ID
  if (getWorkflow(id)) {
    return res.status(409).json({ error: `Workflow "${id}" already exists` });
  }

  const now = new Date().toISOString();
  const wf: WorkflowDefinition = {
    id,
    name,
    description: description ?? "",
    enabled: false,
    createdAt: now,
    updatedAt: now,
    schedule: schedule ?? undefined,
    triggers: triggers ?? undefined,
    nodes: nodes ?? [],
    edges: edges ?? [],
  };

  upsertWorkflow(wf);
  const engine = getEngine(req);
  engine.reload();
  res.status(201).json(wf);
});

// PUT /api/workflows/:id — update
router.put("/:id", (req, res) => {
  const existing = getWorkflow(req.params.id);
  if (!existing) return res.status(404).json({ error: "Workflow not found" });

  const { name, description, schedule, triggers, nodes, edges, enabled } = req.body;

  const updated: WorkflowDefinition = {
    ...existing,
    ...(name !== undefined ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(schedule !== undefined ? { schedule } : {}),
    ...(triggers !== undefined ? { triggers } : {}),
    ...(nodes !== undefined ? { nodes } : {}),
    ...(edges !== undefined ? { edges } : {}),
    ...(enabled !== undefined ? { enabled } : {}),
    updatedAt: new Date().toISOString(),
  };

  upsertWorkflow(updated);
  const engine = getEngine(req);
  engine.reload();
  res.json(updated);
});

// DELETE /api/workflows/:id
router.delete("/:id", (req, res) => {
  if (!removeWorkflow(req.params.id)) {
    return res.status(404).json({ error: "Workflow not found" });
  }
  const engine = getEngine(req);
  engine.reload();
  res.json({ ok: true });
});

// PUT /api/workflows/:id/toggle — enable/disable
router.put("/:id/toggle", (req, res) => {
  const existing = getWorkflow(req.params.id);
  if (!existing) return res.status(404).json({ error: "Workflow not found" });

  existing.enabled = !existing.enabled;
  existing.updatedAt = new Date().toISOString();
  upsertWorkflow(existing);

  const engine = getEngine(req);
  engine.reload();
  res.json({ ok: true, enabled: existing.enabled });
});

// POST /api/workflows/:id/run — manual trigger
router.post("/:id/run", (req, res) => {
  const wf = getWorkflow(req.params.id);
  if (!wf) return res.status(404).json({ error: "Workflow not found" });

  const engine = getEngine(req);
  try {
    const run = engine.executeWorkflow(wf.id, "manual", req.body.triggerData);
    res.json({ runId: run.runId, status: run.status });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/workflows/:id/runs — run history
router.get("/:id/runs", (req, res) => {
  const limit = parseInt(String(req.query.limit ?? "20"), 10);
  const runs = loadRuns({ workflowId: req.params.id, limit });

  const engine = getEngine(req);
  const enriched = runs.map((r) => engine.getActiveRun(r.runId) ?? r);
  res.json(enriched);
});

// GET /api/workflows/:id/runs/:runId — single run detail
router.get("/:id/runs/:runId", (req, res) => {
  const engine = getEngine(req);
  const active = engine.getActiveRun(req.params.runId);
  if (active) return res.json(active);

  const run = getRun(req.params.runId);
  if (!run) return res.status(404).json({ error: "Run not found" });
  res.json(run);
});

// POST /api/workflows/:id/runs/:runId/cancel
router.post("/:id/runs/:runId/cancel", (req, res) => {
  const engine = getEngine(req);
  const ok = engine.cancelRun(req.params.runId);
  if (!ok) return res.status(404).json({ error: "Run not found or not running" });
  res.json({ ok: true });
});

// POST /api/workflows/:id/trigger/:webhookId — webhook (no auth needed, validated by ID)
router.post("/:id/trigger/:webhookId", (req, res) => {
  const engine = getEngine(req);
  const run = engine.handleWebhook(req.params.id, req.params.webhookId, req.body);
  if (!run) return res.status(404).json({ error: "Invalid webhook" });
  res.json({ runId: run.runId, status: run.status });
});

export default router;
