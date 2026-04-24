import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { Cron } from "croner";
import { watch, type FSWatcher } from "fs";
import {
  loadWorkflows,
  getWorkflow,
  getScopedPaths,
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
  type BrainWriteConfig,
} from "./workflows-config.js";
import { loadStore, SERVICES, parseInstanceId } from "./services.js";
import { loadMcpConfig } from "./mcp-config.js";
import { loadDashboardConfig } from "./routes/services.js";
import { getAllNotes, buildLinkGraph, loadNote, BRAIN_ROOT } from "./brain-utils.js";
import { getCommonBrain, validateCommonPath, commonGitCommit } from "./common-brain-utils.js";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// ── Workflow Engine ────────────────────────────────────────────────────

export interface WorkflowEngineOptions {
  /**
   * Whether this engine should register cron schedules, file watchers, and the
   * workflows.json auto-reload watcher. Defaults to true.
   *
   * Set to false for engines that only execute workflows on demand (e.g. the
   * MCP server, which shares workflows.json with the Express backend and must
   * NOT double-schedule the same crons — doing so causes duplicate cron fires
   * milliseconds apart and produces duplicate task artifacts).
   */
  schedule?: boolean;
}

export class WorkflowEngine {
  private cronJobs = new Map<string, Cron>();
  private fileWatchers = new Map<string, FSWatcher>();
  private activeRuns = new Map<string, WorkflowRun>();
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly schedule: boolean;

  constructor(opts: WorkflowEngineOptions = {}) {
    this.schedule = opts.schedule ?? true;
  }

  start(): void {
    if (!this.schedule) return;
    this.watchWorkflowsFile();
    const workflows = loadWorkflows();
    for (const wf of workflows) {
      if (wf.enabled) this.setupWorkflow(wf);
    }
    console.log(`Workflow engine started (${workflows.filter((w) => w.enabled).length} active)`);
  }

  private watchWorkflowsFile(): void {
    const { workflowsPath } = getScopedPaths();
    try {
      const watcher = watch(workflowsPath, () => {
        const key = "__workflows_json__";
        const existing = this.debounceTimers.get(key);
        if (existing) clearTimeout(existing);
        this.debounceTimers.set(
          key,
          setTimeout(() => {
            this.debounceTimers.delete(key);
            console.log("[workflow-engine] workflows.json changed — reloading");
            this.reload();
          }, 500)
        );
      });
      this.fileWatchers.set("__workflows_json__", watcher);
    } catch (err) {
      console.warn("[workflow-engine] Failed to watch workflows.json:", (err as Error).message);
    }
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
    // Cron schedule — respects per-workflow timezone, falling back to the
    // dashboard timezone so DST transitions are honoured automatically.
    // Uses croner (absolute-time scheduling, immune to setTimeout drift
    // that causes node-cron 4 to silently miss executions under Docker
    // CPU contention).
    if (wf.schedule?.cron) {
      const dashboardTz = loadDashboardConfig()?.timezone;
      const timezone = wf.schedule.timezone || dashboardTz;
      try {
        const job = new Cron(
          wf.schedule.cron,
          {
            ...(timezone ? { timezone } : {}),
            protect: true,
            catch: (err: unknown) => {
              console.error(`[cron] Workflow ${wf.id} threw:`, err);
            },
            name: wf.id,
          },
          () => { this.executeWorkflow(wf.id, "cron"); },
        );
        this.cronJobs.set(wf.id, job);
      } catch (err) {
        console.warn(`[cron] Invalid schedule for workflow ${wf.id}:`, (err as Error).message);
      }
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
        case "brain_write":
          output = await this.execBrainWrite(resolvedConfig as BrainWriteConfig, run);
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

    // Brain tools — native implementations for tools not in QMD CLI
    if (config.tool === "brain_orphans") {
      const graph = buildLinkGraph();
      const orphans: string[] = [];
      const noIncoming: string[] = [];
      const noOutgoing: string[] = [];
      for (const [path, { outgoing, incoming }] of graph) {
        if (path.startsWith("_")) continue;
        if (incoming.length === 0 && outgoing.length === 0) orphans.push(path);
        else if (incoming.length === 0) noIncoming.push(path);
        else if (outgoing.length === 0) noOutgoing.push(path);
      }
      const sections: string[] = [];
      if (orphans.length > 0) sections.push(`Full orphans (no links at all) — ${orphans.length}:\n${orphans.map(p => `  ✗ ${p}`).join("\n")}`);
      if (noOutgoing.length > 0) sections.push(`No outgoing links — ${noOutgoing.length}:\n${noOutgoing.map(p => `  ⚠ ${p}`).join("\n")}`);
      if (noIncoming.length > 0) sections.push(`No incoming links — ${noIncoming.length}:\n${noIncoming.slice(0, 30).map(p => `  △ ${p}`).join("\n")}`);
      return sections.length > 0 ? sections.join("\n\n") : "No orphans found — all notes are linked.";
    }

    if (config.tool === "brain_links") {
      const graph = buildLinkGraph();
      const path = String(config.args.path ?? "");
      const entry = graph.get(path);
      if (!entry) return `Note not found in link graph: ${path}`;
      return `Note: ${path}\n\nOutgoing links (${entry.outgoing.length}):\n${entry.outgoing.map(l => `  → [[${l}]]`).join("\n") || "  (none)"}\n\nIncoming links (${entry.incoming.length}):\n${entry.incoming.map(l => `  ← ${l}`).join("\n") || "  (none)"}`;
    }

    if (config.tool === "brain_list") {
      const { folder, tag, limit } = config.args as any;
      const maxResults = limit ?? 50;
      const allPaths = getAllNotes();
      const results: string[] = [];
      for (const notePath of allPaths) {
        if (folder && !notePath.startsWith(folder)) continue;
        const meta = loadNote(notePath);
        if (!meta) continue;
        if (tag && !meta.tags.some((t: string) => t === tag || t === `#${tag}`)) continue;
        results.push(`${notePath} — ${meta.title} [${meta.tags.join(", ")}]`);
        if (results.length >= maxResults) break;
      }
      return results.length > 0 ? results.join("\n") : "No notes found matching filters.";
    }

    // Common brain tools — native implementations
    if (config.tool === "common_orphans") {
      const cb = getCommonBrain();
      const graph = cb.buildLinkGraph();
      const orphans: string[] = [];
      const noIncoming: string[] = [];
      const noOutgoing: string[] = [];
      for (const [path, { outgoing, incoming }] of graph) {
        if (path.startsWith("_") || path === "context/README.md") continue;
        if (incoming.length === 0 && outgoing.length === 0) orphans.push(path);
        else if (incoming.length === 0) noIncoming.push(path);
        else if (outgoing.length === 0) noOutgoing.push(path);
      }
      const sections: string[] = [];
      if (orphans.length > 0) sections.push(`Full orphans (no links at all) — ${orphans.length}:\n${orphans.map(p => `  ✗ ${p}`).join("\n")}`);
      if (noOutgoing.length > 0) sections.push(`No outgoing links — ${noOutgoing.length}:\n${noOutgoing.map(p => `  ⚠ ${p}`).join("\n")}`);
      if (noIncoming.length > 0) sections.push(`No incoming links — ${noIncoming.length}:\n${noIncoming.slice(0, 30).map(p => `  △ ${p}`).join("\n")}`);
      return sections.length > 0 ? sections.join("\n\n") : "No orphans found — all common notes are linked.";
    }

    if (config.tool === "common_list") {
      const cb = getCommonBrain();
      const { folder, tag, limit } = config.args as any;
      const maxResults = limit ?? 50;
      const allPaths = cb.getAllNotes();
      const results: string[] = [];
      for (const p of allPaths) {
        if (results.length >= maxResults) break;
        if (folder && !p.startsWith(folder)) continue;
        if (tag) {
          const note = cb.loadNote(p);
          if (!note || !note.tags.some((t: string) => t === tag || t.startsWith(tag + "/"))) continue;
        }
        const note = cb.loadNote(p);
        const title = note?.title ?? p;
        const tags = note?.tags.length ? ` [${note.tags.join(", ")}]` : "";
        results.push(`${p}  —  ${title}${tags}`);
      }
      return results.length > 0 ? results.join("\n") : "No common notes found matching filters.";
    }

    if (config.tool === "common_links") {
      const cb = getCommonBrain();
      const graph = cb.buildLinkGraph();
      const path = String(config.args.path ?? "");
      const entry = graph.get(path);
      if (!entry) return `Note not found in common link graph: ${path}`;
      return `Note: ${path}\n\nOutgoing links (${entry.outgoing.length}):\n${entry.outgoing.map((l: string) => `  → [[${l}]]`).join("\n") || "  (none)"}\n\nIncoming links (${entry.incoming.length}):\n${entry.incoming.map((l: string) => `  ← ${l}`).join("\n") || "  (none)"}`;
    }

    if (config.tool === "common_get") {
      const cb = getCommonBrain();
      const path = String(config.args.path ?? "");
      const note = cb.loadNote(path);
      if (!note) return `Note not found: ${path}`;
      return note.content;
    }

    if (config.tool === "common_commit") {
      const message = String(config.args.message ?? "Workflow auto-commit");
      const result = await commonGitCommit(message, "workflow");
      return result;
    }

    // Common brain QMD tools (search, vsearch, get, write)
    if (config.tool.startsWith("common_")) {
      const qmdCmd = config.tool.replace("common_", "");
      if (!mcpConfig.qmdCliPath) {
        throw new Error("QMD not configured");
      }
      const nodePath = mcpConfig.nodePath.replace(/\\/g, "/");
      const qmdPath = mcpConfig.qmdCliPath.replace(/\\/g, "/");
      const commonIndex = (await import("./common-brain-utils.js")).COMMON_QMD_INDEX;
      const indexArgs = ["--index", commonIndex];

      const cmdArgs: string[] = [qmdPath, ...indexArgs, qmdCmd];
      if (config.args.query) cmdArgs.push(String(config.args.query));
      if (config.args.path) cmdArgs.push(String(config.args.path));
      if (config.args.content) cmdArgs.push(String(config.args.content));

      const { stdout, stderr } = await execFileAsync(nodePath, cmdArgs, {
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, HOME: process.env.USERPROFILE ?? process.env.HOME },
      });
      return (stdout + stderr).trim();
    }

    // Brain tools — call QMD CLI for search/get/write/etc.
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
      const { serviceType } = parseInstanceId(service);
      const svcConfig = SERVICES[serviceType];
      if (!svcConfig) throw new Error(`Unknown service: ${serviceType}`);
      if (svcConfig.kind === "connection") throw new Error(`"${serviceType}" is a connection service — use service_execute`);

      const store = loadStore();
      const saved = store[service] ?? (service === serviceType ? undefined : store[serviceType]);
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

    // Service execute (connection services: WinRM, SSH, databases, etc.)
    if (config.tool === "service_execute") {
      const { service, command } = config.args as any;
      const { serviceType } = parseInstanceId(service);
      const svcConfig = SERVICES[serviceType];
      if (!svcConfig) throw new Error(`Unknown service: ${serviceType}`);
      if (svcConfig.kind !== "connection") {
        throw new Error(`"${serviceType}" is a REST API service — use service_request`);
      }

      const store = loadStore();
      const saved = store[service] ?? (service === serviceType ? undefined : store[serviceType]);
      if (!saved) throw new Error(`Service "${service}" not connected`);

      const allParams: Record<string, string> = { ...saved.extras, password: saved.token };
      return await svcConfig.execute(allParams, String(command ?? ""));
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
    // Append structured output instruction so downstream nodes can grab results
    const structuredSuffix = `\n\nIMPORTANT: At the end of your response, include a JSON block wrapped in <workflow-output> tags containing your structured result. Example:\n<workflow-output>\n{"status": "success", "summary": "...", "data": {...}}\n</workflow-output>\nIf the task failed or could not be completed, set status to "error" with a "reason" field.`;

    const fullPrompt = config.prompt + structuredSuffix;

    try {
      const args = ["-p", fullPrompt, "--output-format", "json"];
      if (config.bypassPermissions) {
        args.push("--permission-mode", "bypassPermissions");
      }
      const { PROJECT_ROOT } = await import("./paths.js");
      const timeoutMs = (config.timeout ?? 1800) * 1000;
      const { stdout } = await execFileAsync("claude", args, {
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        cwd: config.useProjectContext ? PROJECT_ROOT : undefined,
      });

      // Parse Claude JSON output
      let parsed: any;
      try { parsed = JSON.parse(stdout); } catch { parsed = stdout.trim(); }

      // Extract structured output from <workflow-output> tags
      const structuredResult = this.extractWorkflowOutput(parsed);

      // Check if the AI reported an error
      if (structuredResult?.status === "error") {
        throw new Error(structuredResult.reason ?? "Task reported error status");
      }

      // Return both the full conversation and the structured result
      return {
        conversation: parsed,
        result: structuredResult,
      };
    } catch (err: any) {
      const stderr = (err.stderr || "").toString().trim();
      const killed = err.killed ? " (killed — likely timeout)" : "";
      const detail = stderr ? ` — stderr: ${stderr.slice(-500)}` : "";
      throw new Error(`Claude prompt failed${killed}${detail}`);
    }
  }

  /** Extract <workflow-output>JSON</workflow-output> from Claude's response */
  private extractWorkflowOutput(parsed: any): any {
    // Use the unescaped response text — claude JSON puts it in .result.
    // JSON.stringify would double-escape quotes/newlines and break JSON.parse below.
    const text =
      typeof parsed === "string"
        ? parsed
        : typeof parsed?.result === "string"
          ? parsed.result
          : JSON.stringify(parsed);
    const match = text.match(/<workflow-output>\s*([\s\S]*?)\s*<\/workflow-output>/);
    if (match) {
      try { return JSON.parse(match[1]); } catch { return null; }
    }
    return null;
  }

  // ── Brain Write Executor ──────────────────────────────────────────────

  private async execBrainWrite(config: BrainWriteConfig, run: WorkflowRun): Promise<string> {
    const { writeNote, BRAIN_ROOT } = await import("./brain-utils.js");
    const { existsSync, readFileSync, writeFileSync } = await import("fs");
    const { join } = await import("path");
    const { mkdirSync } = await import("fs");

    // Determine content — either static or from a node's output
    let content = config.content ?? "";
    if (config.useNodeOutput) {
      const sourceResult = run.nodeResults[config.useNodeOutput];
      if (sourceResult?.output) {
        const out = sourceResult.output;
        // If it's a Claude structured output, grab the result
        if (typeof out === "object" && (out as any).result) {
          content = typeof (out as any).result === "string"
            ? (out as any).result
            : JSON.stringify((out as any).result, null, 2);
        } else {
          content = typeof out === "string" ? out : JSON.stringify(out, null, 2);
        }
      }
    }

    const now = new Date();
    const tags = config.tags ? config.tags.split(",").map((t) => t.trim()) : [];

    switch (config.action) {
      case "note": {
        const title = config.title ?? `Workflow Note ${now.toISOString().slice(0, 10)}`;
        const path = config.path ?? `knowledge/notes/${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`;
        const frontmatter = [
          "---",
          `title: ${title}`,
          `tags:`,
          `  - note`,
          `  - status/active`,
          ...tags.map((t) => `  - ${t}`),
          `created: ${now.toISOString()}`,
          "---",
        ].join("\n");
        writeNote(path, `${frontmatter}\n\n${content}`);
        return `Written note: ${path}`;
      }

      case "project": {
        const title = config.title ?? `Project Update`;
        const path = config.path ?? `knowledge/projects/${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`;
        const frontmatter = [
          "---",
          `title: ${title}`,
          `tags:`,
          `  - project`,
          `  - status/active`,
          ...tags.map((t) => `  - ${t}`),
          `created: ${now.toISOString()}`,
          "---",
        ].join("\n");
        writeNote(path, `${frontmatter}\n\n${content}`);
        return `Written project note: ${path}`;
      }

      case "update_active": {
        const activePath = join(BRAIN_ROOT, "context", "ACTIVE.md");
        const existing = existsSync(activePath) ? readFileSync(activePath, "utf-8") : "";
        const timestamp = now.toISOString().slice(0, 16).replace("T", " ");
        const updated = existing + `\n\n## Update ${timestamp}\n\n${content}`;
        writeFileSync(activePath, updated);
        return `Updated ACTIVE.md`;
      }

      case "archive_result": {
        const year = String(now.getFullYear());
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const workflowName = run.workflowId;
        const archiveDir = `archive/${year}/${month}/${workflowName}`;
        const fileName = `${now.toISOString().slice(0, 10)}-${run.runId.slice(0, 8)}.md`;
        const path = `${archiveDir}/${fileName}`;
        const frontmatter = [
          "---",
          `title: ${workflowName} run ${now.toISOString().slice(0, 10)}`,
          `tags:`,
          `  - retrospective`,
          `  - status/archived`,
          ...tags.map((t) => `  - ${t}`),
          `workflow: ${workflowName}`,
          `runId: ${run.runId}`,
          `created: ${now.toISOString()}`,
          "---",
        ].join("\n");
        // Ensure directory exists
        const fullDir = join(BRAIN_ROOT, archiveDir);
        mkdirSync(fullDir, { recursive: true });
        writeNote(path, `${frontmatter}\n\n${content}`);
        return `Archived to: ${path}`;
      }

      default:
        throw new Error(`Unknown brain_write action: ${config.action}`);
    }
  }
}
