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

/** Get scoped paths for subagent workflows/runs. Null scope = host. */
export function getScopedPaths(scope?: string) {
  if (!scope) return { workflowsPath: WORKFLOWS_PATH, runsPath: RUNS_PATH };
  return {
    workflowsPath: join(STORE_DIR, `workflows-${scope}.json`),
    runsPath: join(RUNS_DIR, `workflow-runs-${scope}.jsonl`),
  };
}
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
  timeout?: number; // seconds; default 1800 (30 min)
}

export interface PythonConfig {
  script: string;          // Inline Python code
  requirements?: string;   // pip requirements (one per line)
  timeout?: number;
}

export interface BrainWriteConfig {
  action: "note" | "project" | "update_active" | "archive_result";
  title?: string;          // Note title (for note/project)
  path?: string;           // Explicit path override
  tags?: string;           // Comma-separated tags
  content?: string;        // Static content (can use {{templates}})
  useNodeOutput?: string;  // Node ID to use output from as content
}

export interface TaskNode {
  id: string;
  label: string;
  type: "mcp_tool" | "shell" | "claude_prompt" | "python" | "brain_write";
  config: McpToolConfig | ShellConfig | ClaudePromptConfig | PythonConfig | BrainWriteConfig;
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

export function loadWorkflows(scope?: string): WorkflowDefinition[] {
  const { workflowsPath } = getScopedPaths(scope);
  try {
    if (!existsSync(workflowsPath)) return [];
    return JSON.parse(readFileSync(workflowsPath, "utf-8"));
  } catch {
    return [];
  }
}

export function saveWorkflows(workflows: WorkflowDefinition[], scope?: string): void {
  const { workflowsPath } = getScopedPaths(scope);
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
  writeFileSync(workflowsPath, JSON.stringify(workflows, null, 2));
}

export function getWorkflow(id: string, scope?: string): WorkflowDefinition | undefined {
  return loadWorkflows(scope).find((w) => w.id === id);
}

export function upsertWorkflow(workflow: WorkflowDefinition, scope?: string): void {
  const all = loadWorkflows(scope);
  const idx = all.findIndex((w) => w.id === workflow.id);
  if (idx >= 0) {
    all[idx] = workflow;
  } else {
    all.push(workflow);
  }
  saveWorkflows(all, scope);
}

export function deleteWorkflow(id: string, scope?: string): boolean {
  const all = loadWorkflows(scope);
  const filtered = all.filter((w) => w.id !== id);
  if (filtered.length === all.length) return false;
  saveWorkflows(filtered, scope);
  return true;
}

// ── Run Persistence ────────────────────────────────────────────────────

export function appendRun(run: WorkflowRun, scope?: string): void {
  const { runsPath } = getScopedPaths(scope);
  if (!existsSync(RUNS_DIR)) mkdirSync(RUNS_DIR, { recursive: true });
  try {
    if (existsSync(runsPath) && statSync(runsPath).size > MAX_RUNS_SIZE) {
      renameSync(runsPath, runsPath + ".1");
    }
  } catch { /* ignore */ }
  appendFileSync(runsPath, JSON.stringify(run) + "\n");
}

export function updateRun(run: WorkflowRun, scope?: string): void {
  const { runsPath } = getScopedPaths(scope);
  if (!existsSync(runsPath)) {
    appendRun(run, scope);
    return;
  }
  const lines = readFileSync(runsPath, "utf-8").split("\n").filter((l) => l.trim());
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
  writeFileSync(runsPath, updated.join("\n") + "\n");
}

export function loadRuns(opts?: {
  workflowId?: string;
  limit?: number;
  scope?: string;
}): WorkflowRun[] {
  const { runsPath } = getScopedPaths(opts?.scope);
  if (!existsSync(runsPath)) return [];
  const limit = opts?.limit ?? 50;
  const lines = readFileSync(runsPath, "utf-8").split("\n").filter((l) => l.trim());

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

export function getRun(runId: string, scope?: string): WorkflowRun | undefined {
  const { runsPath } = getScopedPaths(scope);
  if (!existsSync(runsPath)) return undefined;
  const lines = readFileSync(runsPath, "utf-8").split("\n").filter((l) => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const run: WorkflowRun = JSON.parse(lines[i]);
      if (run.runId === runId) return run;
    } catch { /* skip */ }
  }
  return undefined;
}
