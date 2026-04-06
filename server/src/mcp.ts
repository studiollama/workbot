// Security model: MCP uses stdio transport (no network exposure).
// Service tokens are encrypted at rest in services.json.
// Decryption requires an active dashboard session (.workbot/.active-key).
// The active key file is ephemeral — deleted on logout/shutdown.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { readFileSync, writeFileSync, existsSync, statSync } from "fs";
import { resolve, isAbsolute, join } from "path";
import { SERVICES, loadStore, PROJECT_ROOT } from "./services.js";
import { loadMcpConfig } from "./mcp-config.js";
import { logToolCall } from "./mcp-logger.js";
import { readActiveKey, isStoreEncrypted } from "./crypto.js";
import {
  ensureCommonBrainDir,
  getCommonBrain,
  commonGitCommit,
  commonGitLog,
  COMMON_BRAIN_ROOT,
  COMMON_QMD_INDEX,
  validateCommonPath,
  readCommonContext,
} from "./common-brain-utils.js";
import {
  BRAIN_ROOT,
  getAllNotes,
  loadNote,
  buildLinkGraph,
  validateNote,
  writeNote,
} from "./brain-utils.js";

import { getSubagent as getSubagentById, getSubagentBrainRoot, loadSubagents, createSubagent as createSubagentDef, updateSubagent as updateSubagentDef, deleteSubagent as deleteSubagentDef } from "./subagents.js";
import { parseInstanceId, isServiceAllowed } from "./services.js";
import { createScopedBrainUtils } from "./subagent-brain-utils.js";
import {
  addServiceContext,
  removeServiceContext,
  getServiceContext,
  loadServiceContexts,
  resolveServiceContext,
} from "./service-contexts.js";
import { loadWorkflows, loadRuns, getRun, getWorkflow, upsertWorkflow, deleteWorkflow as removeWorkflow, type WorkflowDefinition } from "./workflows-config.js";
import { randomUUID } from "crypto";
import { WorkflowEngine } from "./workflow-engine.js";

const execFileAsync = promisify(execFile);
const mcpConfig = loadMcpConfig();

import https from "https";

/** Load decrypted store — subagent MCP processes fetch from the server's
 *  internal API (avoids needing the active-key file). Host MCP reads directly. */
async function loadStoreSecure(): Promise<Record<string, import("./paths.js").StoredService>> {
  if (SUBAGENT_ID) {
    try {
      const port = mcpConfig.serverPort || 3001;
      const data = await new Promise<string>((resolve, reject) => {
        const req = https.get(`https://localhost:${port}/api/internal/store`, {
          rejectUnauthorized: false, // self-signed cert
        }, (res) => {
          let body = "";
          res.on("data", (c) => { body += c; });
          res.on("end", () => resolve(body));
        });
        req.on("error", reject);
        req.setTimeout(5000, () => { req.destroy(); reject(new Error("timeout")); });
      });
      return JSON.parse(data);
    } catch { /* fallback to direct read */ }
  }
  return loadStore();
}

// ── Subagent scoping: --subagent <id> flag ─────────────────────────────
// When present, brain tools operate on the subagent's brain and services
// are filtered to only those assigned to the subagent.
const subagentFlag = process.argv.indexOf("--subagent");
const SUBAGENT_ID = subagentFlag >= 0 ? process.argv[subagentFlag + 1] : null;
if (SUBAGENT_ID) console.error(`[mcp] Subagent mode: ${SUBAGENT_ID}, argv: ${process.argv.join(" ")}`);

// Security: non-root users MUST use --subagent flag to prevent privilege escalation
import { userInfo } from "os";
const currentUser = userInfo();
if (!SUBAGENT_ID && currentUser.uid !== 0) {
  console.error("[mcp] FATAL: Non-root users must specify --subagent <id>. Refusing to start in host mode.");
  process.exit(1);
}
// Security: validate that --subagent ID matches the running Linux user (sa-{id})
// Prevents a subagent from passing a different --subagent flag to access another's services
if (SUBAGENT_ID && currentUser.uid !== 0) {
  const expectedUser = `sa-${SUBAGENT_ID}`;
  if (currentUser.username !== expectedUser) {
    console.error(`[mcp] FATAL: User ${currentUser.username} cannot use --subagent ${SUBAGENT_ID} (expected ${expectedUser}).`);
    process.exit(1);
  }
}

// Scoped brain root: subagent brain or host brain
const SCOPED_BRAIN_ROOT = SUBAGENT_ID ? getSubagentBrainRoot(SUBAGENT_ID) : BRAIN_ROOT;

// Note: service filtering uses isServiceAllowed() from services.ts
// which reads subagent config fresh each call (not cached)

// Override brain-utils functions when in subagent mode
const scopedBrain = SUBAGENT_ID ? createScopedBrainUtils(SCOPED_BRAIN_ROOT) : null;
const scopedGetAllNotes = scopedBrain ? scopedBrain.getAllNotes : getAllNotes;
const scopedLoadNote = scopedBrain ? scopedBrain.loadNote : loadNote;
const scopedValidateNote = scopedBrain ? scopedBrain.validateNote : validateNote;
const scopedWriteNote = scopedBrain ? scopedBrain.writeNote : writeNote;
const scopedBuildLinkGraph = scopedBrain ? scopedBrain.buildLinkGraph : buildLinkGraph;

// ── Common knowledge brain (shared across all agents) ─────────────────
ensureCommonBrainDir();
const commonBrain = getCommonBrain();

const serverName = SUBAGENT_ID ? `workbot-subagent-${SUBAGENT_ID}` : "workbot";

const server = new McpServer({
  name: serverName,
  version: "0.1.0",
});

// Track which services have had their context delivered this session
const contextDelivered = new Set<string>();

// ── Logged tool wrapper ─────────────────────────────────────────────────

function loggedTool(
  name: string,
  description: string,
  schema: Record<string, z.ZodTypeAny>,
  handler: (args: any) => Promise<any>
) {
  // Prefix tool name with subagent ID for log filtering
  const logName = SUBAGENT_ID ? `${SUBAGENT_ID}/${name}` : name;
  server.tool(name, description, schema, async (args: any) => {
    const start = Date.now();
    try {
      const result = await handler(args);
      logToolCall(logName, args, Date.now() - start);
      return result;
    } catch (err) {
      logToolCall(logName, args, Date.now() - start);
      throw err;
    }
  });
}

// ── Brain tools (wrap QMD CLI) ──────────────────────────────────────────

async function runQmd(args: string[]): Promise<string> {
  if (!mcpConfig.qmdCliPath) {
    return "QMD not configured. Set the QMD CLI path in the workbot dashboard (MCP tab).";
  }

  try {
    // Normalize backslashes to forward slashes — Windows JSON may store C:\\...
    const nodePath = mcpConfig.nodePath.replace(/\\/g, "/");
    const qmdPath = mcpConfig.qmdCliPath!.replace(/\\/g, "/");
    const indexArgs = mcpConfig.qmdIndex ? ["--index", mcpConfig.qmdIndex] : [];
    const { stdout, stderr } = await execFileAsync(
      nodePath,
      [qmdPath, ...indexArgs, ...args],
      {
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, HOME: process.env.USERPROFILE ?? process.env.HOME },
      }
    );
    return (stdout + stderr).trim();
  } catch (err: any) {
    const out = ((err.stdout ?? "") + (err.stderr ?? "")).trim();
    if (out) return out;
    return `Error: ${err.message}`;
  }
}

loggedTool(
  "brain_search",
  "BM25 keyword search on the workbot brain (Obsidian vault). Fast, use this first.",
  { query: z.string().describe("Search keywords") },
  async ({ query }) => {
    const text = await runQmd(["search", query]);
    return { content: [{ type: "text", text }] };
  }
);

loggedTool(
  "brain_vsearch",
  "Vector semantic search on the workbot brain. Slower (~5s) but finds conceptual matches. Use when keyword search misses.",
  { query: z.string().describe("Natural language question") },
  async ({ query }) => {
    const text = await runQmd(["vsearch", query]);
    return { content: [{ type: "text", text }] };
  }
);

loggedTool(
  "brain_get",
  "Retrieve a specific note from the workbot brain by path.",
  { path: z.string().describe("Note path relative to vault root, e.g. knowledge/decisions/some-note.md") },
  async ({ path }) => {
    const text = await runQmd(["get", path]);
    return { content: [{ type: "text", text }] };
  }
);

loggedTool(
  "brain_update",
  "Re-index the workbot brain. Run after adding/editing notes. Optionally re-embed vectors.",
  { embed: z.boolean().optional().describe("Also regenerate vector embeddings (slower). Default false.") },
  async ({ embed }) => {
    const updateOut = await runQmd(["update"]);
    if (!embed) {
      return { content: [{ type: "text", text: updateOut }] };
    }
    const embedOut = await runQmd(["embed"]);
    return { content: [{ type: "text", text: updateOut + "\n\n--- Embedding ---\n" + embedOut }] };
  }
);

// ── brain_write ─────────────────────────────────────────────────────────

loggedTool(
  "brain_write",
  "Create or update a note in the workbot brain. Validates frontmatter (requires type + status tags) and checks for wikilinks. Auto re-indexes after writing.",
  {
    path: z.string().describe("Note path relative to vault root, e.g. knowledge/decisions/my-decision.md"),
    content: z.string().describe("Full markdown content including YAML frontmatter"),
    force: z.boolean().optional().describe("Skip validation warnings and write anyway. Default false."),
  },
  async ({ path, content, force }) => {
    const validation = scopedValidateNote(content);

    if (!validation.valid && !force) {
      return {
        content: [{
          type: "text",
          text: `Validation failed — fix these issues or set force=true:\n${validation.warnings.map((w) => `  - ${w}`).join("\n")}`,
        }],
        isError: true,
      };
    }

    scopedWriteNote(path, content);

    let warnings = "";
    if (validation.warnings.length > 0) {
      warnings = `\n\nWarnings (written anyway due to force=true):\n${validation.warnings.map((w) => `  - ${w}`).join("\n")}`;
    }

    // Re-index
    let indexResult = "";
    try {
      indexResult = await runQmd(["update"]);
    } catch {
      indexResult = "(QMD re-index skipped — not configured)";
    }

    return {
      content: [{
        type: "text",
        text: `Written: ${path} (${content.length} chars)${warnings}\n\nIndex: ${indexResult}`,
      }],
    };
  }
);

// ── brain_links ─────────────────────────────────────────────────────────

loggedTool(
  "brain_links",
  "Show the link graph for a brain note — what it links to (outgoing) and what links to it (incoming). Useful for tracing decision chains and finding related knowledge.",
  {
    path: z.string().describe("Note path relative to vault root, e.g. knowledge/decisions/my-decision.md"),
  },
  async ({ path }) => {
    const graph = scopedBuildLinkGraph();
    const entry = graph.get(path);

    if (!entry) {
      // Try fuzzy match by title
      const titleLower = path.replace(/\.md$/, "").split("/").pop()?.toLowerCase() ?? "";
      let found: string | null = null;
      for (const [p] of graph) {
        const pTitle = p.replace(/\.md$/, "").split("/").pop()?.toLowerCase() ?? "";
        if (pTitle === titleLower) { found = p; break; }
      }
      if (found) {
        const e = graph.get(found)!;
        return {
          content: [{
            type: "text",
            text: `Note: ${found}\n\nOutgoing links (${e.outgoing.length}):\n${e.outgoing.map((l) => `  → [[${l}]]`).join("\n") || "  (none)"}\n\nIncoming links (${e.incoming.length}):\n${e.incoming.map((l) => `  ← ${l}`).join("\n") || "  (none)"}`,
          }],
        };
      }
      return {
        content: [{ type: "text", text: `Note not found: ${path}` }],
        isError: true,
      };
    }

    return {
      content: [{
        type: "text",
        text: `Note: ${path}\n\nOutgoing links (${entry.outgoing.length}):\n${entry.outgoing.map((l) => `  → [[${l}]]`).join("\n") || "  (none)"}\n\nIncoming links (${entry.incoming.length}):\n${entry.incoming.map((l) => `  ← ${l}`).join("\n") || "  (none)"}`,
      }],
    };
  }
);

// ── brain_list ──────────────────────────────────────────────────────────

loggedTool(
  "brain_list",
  "List brain notes filtered by folder, tag, or status. Returns paths and titles. Use to browse the brain without needing to search.",
  {
    folder: z.string().optional().describe("Filter to notes in this folder, e.g. 'knowledge/decisions'"),
    tag: z.string().optional().describe("Filter to notes with this tag, e.g. 'decision', 'status/active', 'domain/ui'"),
    limit: z.number().optional().describe("Max results to return. Default 50."),
  },
  async ({ folder, tag, limit }) => {
    const maxResults = limit ?? 50;
    const allPaths = scopedGetAllNotes();
    const results: string[] = [];

    for (const p of allPaths) {
      if (results.length >= maxResults) break;

      // Folder filter
      if (folder && !p.startsWith(folder)) continue;

      // Tag filter
      if (tag) {
        const note = scopedLoadNote(p);
        if (!note || !note.tags.some((t) => t === tag || t.startsWith(tag + "/"))) continue;
      }

      const note = scopedLoadNote(p);
      const title = note?.title ?? p;
      const tags = note?.tags.length ? ` [${note.tags.join(", ")}]` : "";
      results.push(`${p}  —  ${title}${tags}`);
    }

    if (results.length === 0) {
      return {
        content: [{
          type: "text",
          text: `No notes found${folder ? ` in ${folder}` : ""}${tag ? ` with tag '${tag}'` : ""}.`,
        }],
      };
    }

    return {
      content: [{
        type: "text",
        text: `Found ${results.length} note${results.length > 1 ? "s" : ""}${folder ? ` in ${folder}` : ""}${tag ? ` with tag '${tag}'` : ""}:\n\n${results.join("\n")}`,
      }],
    };
  }
);

// ── brain_recent ────────────────────────────────────────────────────────

loggedTool(
  "brain_recent",
  "Show recently modified brain notes. Useful for session handoffs — see what changed since the last conversation.",
  {
    hours: z.number().optional().describe("Show notes modified within this many hours. Default 24."),
    limit: z.number().optional().describe("Max results. Default 20."),
  },
  async ({ hours, limit }) => {
    const cutoff = Date.now() - (hours ?? 24) * 60 * 60 * 1000;
    const maxResults = limit ?? 20;
    const allPaths = scopedGetAllNotes();

    const recent: { path: string; mtime: Date; title: string }[] = [];
    for (const p of allPaths) {
      const note = scopedLoadNote(p);
      if (!note) continue;
      if (note.mtime.getTime() >= cutoff) {
        recent.push({ path: p, mtime: note.mtime, title: note.title });
      }
    }

    recent.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    const trimmed = recent.slice(0, maxResults);

    if (trimmed.length === 0) {
      return {
        content: [{
          type: "text",
          text: `No notes modified in the last ${hours ?? 24} hours.`,
        }],
      };
    }

    const lines = trimmed.map((r) => {
      const ago = formatAgo(r.mtime);
      return `${r.path}  —  ${r.title}  (${ago})`;
    });

    return {
      content: [{
        type: "text",
        text: `${trimmed.length} note${trimmed.length > 1 ? "s" : ""} modified in the last ${hours ?? 24}h:\n\n${lines.join("\n")}`,
      }],
    };
  }
);

function formatAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ── brain_orphans ───────────────────────────────────────────────────────

loggedTool(
  "brain_orphans",
  "Find brain notes with no incoming or outgoing wikilinks. These violate the 'no orphan notes' rule and need to be linked.",
  {},
  async () => {
    const graph = scopedBuildLinkGraph();
    const orphans: string[] = [];
    const noIncoming: string[] = [];
    const noOutgoing: string[] = [];

    for (const [path, { outgoing, incoming }] of graph) {
      // Skip system/template files
      if (path.startsWith("_")) continue;

      if (incoming.length === 0 && outgoing.length === 0) {
        orphans.push(path);
      } else if (incoming.length === 0) {
        noIncoming.push(path);
      } else if (outgoing.length === 0) {
        noOutgoing.push(path);
      }
    }

    const sections: string[] = [];

    if (orphans.length > 0) {
      sections.push(`Full orphans (no links at all) — ${orphans.length}:\n${orphans.map((p) => `  ✗ ${p}`).join("\n")}`);
    }
    if (noOutgoing.length > 0) {
      sections.push(`No outgoing links (linked by others, but links nothing) — ${noOutgoing.length}:\n${noOutgoing.map((p) => `  ⚠ ${p}`).join("\n")}`);
    }
    if (noIncoming.length > 0 && noIncoming.length <= 30) {
      sections.push(`No incoming links (links to others, but nothing links here) — ${noIncoming.length}:\n${noIncoming.map((p) => `  △ ${p}`).join("\n")}`);
    } else if (noIncoming.length > 30) {
      sections.push(`No incoming links — ${noIncoming.length} notes (showing first 30):\n${noIncoming.slice(0, 30).map((p) => `  △ ${p}`).join("\n")}`);
    }

    if (sections.length === 0) {
      return {
        content: [{ type: "text", text: "Graph health: all notes have both incoming and outgoing links." }],
      };
    }

    return {
      content: [{
        type: "text",
        text: `Graph health report:\n\n${sections.join("\n\n")}`,
      }],
    };
  }
);

// ── brain_context ───────────────────────────────────────────────────────

loggedTool(
  "brain_context",
  "Smart session bootstrap. Loads ACTIVE.md + recent corrections + all notes tagged #status/active + recently modified notes. One call to get full session context instead of multiple reads.",
  {
    hours: z.number().optional().describe("Include notes modified within this many hours. Default 48."),
  },
  async ({ hours }) => {
    const sections: string[] = [];

    // 1. ACTIVE.md
    const activePath = join(SCOPED_BRAIN_ROOT, "context", "ACTIVE.md");
    if (existsSync(activePath)) {
      const active = readFileSync(activePath, "utf-8");
      sections.push(`## ACTIVE.md\n\n${active}`);
    } else {
      sections.push("## ACTIVE.md\n\n(not found)");
    }

    // 2. Recent corrections
    const correctionsPath = join(SCOPED_BRAIN_ROOT, "context", "CORRECTIONS.md");
    if (existsSync(correctionsPath)) {
      const corrections = readFileSync(correctionsPath, "utf-8");
      sections.push(`## Recent Corrections\n\n${corrections}`);
    }

    // 3. All notes tagged #status/active (excluding context/ files already loaded)
    const allPaths = scopedGetAllNotes();
    const activeNotes: string[] = [];
    for (const p of allPaths) {
      if (p.startsWith("context/")) continue;
      if (p.startsWith("_")) continue;
      const note = scopedLoadNote(p);
      if (note && note.tags.includes("status/active")) {
        activeNotes.push(`- **${note.title}** — \`${p}\`${note.tags.length > 0 ? ` [${note.tags.filter((t) => t !== "status/active").join(", ")}]` : ""}`);
      }
    }
    if (activeNotes.length > 0) {
      sections.push(`## Active Notes (${activeNotes.length})\n\n${activeNotes.join("\n")}`);
    }

    // 4. Recently modified (excluding already-listed context files)
    const cutoff = Date.now() - (hours ?? 48) * 60 * 60 * 1000;
    const recent: { path: string; title: string; ago: string }[] = [];
    for (const p of allPaths) {
      if (p.startsWith("context/")) continue;
      if (p.startsWith("_")) continue;
      const note = scopedLoadNote(p);
      if (note && note.mtime.getTime() >= cutoff) {
        recent.push({ path: p, title: note.title, ago: formatAgo(note.mtime) });
      }
    }
    recent.sort((a, b) => {
      const aNote = loadNote(a.path);
      const bNote = loadNote(b.path);
      return (bNote?.mtime.getTime() ?? 0) - (aNote?.mtime.getTime() ?? 0);
    });
    if (recent.length > 0) {
      const recentLines = recent.slice(0, 15).map((r) => `- \`${r.path}\` — ${r.title} (${r.ago})`);
      sections.push(`## Recently Modified (${recent.length}, last ${hours ?? 48}h)\n\n${recentLines.join("\n")}`);
    }

    return {
      content: [{
        type: "text",
        text: sections.join("\n\n---\n\n"),
      }],
    };
  }
);

// ── Common knowledge tools (available to host + subagents) ────────────

let commonContextInjected = false;

/** Append common brain context guide on first use per session */
function maybeInjectCommonContext(text: string): string {
  if (commonContextInjected) return text;
  commonContextInjected = true;
  const ctx = readCommonContext();
  if (!ctx) return text;
  return text + `\n\n--- Common Knowledge Guide (first use this session) ---\n${ctx}\n--- End Guide ---`;
}

async function runCommonQmd(args: string[]): Promise<string> {
  if (!mcpConfig.qmdCliPath) {
    return "QMD not configured. Set the QMD CLI path in the workbot dashboard (MCP tab).";
  }
  try {
    const nodePath = mcpConfig.qmdCliPath ? mcpConfig.nodePath.replace(/\\/g, "/") : "node";
    const qmdPath = mcpConfig.qmdCliPath!.replace(/\\/g, "/");
    const { stdout, stderr } = await execFileAsync(
      nodePath,
      [qmdPath, "--index", COMMON_QMD_INDEX, ...args],
      {
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, HOME: process.env.USERPROFILE ?? process.env.HOME },
      }
    );
    return (stdout + stderr).trim();
  } catch (err: any) {
    const out = ((err.stdout ?? "") + (err.stderr ?? "")).trim();
    if (out) return out;
    return `Error: ${err.message}`;
  }
}

loggedTool(
  "common_search",
  "BM25 keyword search on the common knowledge brain (shared across all agents). Fast, use first.",
  { query: z.string().describe("Search keywords") },
  async ({ query }) => ({
    content: [{ type: "text", text: maybeInjectCommonContext(await runCommonQmd(["search", query])) }],
  })
);

loggedTool(
  "common_vsearch",
  "Vector semantic search on common knowledge. Slower (~5s) but finds conceptual matches.",
  { query: z.string().describe("Natural language question or concept") },
  async ({ query }) => ({
    content: [{ type: "text", text: maybeInjectCommonContext(await runCommonQmd(["vsearch", query])) }],
  })
);

loggedTool(
  "common_get",
  "Retrieve a specific note from common knowledge by path.",
  { path: z.string().describe("Note path relative to common brain root, e.g. knowledge/entities/aws/ec2/vm-orcl-11g.md") },
  async ({ path }) => ({
    content: [{ type: "text", text: maybeInjectCommonContext(await runCommonQmd(["get", path])) }],
  })
);

loggedTool(
  "common_write",
  "Create or update a note in common knowledge (shared brain). Validates frontmatter. Call common_commit when done with changes.",
  {
    path: z.string().describe("Note path relative to common brain root, e.g. knowledge/entities/my-note.md"),
    content: z.string().describe("Full markdown content including YAML frontmatter"),
    force: z.boolean().optional().describe("Skip validation warnings. Default false."),
  },
  async ({ path, content, force }) => {
    const pathErr = validateCommonPath(path);
    if (pathErr) {
      return { content: [{ type: "text", text: `Invalid path: ${pathErr}` }], isError: true };
    }

    const validation = commonBrain.validateNote(content);
    if (!validation.valid && !force) {
      return {
        content: [{
          type: "text",
          text: `Validation failed — fix these issues or set force=true:\n${validation.warnings.map((w) => `  - ${w}`).join("\n")}`,
        }],
        isError: true,
      };
    }

    commonBrain.writeNote(path, content);

    let warnings = "";
    if (validation.warnings.length > 0) {
      warnings = `\n\nWarnings (written anyway due to force=true):\n${validation.warnings.map((w) => `  - ${w}`).join("\n")}`;
    }

    let indexResult = "";
    try { indexResult = await runCommonQmd(["update"]); } catch { indexResult = "(index skipped)"; }

    return {
      content: [{
        type: "text",
        text: maybeInjectCommonContext(`Written to common: ${path} (${content.length} chars)${warnings}\n\nIndex: ${indexResult}\n\n💡 Call common_commit when you're done with changes to save them to git.`),
      }],
    };
  }
);

loggedTool(
  "common_list",
  "List notes in common knowledge filtered by folder, tag, or status.",
  {
    folder: z.string().optional().describe("Filter to notes in this folder, e.g. 'knowledge/entities'"),
    tag: z.string().optional().describe("Filter to notes with this tag, e.g. 'entity', 'status/active'"),
    limit: z.number().optional().describe("Max results. Default 50."),
  },
  async ({ folder, tag, limit }) => {
    const maxResults = limit ?? 50;
    const allPaths = commonBrain.getAllNotes();
    const results: string[] = [];

    for (const p of allPaths) {
      if (results.length >= maxResults) break;
      if (folder && !p.startsWith(folder)) continue;
      if (tag) {
        const note = commonBrain.loadNote(p);
        if (!note || !note.tags.some((t) => t === tag || t.startsWith(tag + "/"))) continue;
      }
      const note = commonBrain.loadNote(p);
      const title = note?.title ?? p;
      const tags = note?.tags.length ? ` [${note.tags.join(", ")}]` : "";
      results.push(`${p}  —  ${title}${tags}`);
    }

    if (results.length === 0) {
      return {
        content: [{ type: "text", text: maybeInjectCommonContext(`No common knowledge notes found${folder ? ` in ${folder}` : ""}${tag ? ` with tag '${tag}'` : ""}.`) }],
      };
    }
    return {
      content: [{ type: "text", text: maybeInjectCommonContext(`Found ${results.length} common note${results.length > 1 ? "s" : ""}:\n\n${results.join("\n")}`) }],
    };
  }
);

loggedTool(
  "common_commit",
  "Git commit all pending changes in the common knowledge brain. Identifies the committing agent. Call after common_write.",
  {
    message: z.string().describe("Commit message describing the changes"),
  },
  async ({ message }) => {
    let authorName: string;
    let authorEmail: string;

    if (SUBAGENT_ID) {
      const sa = getSubagentById(SUBAGENT_ID);
      authorName = sa?.name ?? SUBAGENT_ID;
      authorEmail = `sa-${SUBAGENT_ID}@workbot`;
    } else {
      authorName = "Workbot Host";
      authorEmail = "host@workbot";
    }

    try {
      const result = await commonGitCommit(message, authorName, authorEmail);
      if (result === "nothing to commit") {
        return { content: [{ type: "text", text: maybeInjectCommonContext("Nothing to commit — common knowledge is up to date.") }] };
      }
      const log = await commonGitLog(5);
      return { content: [{ type: "text", text: maybeInjectCommonContext(`Committed: ${result}\nAuthor: ${authorName} <${authorEmail}>\n\nRecent commits:\n${log}`) }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Commit failed: ${err.message}` }], isError: true };
    }
  }
);

// ── Host-only tools (hidden from subagents) ─────────────────────────────
// Agents, workflows, and subagent management tools are only available
// when running as the host workbot (no --subagent flag).

if (!SUBAGENT_ID) {

// ── common_move (host-only) ─────────────────────────────────────────────

loggedTool(
  "common_move",
  "Move a note from the private host brain to common knowledge. Leaves a redirect in the private brain. Auto-commits to common git.",
  {
    path: z.string().describe("Note path in the private brain, e.g. knowledge/entities/aws/ec2/vm-orcl-11g/cdpd/cdpd-schema-overview.md"),
    common_path: z.string().optional().describe("Destination path in common brain. Defaults to same path."),
    message: z.string().optional().describe("Git commit message. Defaults to 'Move {path} to common knowledge'."),
  },
  async ({ path, common_path, message }) => {
    const destPath = common_path ?? path;

    const pathErr = validateCommonPath(destPath);
    if (pathErr) {
      return { content: [{ type: "text", text: `Invalid destination path: ${pathErr}` }], isError: true };
    }

    // Read from private brain
    const note = scopedLoadNote(path);
    if (!note) {
      return { content: [{ type: "text", text: `Note not found in private brain: ${path}` }], isError: true };
    }

    // Write to common brain
    commonBrain.writeNote(destPath, note.content);

    // Write redirect note in private brain
    const redirect = `---
tags:
  - context
  - status/archived
moved_to: common/${destPath}
---

# Moved to Common Knowledge

This note has been moved to the common knowledge brain at \`${destPath}\`.

Use \`common_get\` to read it: \`common_get("${destPath}")\`

## Related

${note.content.match(/## Related[\s\S]*$/)?.[0]?.replace("## Related", "").trim() || ""}
`;
    scopedWriteNote(path, redirect);

    // Auto-commit
    const commitMsg = message ?? `Move ${path} to common knowledge`;
    try {
      const hash = await commonGitCommit(commitMsg, "Workbot Host", "host@workbot");
      let indexResult = "";
      try { indexResult = await runCommonQmd(["update"]); } catch { indexResult = "(index skipped)"; }
      return {
        content: [{
          type: "text",
          text: `Moved to common knowledge:\n  From: ${path}\n  To: common/${destPath}\n  Commit: ${hash}\n  Private brain: redirect note written\n\nIndex: ${indexResult}`,
        }],
      };
    } catch (err: any) {
      return {
        content: [{
          type: "text",
          text: `Note written to common but commit failed: ${err.message}\nCall common_commit manually.`,
        }],
      };
    }
  }
);

// ── Agents context tools ────────────────────────────────────────────────

function resolveAgentsPath(): string {
  const p = mcpConfig.agentsFilePath || "AGENTS.md";
  return isAbsolute(p) ? p : resolve(PROJECT_ROOT, p);
}

loggedTool(
  "agents_read",
  "Read the AGENTS.md file that provides context to cloud agents (Codex, Jules, etc.).",
  {},
  async () => {
    const filePath = resolveAgentsPath();
    if (!existsSync(filePath)) {
      return { content: [{ type: "text", text: `AGENTS.md not found at ${filePath}. Create it or update the path in dashboard settings.` }] };
    }
    const text = readFileSync(filePath, "utf-8");
    return { content: [{ type: "text", text }] };
  }
);

loggedTool(
  "agents_write",
  "Write updated content to AGENTS.md. Use this to sync brain context to cloud agents. Preserves the Agent Reports section unless explicitly overwriting.",
  { content: z.string().describe("Full markdown content to write to AGENTS.md") },
  async ({ content }) => {
    const filePath = resolveAgentsPath();
    writeFileSync(filePath, content, "utf-8");
    return { content: [{ type: "text", text: `AGENTS.md updated at ${filePath} (${content.length} chars)` }] };
  }
);

} // end host-only agents tools

// ── Shared tools (available to both host and subagents) ─────────────────

// ── Debug tool (temporary) ──────────────────────────────────────────────

loggedTool(
  "debug_env",
  "Debug: show MCP server environment info.",
  {},
  async () => {
    const info = {
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
      LOCALAPPDATA: process.env.LOCALAPPDATA,
      cwd: process.cwd(),
      nodePath: mcpConfig.nodePath,
      qmdPath: mcpConfig.qmdCliPath,
    };
    // Also run qmd status to see what index it finds
    let status = "";
    try {
      status = await runQmd(["status"]);
    } catch (e: any) {
      status = `Error: ${e.message}`;
    }
    return {
      content: [{ type: "text", text: JSON.stringify(info, null, 2) + "\n\n--- QMD Status ---\n" + status }],
    };
  }
);

// ── Git credentials helper ─────────────────────────────────────────────

loggedTool(
  "git_credentials",
  "Configure git to use a connected GitHub service instance for push/pull/clone. Sets up the credential helper so git commands authenticate automatically. Credentials are injected securely — the token is never printed or exposed.",
  {
    service: z.string().describe("GitHub service instance (e.g. 'github:workbot-wr'). Use service_status to see available instances."),
  },
  async ({ service }) => {
    const { serviceType } = parseInstanceId(service);
    if (serviceType !== "github") {
      return { content: [{ type: "text", text: "git_credentials only works with GitHub service instances." }], isError: true };
    }

    // Check subagent permissions
    if (SUBAGENT_ID) {
      const sa = getSubagentById(SUBAGENT_ID);
      const allowed = sa?.allowedServices ?? [];
      if (!isServiceAllowed(service, allowed)) {
        return { content: [{ type: "text", text: `Service "${service}" is not allowed for this subagent.` }], isError: true };
      }
    }

    const store = await loadStoreSecure();
    const saved = store[service];
    if (!saved) {
      return { content: [{ type: "text", text: `Service "${service}" is not connected.` }], isError: true };
    }

    // Configure git credential helper to use this token
    // Uses git credential-store with a temporary file that's cleaned up
    const credFile = `/tmp/.git-cred-${Date.now()}`;
    try {
      const { writeFileSync, chmodSync, unlinkSync } = await import("fs");
      writeFileSync(credFile, `https://x-access-token:${saved.token}@github.com\n`, { mode: 0o600 });

      await execFileAsync("git", ["config", "--global", "credential.helper", `store --file=${credFile}`], { timeout: 5000 });
      // Also set user info from the token if available
      try {
        const userRes = await fetch("https://api.github.com/user", {
          headers: { Authorization: `Bearer ${saved.token}`, Accept: "application/vnd.github.v3+json" },
        });
        if (userRes.ok) {
          const user = await userRes.json();
          if (user.login) await execFileAsync("git", ["config", "--global", "user.name", user.login], { timeout: 5000 });
          if (user.email || `${user.login}@users.noreply.github.com`) {
            await execFileAsync("git", ["config", "--global", "user.email", user.email || `${user.login}@users.noreply.github.com`], { timeout: 5000 });
          }
        }
      } catch { /* non-fatal */ }

      const name = saved._instanceName || service;
      return { content: [{ type: "text", text: `Git credentials configured for ${name} (${saved.user}). You can now use git clone, git push, git pull etc. with GitHub repos this token has access to.` }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Failed to configure git credentials: ${err.message}` }], isError: true };
    }
  }
);

// ── Service context tools ──────────────────────────────────────────────

loggedTool(
  "service_context_set",
  "Link a brain note to a service as persistent context. The note's content will be included whenever service_request is called for that service. Use this for things like signature preferences, formatting rules, or persona instructions.",
  {
    service: z.string().describe("Service key (e.g. 'outlook', 'github')"),
    path: z.string().describe("Brain note path to link (e.g. 'knowledge/entities/email-signature.md')"),
  },
  async ({ service, path }) => {
    addServiceContext(service, path);
    const all = getServiceContext(service);
    return { content: [{ type: "text", text: `Linked "${path}" to ${service}. Context notes (${all.length}): ${all.join(", ")}` }] };
  }
);

loggedTool(
  "service_context_remove",
  "Unlink a brain note from a service's context.",
  {
    service: z.string().describe("Service key"),
    path: z.string().describe("Brain note path to unlink"),
  },
  async ({ service, path }) => {
    removeServiceContext(service, path);
    const remaining = getServiceContext(service);
    return { content: [{ type: "text", text: `Unlinked "${path}" from ${service}. Remaining: ${remaining.length > 0 ? remaining.join(", ") : "none"}` }] };
  }
);

loggedTool(
  "service_context_list",
  "List all service context links — which brain notes are attached to which services.",
  {},
  async () => {
    const all = loadServiceContexts();
    const entries = Object.entries(all);
    if (entries.length === 0) {
      return { content: [{ type: "text", text: "No service contexts configured. Use service_context_set to link brain notes to services." }] };
    }
    const lines = entries.map(([svc, paths]) => `${svc}: ${paths.join(", ")}`);
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// ── Service tools ───────────────────────────────────────────────────────

loggedTool(
  "service_status",
  "List all workbot services and their connection status.",
  {},
  async () => {
    if (!SUBAGENT_ID && isStoreEncrypted() && !readActiveKey()) {
      return {
        content: [{ type: "text", text: "Dashboard session required — log into the workbot dashboard to unlock service credentials." }],
        isError: true,
      };
    }
    const store = await loadStoreSecure();
    const sa = SUBAGENT_ID ? getSubagentById(SUBAGENT_ID) : null;
    // Subagent mode: if subagent not found, default to empty (no access) — never fall through to all services
    const allowedList = SUBAGENT_ID ? (sa?.allowedServices ?? []) : null;
    console.error(`[mcp:service_status] SUBAGENT_ID=${SUBAGENT_ID}, sa=${!!sa}, allowedList=${JSON.stringify(allowedList)}, storeKeys=${Object.keys(store).join(",")}`);
    const lines: string[] = [];
    const seenTypes = new Set<string>();

    // Show all connected instances
    for (const [key, saved] of Object.entries(store)) {
      const { serviceType } = parseInstanceId(key);
      if (!SERVICES[serviceType]) continue;
      // Subagent mode: filter by allowed services
      if (allowedList && !isServiceAllowed(key, allowedList)) continue;
      seenTypes.add(serviceType);
      const name = saved._instanceName || SERVICES[serviceType].name;
      const kind = SERVICES[serviceType].kind === "connection" ? " [connection]" : "";
      lines.push(`${name} (${key}): connected${kind} — ${saved.user}`);
    }

    // Show disconnected types (host mode only)
    if (!SUBAGENT_ID) {
      for (const [key, config] of Object.entries(SERVICES)) {
        if (!seenTypes.has(key)) {
          const kind = config.kind === "connection" ? " [connection]" : "";
          lines.push(`${config.name} (${key}): disconnected${kind}`);
        }
      }
    }

    return { content: [{ type: "text", text: lines.length > 0 ? lines.join("\n") : "No services available." }] };
  }
);

loggedTool(
  "service_request",
  "Make an authenticated HTTP request to a connected service. The workbot injects the correct auth headers automatically. For Azure AD services (Entra, Intune, Security, SharePoint, Outlook), token exchange is handled transparently.",
  {
    service: z
      .string()
      .describe(
        "Service key (e.g. github, airtable, outlook). Use service_status to see available keys."
      ),
    method: z
      .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
      .describe("HTTP method"),
    url: z.string().describe("Full API URL (e.g. https://api.github.com/user/repos)"),
    body: z
      .string()
      .optional()
      .describe("Request body as JSON string (for POST/PUT/PATCH)"),
    headers: z
      .record(z.string())
      .optional()
      .describe("Additional headers to merge (e.g. Accept, Content-Type)"),
  },
  async ({ service, method, url, body, headers: extraHeaders }) => {
    if (!SUBAGENT_ID && isStoreEncrypted() && !readActiveKey()) {
      return {
        content: [{ type: "text", text: "Dashboard session required — log into the workbot dashboard to unlock service credentials." }],
        isError: true,
      };
    }

    // Parse instance ID to get service type
    const { serviceType } = parseInstanceId(service);

    // Subagent mode: reject requests to services not in the allowed list
    if (SUBAGENT_ID) {
      const sa = getSubagentById(SUBAGENT_ID);
      const allowed = sa?.allowedServices ?? []; // default to empty = no access
      if (!isServiceAllowed(service, allowed)) {
        return {
          content: [{ type: "text", text: `Service "${service}" is not allowed for this subagent. Allowed: ${allowed.join(", ") || "none"}` }],
          isError: true,
        };
      }
    }

    const config = SERVICES[serviceType];
    if (!config) {
      return {
        content: [{ type: "text", text: `Unknown service type: ${serviceType}. Use service_status to see available keys.` }],
        isError: true,
      };
    }

    if (config.kind === "connection") {
      return {
        content: [{ type: "text", text: `"${serviceType}" is a connection service (${config.protocol}) — use service_execute instead of service_request.` }],
        isError: true,
      };
    }

    const store = await loadStoreSecure();
    // Look up by full instance ID first, fall back to bare type
    const saved = store[service] ?? (service === serviceType ? undefined : store[serviceType]);
    if (!saved) {
      return {
        content: [{ type: "text", text: `Service "${service}" is not connected. Connect it via the dashboard first.` }],
        isError: true,
      };
    }

    try {
      let token = saved.token;
      if (config.preConnect && saved.extras) {
        const result = await config.preConnect(saved.token, saved.extras);
        token = result.resolvedToken;
      }

      const authHeaders = config.authHeader(token, saved.extras);
      const mergedHeaders: Record<string, string> = {
        ...authHeaders,
        ...(extraHeaders ?? {}),
      };

      if (body && !mergedHeaders["Content-Type"]) {
        mergedHeaders["Content-Type"] = "application/json";
      }

      const response = await fetch(url, {
        method,
        headers: mergedHeaders,
        ...(body ? { body } : {}),
      });

      const responseText = await response.text();

      let formattedResponse: string;
      try {
        const json = JSON.parse(responseText);
        formattedResponse = JSON.stringify(json, null, 2);
      } catch {
        formattedResponse = responseText;
      }

      const statusLine = `${response.status} ${response.statusText}`;

      // Include linked service context once per session per service
      let contextBlock = "";
      if (!contextDelivered.has(service)) {
        const context = resolveServiceContext(service);
        if (context) {
          contextBlock = `\n\n--- Service Context (first use) ---\n${context}\n--- End Context ---`;
          contextDelivered.add(service);
        }
      }

      return {
        content: [
          {
            type: "text",
            text: `${statusLine}\n\n${formattedResponse}${contextBlock}`,
          },
        ],
        isError: response.status >= 400,
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Request failed: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// ── Connection service execution ──────────────────────────────────────

loggedTool(
  "service_execute",
  "Execute a command or query against a connection-based service (database, SSH, SFTP, FTP, Telnet). Use service_status to see available connection services.",
  {
    service: z
      .string()
      .describe(
        "Service instance key (e.g. 'postgresql:prod-db', 'ssh:web-server'). Use service_status to see available keys."
      ),
    command: z
      .string()
      .describe(
        "The command or query to execute. For databases: SQL query. For SSH: shell command. For SFTP/FTP: command like 'ls /path' or 'get /remote/file'. For Telnet: raw command."
      ),
  },
  async ({ service, command }) => {
    if (!SUBAGENT_ID && isStoreEncrypted() && !readActiveKey()) {
      return {
        content: [{ type: "text", text: "Dashboard session required — log into the workbot dashboard to unlock service credentials." }],
        isError: true,
      };
    }

    const { serviceType } = parseInstanceId(service);

    // Subagent mode: reject requests to services not in the allowed list
    if (SUBAGENT_ID) {
      const sa = getSubagentById(SUBAGENT_ID);
      const allowed = sa?.allowedServices ?? [];
      if (!isServiceAllowed(service, allowed)) {
        return {
          content: [{ type: "text", text: `Service "${service}" is not allowed for this subagent. Allowed: ${allowed.join(", ") || "none"}` }],
          isError: true,
        };
      }
    }

    const config = SERVICES[serviceType];
    if (!config) {
      return {
        content: [{ type: "text", text: `Unknown service type: ${serviceType}. Use service_status to see available keys.` }],
        isError: true,
      };
    }

    if (config.kind !== "connection") {
      return {
        content: [{ type: "text", text: `"${serviceType}" is a REST API service — use service_request instead of service_execute.` }],
        isError: true,
      };
    }

    const store = await loadStoreSecure();
    const saved = store[service] ?? (service === serviceType ? undefined : store[serviceType]);
    if (!saved) {
      return {
        content: [{ type: "text", text: `Service "${service}" is not connected. Connect it via the dashboard first.` }],
        isError: true,
      };
    }

    try {
      const allParams: Record<string, string> = { ...saved.extras, password: saved.token };
      const result = await config.execute(allParams, command);

      // Include linked service context once per session per service
      let contextBlock = "";
      if (!contextDelivered.has(service)) {
        const context = resolveServiceContext(service);
        if (context) {
          contextBlock = `\n\n--- Service Context (first use) ---\n${context}\n--- End Context ---`;
          contextDelivered.add(service);
        }
      }

      return {
        content: [{ type: "text", text: result + contextBlock }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Execution failed: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Also update service_request to reject connection services with helpful message
// (handled inline — connection services lack authHeader/validateUrl so would error anyway)

// ── Workflow tools (available to both host and subagents) ─────────────
// Subagents get their own scoped workflows via the scope parameter.

// ── Workflow tools ────────────────────────────────────────────────────

const workflowEngine = new WorkflowEngine();
workflowEngine.start();

loggedTool(
  "workflow_list",
  "List all workflows with their status and last run info.",
  {},
  async () => {
    const workflows = loadWorkflows();
    const runs = loadRuns({ limit: 100 });
    const lines: string[] = [];
    for (const wf of workflows) {
      const lastRun = runs.find((r) => r.workflowId === wf.id);
      const schedule = wf.schedule?.cron ? ` [cron: ${wf.schedule.cron}]` : "";
      const status = lastRun ? ` (last: ${lastRun.status} at ${lastRun.startedAt})` : "";
      lines.push(`${wf.enabled ? "+" : "-"} ${wf.name} (${wf.id})${schedule}${status}`);
    }
    return {
      content: [{ type: "text", text: lines.length > 0 ? lines.join("\n") : "No workflows defined." }],
    };
  }
);

loggedTool(
  "workflow_run",
  "Trigger a workflow by ID. Returns the run ID for status tracking.",
  {
    workflowId: z.string().describe("Workflow ID to trigger"),
    triggerData: z.string().optional().describe("Optional JSON trigger data"),
  },
  async ({ workflowId, triggerData }) => {
    try {
      const data = triggerData ? JSON.parse(triggerData) : undefined;
      const run = workflowEngine.executeWorkflow(workflowId, "mcp", data);
      return {
        content: [{ type: "text", text: `Started run ${run.runId} for workflow "${workflowId}".\nStatus: ${run.status}` }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Failed to run workflow: ${err.message}` }],
        isError: true,
      };
    }
  }
);

loggedTool(
  "workflow_status",
  "Get the status of a workflow run. If no runId, shows the latest run.",
  {
    workflowId: z.string().describe("Workflow ID"),
    runId: z.string().optional().describe("Specific run ID. If omitted, shows latest."),
  },
  async ({ workflowId, runId }) => {
    let run;
    if (runId) {
      run = workflowEngine.getActiveRun(runId) ?? getRun(runId);
    } else {
      const runs = loadRuns({ workflowId, limit: 1 });
      run = runs[0] ? (workflowEngine.getActiveRun(runs[0].runId) ?? runs[0]) : null;
    }

    if (!run) {
      return { content: [{ type: "text", text: `No runs found for workflow "${workflowId}".` }] };
    }

    const lines = [
      `Run: ${run.runId}`,
      `Status: ${run.status}`,
      `Trigger: ${run.trigger}`,
      `Started: ${run.startedAt}`,
      run.completedAt ? `Completed: ${run.completedAt}` : "",
      "",
      "Nodes:",
    ];
    for (const [nodeId, nr] of Object.entries(run.nodeResults)) {
      const dur = nr.durationMs ? ` (${nr.durationMs}ms)` : "";
      const err = nr.error ? ` — ${nr.error.slice(0, 100)}` : "";
      lines.push(`  ${nr.status === "completed" ? "+" : nr.status === "failed" ? "x" : nr.status === "running" ? "~" : "-"} ${nodeId}: ${nr.status}${dur}${err}`);
    }

    return { content: [{ type: "text", text: lines.filter(Boolean).join("\n") }] };
  }
);

loggedTool(
  "workflow_create",
  "Create a new workflow DAG. Provide nodes (tasks) and edges (dependencies) to define the execution graph.",
  {
    name: z.string().describe("Workflow name (used as ID, kebab-cased)"),
    description: z.string().optional().describe("What this workflow does"),
    schedule: z.string().optional().describe("Cron expression for scheduling, e.g. '0 9 * * 1-5'"),
    nodes: z.string().describe("JSON array of task nodes. Each node: {id, label, type: 'shell'|'python'|'mcp_tool'|'claude_prompt', config: {...}}. Shell config: {command}. Python config: {script, requirements?}. MCP config: {tool, args}. Claude config: {prompt, useProjectContext?}. Use {{nodeId.output}} for templates."),
    edges: z.string().optional().describe("JSON array of edges. Each edge: {from, to, condition?: 'success'|'failure'|'always'}. Default condition is 'success'."),
  },
  async ({ name, description, schedule, nodes: nodesJson, edges: edgesJson }) => {
    try {
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || randomUUID().slice(0, 8);
      if (getWorkflow(id)) {
        return { content: [{ type: "text", text: `Workflow "${id}" already exists. Use workflow_update to modify it.` }], isError: true };
      }

      const nodes = JSON.parse(nodesJson);
      const edges = edgesJson ? JSON.parse(edgesJson) : [];
      const now = new Date().toISOString();

      const wf: WorkflowDefinition = {
        id, name, description: description ?? "", enabled: false,
        createdAt: now, updatedAt: now,
        ...(schedule ? { schedule: { cron: schedule } } : {}),
        nodes, edges,
      };

      upsertWorkflow(wf);
      workflowEngine.reload();

      return {
        content: [{ type: "text", text: `Created workflow "${id}" with ${nodes.length} nodes and ${edges.length} edges.\nEnable it with workflow_update or run it with workflow_run.` }],
      };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Failed to create workflow: ${err.message}` }], isError: true };
    }
  }
);

loggedTool(
  "workflow_update",
  "Update an existing workflow. Only provide the fields you want to change.",
  {
    workflowId: z.string().describe("Workflow ID to update"),
    name: z.string().optional().describe("New name"),
    description: z.string().optional().describe("New description"),
    enabled: z.boolean().optional().describe("Enable or disable the workflow"),
    schedule: z.string().optional().describe("New cron expression, or empty string to remove schedule"),
    nodes: z.string().optional().describe("JSON array of nodes (replaces all nodes)"),
    edges: z.string().optional().describe("JSON array of edges (replaces all edges)"),
  },
  async ({ workflowId, name, description, enabled, schedule, nodes: nodesJson, edges: edgesJson }) => {
    const existing = getWorkflow(workflowId);
    if (!existing) {
      return { content: [{ type: "text", text: `Workflow "${workflowId}" not found.` }], isError: true };
    }

    try {
      const updated: WorkflowDefinition = {
        ...existing,
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(enabled !== undefined ? { enabled } : {}),
        ...(schedule !== undefined ? { schedule: schedule ? { cron: schedule } : undefined } : {}),
        ...(nodesJson !== undefined ? { nodes: JSON.parse(nodesJson) } : {}),
        ...(edgesJson !== undefined ? { edges: JSON.parse(edgesJson) } : {}),
        updatedAt: new Date().toISOString(),
      };

      upsertWorkflow(updated);
      workflowEngine.reload();

      return {
        content: [{ type: "text", text: `Updated workflow "${workflowId}". Enabled: ${updated.enabled}, ${updated.nodes.length} nodes, ${updated.edges.length} edges.` }],
      };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Failed to update workflow: ${err.message}` }], isError: true };
    }
  }
);

loggedTool(
  "workflow_delete",
  "Delete a workflow by ID.",
  {
    workflowId: z.string().describe("Workflow ID to delete"),
  },
  async ({ workflowId }) => {
    if (!removeWorkflow(workflowId)) {
      return { content: [{ type: "text", text: `Workflow "${workflowId}" not found.` }], isError: true };
    }
    workflowEngine.reload();
    return { content: [{ type: "text", text: `Deleted workflow "${workflowId}".` }] };
  }
);

// ── Subagent management tools (host-only) ────────────────────────────
if (!SUBAGENT_ID) {

loggedTool(
  "subagent_list",
  "List all subagents with their names, allowed services, and status.",
  {},
  async () => {
    const subagents = loadSubagents();
    if (subagents.length === 0) return { content: [{ type: "text", text: "No subagents defined." }] };
    const lines = subagents.map((s) => {
      const services = s.allowedServices.length > 0 ? s.allowedServices.join(", ") : "none";
      return `${s.enabled ? "+" : "-"} ${s.name} (${s.id}) — services: [${services}] — ${s.claudeAuth.mode}`;
    });
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

loggedTool(
  "subagent_create",
  "Create a new subagent with its own isolated brain. Returns the created definition.",
  {
    name: z.string().describe("Subagent name (e.g. 'Email Handler')"),
    description: z.string().optional().describe("What this subagent does"),
    allowedServices: z.string().optional().describe("JSON array of service keys this subagent can access, e.g. '[\"outlook\",\"github\"]'"),
  },
  async ({ name, description, allowedServices: servicesJson }) => {
    try {
      const services = servicesJson ? JSON.parse(servicesJson) : [];
      const s = createSubagentDef({ name, description, allowedServices: services });
      return { content: [{ type: "text", text: `Created subagent "${s.id}" with brain at workbot-brain/${s.brainPath}/\nAllowed services: ${s.allowedServices.join(", ") || "none"}` }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Failed: ${err.message}` }], isError: true };
    }
  }
);

loggedTool(
  "subagent_update",
  "Update a subagent's configuration.",
  {
    subagentId: z.string().describe("Subagent ID"),
    name: z.string().optional(),
    description: z.string().optional(),
    enabled: z.boolean().optional(),
    allowedServices: z.string().optional().describe("JSON array of service keys"),
  },
  async ({ subagentId, name, description, enabled, allowedServices: servicesJson }) => {
    try {
      const updates: any = {};
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (enabled !== undefined) updates.enabled = enabled;
      if (servicesJson !== undefined) updates.allowedServices = JSON.parse(servicesJson);
      const s = updateSubagentDef(subagentId, updates);
      return { content: [{ type: "text", text: `Updated subagent "${s.id}". Enabled: ${s.enabled}, services: [${s.allowedServices.join(", ")}]` }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Failed: ${err.message}` }], isError: true };
    }
  }
);

loggedTool(
  "subagent_delete",
  "Delete a subagent. Optionally deletes its brain directory.",
  {
    subagentId: z.string().describe("Subagent ID"),
    deleteBrain: z.boolean().optional().describe("Also delete the brain directory (default: false)"),
  },
  async ({ subagentId, deleteBrain }) => {
    if (!deleteSubagentDef(subagentId, deleteBrain)) {
      return { content: [{ type: "text", text: `Subagent "${subagentId}" not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: `Deleted subagent "${subagentId}".${deleteBrain ? " Brain directory removed." : ""}` }] };
  }
);

} // end host-only tools block

// ── Start ───────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
