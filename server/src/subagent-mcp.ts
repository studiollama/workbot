/**
 * Creates a scoped MCP server instance for a subagent.
 * Brain tools are rebased to the subagent's brain directory.
 * Service tools are filtered to the subagent's allowed services.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getSubagent, getSubagentBrainRoot } from "./subagents.js";
import { SERVICES, loadStore } from "./services.js";
import { loadMcpConfig } from "./mcp-config.js";
import { logToolCall } from "./mcp-logger.js";
import { readActiveKey, isStoreEncrypted } from "./crypto.js";
import { createScopedBrainUtils } from "./subagent-brain-utils.js";

const execFileAsync = promisify(execFile);

export async function createSubagentMcpServer(subagentId: string): Promise<void> {
  const subagent = getSubagent(subagentId);
  if (!subagent) throw new Error(`Subagent "${subagentId}" not found`);

  const brainRoot = getSubagentBrainRoot(subagentId);
  const brain = createScopedBrainUtils(brainRoot);
  const mcpConfig = loadMcpConfig();
  const allowedSet = new Set(subagent.allowedServices);

  const server = new McpServer({
    name: `workbot-subagent-${subagentId}`,
    version: "0.1.0",
  });

  // ── Logged tool wrapper ──────────────────────────────────────────────

  function loggedTool(
    name: string,
    description: string,
    schema: Record<string, z.ZodTypeAny>,
    handler: (args: any) => Promise<any>
  ) {
    server.tool(name, description, schema, async (args: any) => {
      const start = Date.now();
      try {
        const result = await handler(args);
        logToolCall(`${subagentId}/${name}`, args, Date.now() - start);
        return result;
      } catch (err) {
        logToolCall(`${subagentId}/${name}`, args, Date.now() - start);
        throw err;
      }
    });
  }

  // ── QMD runner (scoped to subagent index) ────────────────────────────

  async function runQmd(args: string[]): Promise<string> {
    if (!mcpConfig.qmdCliPath) {
      return "QMD not configured.";
    }
    try {
      const nodePath = mcpConfig.nodePath.replace(/\\/g, "/");
      const qmdPath = mcpConfig.qmdCliPath!.replace(/\\/g, "/");
      const indexArgs = subagent!.qmdIndex ? ["--index", subagent!.qmdIndex] : [];
      const { stdout, stderr } = await execFileAsync(
        nodePath,
        [qmdPath, ...indexArgs, ...args],
        {
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
          env: { ...process.env, HOME: process.env.USERPROFILE ?? process.env.HOME },
          cwd: brainRoot,
        }
      );
      return (stdout + stderr).trim();
    } catch (err: any) {
      const out = ((err.stdout ?? "") + (err.stderr ?? "")).trim();
      return out || `Error: ${err.message}`;
    }
  }

  // ── Brain tools (scoped to subagent brain) ───────────────────────────

  loggedTool("brain_search", "Search this subagent's brain.", { query: z.string() }, async ({ query }) => {
    return { content: [{ type: "text", text: await runQmd(["search", query]) }] };
  });

  loggedTool("brain_vsearch", "Semantic search on this subagent's brain.", { query: z.string() }, async ({ query }) => {
    return { content: [{ type: "text", text: await runQmd(["vsearch", query]) }] };
  });

  loggedTool("brain_get", "Get a note from this subagent's brain.", { path: z.string() }, async ({ path }) => {
    return { content: [{ type: "text", text: await runQmd(["get", path]) }] };
  });

  loggedTool("brain_update", "Re-index this subagent's brain.", { embed: z.boolean().optional() }, async ({ embed }) => {
    const out = await runQmd(["update"]);
    if (!embed) return { content: [{ type: "text", text: out }] };
    const embedOut = await runQmd(["embed"]);
    return { content: [{ type: "text", text: out + "\n\n--- Embedding ---\n" + embedOut }] };
  });

  loggedTool("brain_write", "Write a note to this subagent's brain.", {
    path: z.string(),
    content: z.string(),
    force: z.boolean().optional(),
  }, async ({ path, content, force }) => {
    const validation = brain.validateNote(content);
    if (!validation.valid && !force) {
      return { content: [{ type: "text", text: `Validation failed:\n${validation.warnings.map(w => `  - ${w}`).join("\n")}` }], isError: true };
    }
    brain.writeNote(path, content);
    let indexResult = "";
    try { indexResult = await runQmd(["update"]); } catch { indexResult = "(index skipped)"; }
    return { content: [{ type: "text", text: `Written: ${path} (${content.length} chars)\n\nIndex: ${indexResult}` }] };
  });

  loggedTool("brain_list", "List notes in this subagent's brain.", {
    folder: z.string().optional(),
    tag: z.string().optional(),
    limit: z.number().optional(),
  }, async ({ folder, tag, limit }) => {
    const maxResults = limit ?? 50;
    const allPaths = brain.getAllNotes();
    const results: string[] = [];
    for (const p of allPaths) {
      if (results.length >= maxResults) break;
      if (folder && !p.startsWith(folder)) continue;
      if (tag) {
        const note = brain.loadNote(p);
        if (!note || !note.tags.some(t => t === tag || t.startsWith(tag + "/"))) continue;
      }
      const note = brain.loadNote(p);
      results.push(`${p}  —  ${note?.title ?? p}`);
    }
    return { content: [{ type: "text", text: results.length > 0 ? results.join("\n") : "No notes found." }] };
  });

  loggedTool("brain_context", "Load session context for this subagent.", {
    hours: z.number().optional(),
  }, async ({ hours }) => {
    const sections: string[] = [];
    const activePath = join(brainRoot, "context", "ACTIVE.md");
    if (existsSync(activePath)) {
      sections.push(`## ACTIVE.md\n\n${readFileSync(activePath, "utf-8")}`);
    } else {
      sections.push("## ACTIVE.md\n\n(not found)");
    }

    const cutoff = Date.now() - (hours ?? 48) * 60 * 60 * 1000;
    const allPaths = brain.getAllNotes();
    const recent: string[] = [];
    for (const p of allPaths) {
      if (p.startsWith("context/")) continue;
      const note = brain.loadNote(p);
      if (note && note.mtime.getTime() >= cutoff) {
        const ago = formatAgo(note.mtime);
        recent.push(`- \`${p}\` — ${note.title} (${ago})`);
      }
    }
    if (recent.length > 0) {
      sections.push(`## Recently Modified\n\n${recent.slice(0, 15).join("\n")}`);
    }

    return { content: [{ type: "text", text: sections.join("\n\n---\n\n") }] };
  });

  // ── Service tools (scoped to allowed services) ───────────────────────

  loggedTool("service_status", "List services available to this subagent.", {}, async () => {
    if (isStoreEncrypted() && !readActiveKey()) {
      return { content: [{ type: "text", text: "Dashboard session required — log in to unlock services." }], isError: true };
    }
    const store = loadStore();
    const lines: string[] = [];
    for (const [key, config] of Object.entries(SERVICES)) {
      if (!allowedSet.has(key)) {
        lines.push(`${config.name} (${key}): not available`);
        continue;
      }
      const saved = store[key];
      lines.push(saved
        ? `${config.name} (${key}): connected — ${saved.user}`
        : `${config.name} (${key}): disconnected`
      );
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  });

  loggedTool("service_request", "Make an API request to an allowed service.", {
    service: z.string(),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    url: z.string(),
    body: z.string().optional(),
    headers: z.record(z.string()).optional(),
  }, async ({ service, method, url, body, headers: extraHeaders }) => {
    if (!allowedSet.has(service)) {
      return { content: [{ type: "text", text: `Service "${service}" is not available to this subagent.` }], isError: true };
    }
    if (isStoreEncrypted() && !readActiveKey()) {
      return { content: [{ type: "text", text: "Dashboard session required." }], isError: true };
    }
    const config = SERVICES[service];
    if (!config) return { content: [{ type: "text", text: `Unknown service: ${service}` }], isError: true };

    const store = loadStore();
    const saved = store[service];
    if (!saved) return { content: [{ type: "text", text: `Service "${config.name}" is not connected on the host.` }], isError: true };

    try {
      let token = saved.token;
      if (config.preConnect && saved.extras) {
        token = (await config.preConnect(saved.token, saved.extras)).resolvedToken;
      }
      const authHeaders = config.authHeader(token, saved.extras);
      const mergedHeaders: Record<string, string> = { ...authHeaders, ...(extraHeaders ?? {}) };
      if (body && !mergedHeaders["Content-Type"]) mergedHeaders["Content-Type"] = "application/json";

      const response = await fetch(url, { method, headers: mergedHeaders, ...(body ? { body } : {}) });
      const text = await response.text();
      let formatted: string;
      try { formatted = JSON.stringify(JSON.parse(text), null, 2); } catch { formatted = text; }
      return { content: [{ type: "text", text: `${response.status} ${response.statusText}\n\n${formatted}` }], isError: response.status >= 400 };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Request failed: ${err.message}` }], isError: true };
    }
  });

  // ── Debug ────────────────────────────────────────────────────────────

  loggedTool("debug_env", "Show subagent environment info.", {}, async () => {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          subagentId,
          brainRoot,
          allowedServices: [...allowedSet],
          qmdIndex: subagent.qmdIndex,
        }, null, 2),
      }],
    };
  });

  // ── Connect ──────────────────────────────────────────────────────────

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function formatAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── CLI entrypoint: tsx server/src/subagent-mcp.ts <subagent-id> ──────
const cliSubagentId = process.argv[2];
if (cliSubagentId) {
  createSubagentMcpServer(cliSubagentId).catch((err) => {
    console.error(`[subagent-mcp] Fatal: ${err.message}`);
    process.exit(1);
  });
}
