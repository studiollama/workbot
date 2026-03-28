import { randomUUID } from "crypto";
import { spawn } from "child_process";
import cron from "node-cron";
import { watch, type FSWatcher } from "fs";
import {
  loadWorkflows,
  getWorkflow,
  appendRun,
  updateRun,
  loadRuns,
  type WorkflowDefinition,
  type WorkflowRun,
  type NodeResult,
  type TaskNode,
  type McpToolConfig,
  type ShellConfig,
  type ClaudePromptConfig,
  type PythonConfig,
} from "./workflows-config.js";
import { loadStore, SERVICES } from "./services.js";
import { loadMcpConfig } from "./mcp-config.js";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// ── Workflow Engine ────────────────────────────────────────────────────

export class WorkflowEngine {
  private cronJobs = new Map<string, ReturnType<typeof cron.schedule>>();
  private fileWatchers = new Map<string, FSWatcher>();
  private activeRuns = new Map<string, WorkflowRun>();
  private debounceTimers = new Map<string, NodeJS.Timeout>();

  start(): void {
    const workflows = loadWorkflows();
    for (const wf of workflows) {
      if (wf.enabled) this.setupWorkflow(wf);
    }
    console.log(`Workflow engine started (${workflows.filter((w) => w.enabled).length} active)`);
  }

  stop(): void {
    for (const [, job] of this.cronJobs) job.stop();
    for (const [, watcher] of this.fileWatchers) watcher.close();
    for (const [, timer] of this.debounceTimers) clearTimeout(timer);
    this.cronJobs.clear();
    this.fileWatchers.clear();
    this.debounceTimers.clear();
  }

  reload(): void {
    this.stop();
    this.start();
  }

  getActiveRuns(): WorkflowRun[] {
    return [...this.activeRuns.values()];
  }

  getActiveRun(runId: string): WorkflowRun | undefined {
    return this.activeRuns.get(runId);
  }

  // ── Setup ────────────────────────────────────────────────────────────

  private setupWorkflow(wf: WorkflowDefinition): void {
    // Cron schedule
    if (wf.schedule?.cron && cron.validate(wf.schedule.cron)) {
      const job = cron.schedule(wf.schedule.cron, () => {
        this.executeWorkflow(wf.id, "cron");
      });
      this.cronJobs.set(wf.id, job);
    }

    // File change triggers
    if (wf.triggers) {
      for (const trigger of wf.triggers) {
        if (trigger.type === "file_change" && trigger.watchPath) {
          try {
            const debounceMs = trigger.debounceMs ?? 5000;
            const watcher = watch(trigger.watchPath, () => {
              const timerKey = `${wf.id}:${trigger.watchPath}`;
              const existing = this.debounceTimers.get(timerKey);
              if (existing) clearTimeout(existing);
              this.debounceTimers.set(
                timerKey,
                setTimeout(() => {
                  this.executeWorkflow(wf.id, "file_change", { path: trigger.watchPath });
                  this.debounceTimers.delete(timerKey);
                }, debounceMs)
              );
            });
            this.fileWatchers.set(`${wf.id}:${trigger.watchPath}`, watcher);
          } catch {
            console.warn(`Failed to watch ${trigger.watchPath} for workflow ${wf.id}`);
          }
        }
      }
    }
  }

  // ── Webhook trigger ──────────────────────────────────────────────────

  handleWebhook(workflowId: string, webhookId: string, body: unknown): WorkflowRun | null {
    const wf = getWorkflow(workflowId);
    if (!wf || !wf.enabled) return null;
    const trigger = wf.triggers?.find(
      (t) => t.type === "webhook" && t.webhookId === webhookId
    );
    if (!trigger) return null;
    return this.executeWorkflow(workflowId, "webhook", body);
  }

  // ── Cancel ───────────────────────────────────────────────────────────

  cancelRun(runId: string): boolean {
    const run = this.activeRuns.get(runId);
    if (!run || run.status !== "running") return false;
    run.status = "cancelled";
    run.completedAt = new Date().toISOString();
    for (const nr of Object.values(run.nodeResults)) {
      if (nr.status === "pending" || nr.status === "running") {
        nr.status = "skipped";
      }
    }
    updateRun(run);
    this.activeRuns.delete(runId);
    return true;
  }

  // ── Execute Workflow ─────────────────────────────────────────────────

  executeWorkflow(
    workflowId: string,
    trigger: WorkflowRun["trigger"],
    triggerData?: unknown
  ): WorkflowRun {
    const wf = getWorkflow(workflowId);
    if (!wf) throw new Error(`Workflow not found: ${workflowId}`);

    const run: WorkflowRun = {
      runId: randomUUID(),
      workflowId,
      status: "running",
      trigger,
      startedAt: new Date().toISOString(),
      triggerData,
      nodeResults: {},
    };

    // Initialize all nodes as pending
    for (const node of wf.nodes) {
      run.nodeResults[node.id] = { nodeId: node.id, status: "pending" };
    }

    appendRun(run);
    this.activeRuns.set(run.runId, run);

    // Execute DAG asynchronously
    this.runDag(wf, run).catch((err) => {
      console.error(`Workflow ${workflowId} run ${run.runId} failed:`, err);
    });

    return run;
  }

  // ── DAG Traversal (Kahn's Algorithm) ─────────────────────────────────

  private async runDag(wf: WorkflowDefinition, run: WorkflowRun): Promise<void> {
    try {
      // Build adjacency and in-degree maps
      const inDegree = new Map<string, number>();
      const successors = new Map<string, { to: string; edge: typeof wf.edges[0] }[]>();

      for (const node of wf.nodes) {
        inDegree.set(node.id, 0);
        successors.set(node.id, []);
      }
      for (const edge of wf.edges) {
        inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
        successors.get(edge.from)?.push({ to: edge.to, edge });
      }

      // Start with entry nodes (in-degree 0)
      let ready = [...inDegree.entries()]
        .filter(([, deg]) => deg === 0)
        .map(([id]) => id);

      while (ready.length > 0 && run.status === "running") {
        // Execute all ready nodes in parallel
        await Promise.all(
          ready.map(async (nodeId) => {
            if (run.status !== "running") return;
            const node = wf.nodes.find((n) => n.id === nodeId);
            if (!node) return;
            await this.executeNode(node, run, wf);
          })
        );

        if (run.status !== "running") break;

        // Find next batch of ready nodes
        const nextReady: string[] = [];
        for (const completedId of ready) {
          const result = run.nodeResults[completedId];
          const edges = successors.get(completedId) ?? [];

          for (const { to, edge } of edges) {
            // Check edge condition
            if (!this.evaluateEdge(edge, result)) {
              // Mark target as skipped if no other incoming edges can satisfy it
              const otherIncoming = wf.edges.filter(
                (e) => e.to === to && e.from !== completedId
              );
              const anyOtherSatisfied = otherIncoming.some((e) => {
                const src = run.nodeResults[e.from];
                return src && this.evaluateEdge(e, src);
              });
              if (!anyOtherSatisfied && otherIncoming.length === 0) {
                run.nodeResults[to] = {
                  ...run.nodeResults[to],
                  status: "skipped",
                };
              }
              continue;
            }

            // Decrement in-degree
            const newDeg = (inDegree.get(to) ?? 1) - 1;
            inDegree.set(to, newDeg);
            if (newDeg === 0 && run.nodeResults[to]?.status === "pending") {
              nextReady.push(to);
            }
          }
        }

        ready = nextReady;
      }

      // Determine final status
      const results = Object.values(run.nodeResults);
      const anyFailed = results.some((r) => r.status === "failed");
      run.status = run.status === "cancelled" ? "cancelled" : anyFailed ? "failed" : "completed";
      run.completedAt = new Date().toISOString();
    } catch (err: any) {
      run.status = "failed";
      run.completedAt = new Date().toISOString();
    }

    updateRun(run);
    this.activeRuns.delete(run.runId);
  }

  private evaluateEdge(
    edge: { condition?: string; when?: string },
    sourceResult: NodeResult
  ): boolean {
    const condition = edge.condition ?? "success";

    // Check status condition
    if (condition === "success" && sourceResult.status !== "completed") return false;
    if (condition === "failure" && sourceResult.status !== "failed") return false;
    // "always" passes regardless of status

    // Check when expression
    if (edge.when) {
      try {
        const fn = new Function("output", `return !!(${edge.when})`);
        return fn(sourceResult.output);
      } catch {
        return false;
      }
    }

    return true;
  }

  // ── Node Execution ───────────────────────────────────────────────────

  private async executeNode(
    node: TaskNode,
    run: WorkflowRun,
    wf: WorkflowDefinition
  ): Promise<void> {
    const nr = run.nodeResults[node.id];
    nr.status = "running";
    nr.startedAt = new Date().toISOString();
    updateRun(run);

    const start = Date.now();
    try {
      // Resolve templates in config
      const resolvedConfig = this.resolveTemplates(node.config, run);

      let output: unknown;
      switch (node.type) {
        case "shell":
          output = await this.execShell(resolvedConfig as ShellConfig);
          break;
        case "mcp_tool":
          output = await this.execMcpTool(resolvedConfig as McpToolConfig);
          break;
        case "claude_prompt":
          output = await this.execClaudePrompt(resolvedConfig as ClaudePromptConfig);
          break;
        case "python":
          output = await this.execPython(resolvedConfig as PythonConfig);
          break;
      }

      nr.status = "completed";
      nr.output = output;
    } catch (err: any) {
      nr.status = "failed";
      nr.error = err.message ?? String(err);
    }

    nr.completedAt = new Date().toISOString();
    nr.durationMs = Date.now() - start;
    updateRun(run);
  }

  // ── Template Resolution ──────────────────────────────────────────────

  private resolveTemplates(config: unknown, run: WorkflowRun): any {
    if (typeof config === "string") {
      return config.replace(/\{\{([\w-]+)\.output(?:\.([^}]+))?\}\}/g, (_match, nodeId, path) => {
        const result = run.nodeResults[nodeId];
        if (!result || result.status !== "completed") return "";
        let val = result.output;
        if (path && val != null) {
          for (const part of path.split(".")) {
            if (val == null) break;
            val = (val as any)[part];
          }
        }
        return typeof val === "object" ? JSON.stringify(val) : String(val ?? "");
      });
    }
    if (Array.isArray(config)) {
      return config.map((v) => this.resolveTemplates(v, run));
    }
    if (config && typeof config === "object") {
      const result: any = {};
      for (const [k, v] of Object.entries(config)) {
        result[k] = this.resolveTemplates(v, run);
      }
      return result;
    }
    return config;
  }

  // ── Executors ────────────────────────────────────────────────────────

  private async execShell(config: ShellConfig): Promise<string> {
    const timeout = config.timeout ?? 30_000;
    return new Promise((resolve, reject) => {
      const proc = spawn("bash", ["-c", config.command], {
        cwd: config.cwd,
        timeout,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (d) => { stdout += d.toString(); });
      proc.stderr.on("data", (d) => { stderr += d.toString(); });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`Exit code ${code}: ${stderr.trim() || stdout.trim()}`));
        }
      });

      proc.on("error", (err) => reject(err));
    });
  }

  private async execMcpTool(config: McpToolConfig): Promise<unknown> {
    const mcpConfig = loadMcpConfig();

    // Brain tools — call QMD CLI directly
    if (config.tool.startsWith("brain_")) {
      const qmdCmd = config.tool.replace("brain_", "");
      if (!mcpConfig.qmdCliPath) {
        throw new Error("QMD not configured");
      }
      const nodePath = mcpConfig.nodePath.replace(/\\/g, "/");
      const qmdPath = mcpConfig.qmdCliPath.replace(/\\/g, "/");
      const indexArgs = mcpConfig.qmdIndex ? ["--index", mcpConfig.qmdIndex] : [];

      const cmdArgs: string[] = [qmdPath, ...indexArgs, qmdCmd];
      // Add positional args based on tool
      if (config.args.query) cmdArgs.push(String(config.args.query));
      if (config.args.path) cmdArgs.push(String(config.args.path));

      const { stdout, stderr } = await execFileAsync(nodePath, cmdArgs, {
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, HOME: process.env.USERPROFILE ?? process.env.HOME },
      });
      return (stdout + stderr).trim();
    }

    // Service request
    if (config.tool === "service_request") {
      const { service, method, url, body, headers: extraHeaders } = config.args as any;
      const svcConfig = SERVICES[service];
      if (!svcConfig) throw new Error(`Unknown service: ${service}`);

      const store = loadStore();
      const saved = store[service];
      if (!saved) throw new Error(`Service "${service}" not connected`);

      let token = saved.token;
      if (svcConfig.preConnect && saved.extras) {
        const result = await svcConfig.preConnect(saved.token, saved.extras);
        token = result.resolvedToken;
      }

      const authHeaders = svcConfig.authHeader(token, saved.extras);
      const mergedHeaders: Record<string, string> = {
        ...authHeaders,
        ...(extraHeaders ?? {}),
      };
      if (body && !mergedHeaders["Content-Type"]) {
        mergedHeaders["Content-Type"] = "application/json";
      }

      const response = await fetch(url, {
        method: method ?? "GET",
        headers: mergedHeaders,
        ...(body ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
      });

      const text = await response.text();
      try { return JSON.parse(text); } catch { return text; }
    }

    throw new Error(`Unsupported MCP tool for workflow execution: ${config.tool}`);
  }

  private async execPython(config: PythonConfig): Promise<string> {
    const timeout = config.timeout ?? 60_000;
    const { writeFileSync, unlinkSync, mkdirSync } = await import("fs");
    const { join } = await import("path");
    const { STORE_DIR } = await import("./paths.js");

    const tmpDir = join(STORE_DIR, "tmp");
    mkdirSync(tmpDir, { recursive: true });
    const scriptPath = join(tmpDir, `wf-${Date.now()}.py`);

    try {
      writeFileSync(scriptPath, config.script);

      // Install requirements if specified
      if (config.requirements?.trim()) {
        const reqPath = join(tmpDir, `wf-req-${Date.now()}.txt`);
        writeFileSync(reqPath, config.requirements);
        try {
          await execFileAsync("pip", ["install", "-q", "-r", reqPath], { timeout: 120_000 });
        } finally {
          try { unlinkSync(reqPath); } catch { /* ignore */ }
        }
      }

      const { stdout, stderr } = await execFileAsync("python", [scriptPath], {
        timeout,
        maxBuffer: 5 * 1024 * 1024,
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      });

      const output = stdout.trim();
      if (stderr.trim() && !output) {
        throw new Error(stderr.trim());
      }
      return output || stderr.trim();
    } finally {
      try { unlinkSync(scriptPath); } catch { /* ignore */ }
    }
  }

  private async execClaudePrompt(config: ClaudePromptConfig): Promise<unknown> {
    try {
      const args = ["-p", config.prompt, "--output-format", "json"];
      if (config.useProjectContext) {
        const { PROJECT_ROOT } = await import("./paths.js");
        args.push("--project-dir", PROJECT_ROOT);
      }
      if (config.bypassPermissions) {
        args.push("--permission-mode", "bypassPermissions");
      }
      const { stdout } = await execFileAsync("claude", args, {
        timeout: 300_000, // 5 min for complex prompts
        maxBuffer: 10 * 1024 * 1024,
      });

      // Parse JSON output — contains full conversation with tool calls, thinking, etc.
      try {
        const parsed = JSON.parse(stdout);
        return parsed;
      } catch {
        // Fallback to raw text if JSON parse fails
        return stdout.trim();
      }
    } catch (err: any) {
      throw new Error(`Claude prompt failed: ${err.message}`);
    }
  }
}
