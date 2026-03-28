import {
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
  statSync,
  renameSync,
} from "fs";
import { join } from "path";
import { STORE_DIR } from "./paths.js";

const WORKFLOWS_PATH = join(STORE_DIR, "workflows.json");
const RUNS_DIR = join(STORE_DIR, "logs");
const RUNS_PATH = join(RUNS_DIR, "workflow-runs.jsonl");
const MAX_RUNS_SIZE = 10 * 1024 * 1024; // 10MB

// ── Types ──────────────────────────────────────────────────────────────

export interface McpToolConfig {
  tool: string;
  args: Record<string, unknown>;
}

export interface ShellConfig {
  command: string;
  cwd?: string;
  timeout?: number;
}

export interface ClaudePromptConfig {
  prompt: string;
  useProjectContext?: boolean; // Pass --project-dir so Claude gets CLAUDE.md, MCP tools, brain access
  bypassPermissions?: boolean; // Run with --permission-mode bypassPermissions (no confirmation prompts)
}

export interface PythonConfig {
  script: string;          // Inline Python code
  requirements?: string;   // pip requirements (one per line)
  timeout?: number;
}

export interface TaskNode {
  id: string;
  label: string;
  type: "mcp_tool" | "shell" | "claude_prompt" | "python";
  config: McpToolConfig | ShellConfig | ClaudePromptConfig | PythonConfig;
}

export interface TaskEdge {
  from: string;
  to: string;
  condition?: "success" | "failure" | "always";
  when?: string;
}

export interface WorkflowTrigger {
  type: "webhook" | "file_change";
  webhookId?: string;
  watchPath?: string;
  debounceMs?: number;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  schedule?: { cron?: string };
  triggers?: WorkflowTrigger[];
  nodes: TaskNode[];
  edges: TaskEdge[];
}

export interface NodeResult {
  nodeId: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt?: string;
  completedAt?: string;
  output?: unknown;
  error?: string;
  durationMs?: number;
}

export interface WorkflowRun {
  runId: string;
  workflowId: string;
  status: "running" | "completed" | "failed" | "cancelled";
  trigger: "manual" | "cron" | "webhook" | "file_change" | "mcp";
  startedAt: string;
  completedAt?: string;
  triggerData?: unknown;
  nodeResults: Record<string, NodeResult>;
}

// ── Workflow CRUD ──────────────────────────────────────────────────────

export function loadWorkflows(): WorkflowDefinition[] {
  try {
    if (!existsSync(WORKFLOWS_PATH)) return [];
    return JSON.parse(readFileSync(WORKFLOWS_PATH, "utf-8"));
  } catch {
    return [];
  }
}

export function saveWorkflows(workflows: WorkflowDefinition[]): void {
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
  writeFileSync(WORKFLOWS_PATH, JSON.stringify(workflows, null, 2));
}

export function getWorkflow(id: string): WorkflowDefinition | undefined {
  return loadWorkflows().find((w) => w.id === id);
}

export function upsertWorkflow(workflow: WorkflowDefinition): void {
  const all = loadWorkflows();
  const idx = all.findIndex((w) => w.id === workflow.id);
  if (idx >= 0) {
    all[idx] = workflow;
  } else {
    all.push(workflow);
  }
  saveWorkflows(all);
}

export function deleteWorkflow(id: string): boolean {
  const all = loadWorkflows();
  const filtered = all.filter((w) => w.id !== id);
  if (filtered.length === all.length) return false;
  saveWorkflows(filtered);
  return true;
}

// ── Run Persistence ────────────────────────────────────────────────────

export function appendRun(run: WorkflowRun): void {
  if (!existsSync(RUNS_DIR)) mkdirSync(RUNS_DIR, { recursive: true });
  // Auto-rotate
  try {
    if (existsSync(RUNS_PATH) && statSync(RUNS_PATH).size > MAX_RUNS_SIZE) {
      renameSync(RUNS_PATH, RUNS_PATH + ".1");
    }
  } catch { /* ignore */ }
  appendFileSync(RUNS_PATH, JSON.stringify(run) + "\n");
}

export function updateRun(run: WorkflowRun): void {
  if (!existsSync(RUNS_PATH)) {
    appendRun(run);
    return;
  }
  const lines = readFileSync(RUNS_PATH, "utf-8").split("\n").filter((l) => l.trim());
  let found = false;
  const updated = lines.map((line) => {
    try {
      const parsed: WorkflowRun = JSON.parse(line);
      if (parsed.runId === run.runId) {
        found = true;
        return JSON.stringify(run);
      }
    } catch { /* keep original */ }
    return line;
  });
  if (!found) updated.push(JSON.stringify(run));
  writeFileSync(RUNS_PATH, updated.join("\n") + "\n");
}

export function loadRuns(opts?: {
  workflowId?: string;
  limit?: number;
}): WorkflowRun[] {
  if (!existsSync(RUNS_PATH)) return [];
  const limit = opts?.limit ?? 50;
  const lines = readFileSync(RUNS_PATH, "utf-8").split("\n").filter((l) => l.trim());

  const runs: WorkflowRun[] = [];
  for (let i = lines.length - 1; i >= 0 && runs.length < limit; i--) {
    try {
      const run: WorkflowRun = JSON.parse(lines[i]);
      if (opts?.workflowId && run.workflowId !== opts.workflowId) continue;
      runs.push(run);
    } catch { /* skip */ }
  }
  return runs;
}

export function getRun(runId: string): WorkflowRun | undefined {
  if (!existsSync(RUNS_PATH)) return undefined;
  const lines = readFileSync(RUNS_PATH, "utf-8").split("\n").filter((l) => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const run: WorkflowRun = JSON.parse(lines[i]);
      if (run.runId === runId) return run;
    } catch { /* skip */ }
  }
  return undefined;
}
