import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { readFileSync, writeFileSync, existsSync, statSync } from "fs";
import { resolve, isAbsolute, join } from "path";
import { SERVICES, loadStore, PROJECT_ROOT } from "./services.js";
import { loadMcpConfig } from "./mcp-config.js";
import {
  BRAIN_ROOT,
  getAllNotes,
  loadNote,
  buildLinkGraph,
  validateNote,
  writeNote,
} from "./brain-utils.js";

const execFileAsync = promisify(execFile);
const mcpConfig = loadMcpConfig();

const server = new McpServer({
  name: "workbot",
  version: "0.1.0",
});

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

server.tool(
  "brain_search",
  "BM25 keyword search on the workbot brain (Obsidian vault). Fast, use this first.",
  { query: z.string().describe("Search keywords") },
  async ({ query }) => {
    const text = await runQmd(["search", query]);
    return { content: [{ type: "text", text }] };
  }
);

server.tool(
  "brain_vsearch",
  "Vector semantic search on the workbot brain. Slower (~5s) but finds conceptual matches. Use when keyword search misses.",
  { query: z.string().describe("Natural language question") },
  async ({ query }) => {
    const text = await runQmd(["vsearch", query]);
    return { content: [{ type: "text", text }] };
  }
);

server.tool(
  "brain_get",
  "Retrieve a specific note from the workbot brain by path.",
  { path: z.string().describe("Note path relative to vault root, e.g. knowledge/decisions/some-note.md") },
  async ({ path }) => {
    const text = await runQmd(["get", path]);
    return { content: [{ type: "text", text }] };
  }
);

server.tool(
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

server.tool(
  "brain_write",
  "Create or update a note in the workbot brain. Validates frontmatter (requires type + status tags) and checks for wikilinks. Auto re-indexes after writing.",
  {
    path: z.string().describe("Note path relative to vault root, e.g. knowledge/decisions/my-decision.md"),
    content: z.string().describe("Full markdown content including YAML frontmatter"),
    force: z.boolean().optional().describe("Skip validation warnings and write anyway. Default false."),
  },
  async ({ path, content, force }) => {
    const validation = validateNote(content);

    if (!validation.valid && !force) {
      return {
        content: [{
          type: "text",
          text: `Validation failed — fix these issues or set force=true:\n${validation.warnings.map((w) => `  - ${w}`).join("\n")}`,
        }],
        isError: true,
      };
    }

    writeNote(path, content);

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

server.tool(
  "brain_links",
  "Show the link graph for a brain note — what it links to (outgoing) and what links to it (incoming). Useful for tracing decision chains and finding related knowledge.",
  {
    path: z.string().describe("Note path relative to vault root, e.g. knowledge/decisions/my-decision.md"),
  },
  async ({ path }) => {
    const graph = buildLinkGraph();
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

server.tool(
  "brain_list",
  "List brain notes filtered by folder, tag, or status. Returns paths and titles. Use to browse the brain without needing to search.",
  {
    folder: z.string().optional().describe("Filter to notes in this folder, e.g. 'knowledge/decisions'"),
    tag: z.string().optional().describe("Filter to notes with this tag, e.g. 'decision', 'status/active', 'domain/ui'"),
    limit: z.number().optional().describe("Max results to return. Default 50."),
  },
  async ({ folder, tag, limit }) => {
    const maxResults = limit ?? 50;
    const allPaths = getAllNotes();
    const results: string[] = [];

    for (const p of allPaths) {
      if (results.length >= maxResults) break;

      // Folder filter
      if (folder && !p.startsWith(folder)) continue;

      // Tag filter
      if (tag) {
        const note = loadNote(p);
        if (!note || !note.tags.some((t) => t === tag || t.startsWith(tag + "/"))) continue;
      }

      const note = loadNote(p);
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

server.tool(
  "brain_recent",
  "Show recently modified brain notes. Useful for session handoffs — see what changed since the last conversation.",
  {
    hours: z.number().optional().describe("Show notes modified within this many hours. Default 24."),
    limit: z.number().optional().describe("Max results. Default 20."),
  },
  async ({ hours, limit }) => {
    const cutoff = Date.now() - (hours ?? 24) * 60 * 60 * 1000;
    const maxResults = limit ?? 20;
    const allPaths = getAllNotes();

    const recent: { path: string; mtime: Date; title: string }[] = [];
    for (const p of allPaths) {
      const note = loadNote(p);
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

server.tool(
  "brain_orphans",
  "Find brain notes with no incoming or outgoing wikilinks. These violate the 'no orphan notes' rule and need to be linked.",
  {},
  async () => {
    const graph = buildLinkGraph();
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

server.tool(
  "brain_context",
  "Smart session bootstrap. Loads ACTIVE.md + recent corrections + all notes tagged #status/active + recently modified notes. One call to get full session context instead of multiple reads.",
  {
    hours: z.number().optional().describe("Include notes modified within this many hours. Default 48."),
  },
  async ({ hours }) => {
    const sections: string[] = [];

    // 1. ACTIVE.md
    const activePath = join(BRAIN_ROOT, "context", "ACTIVE.md");
    if (existsSync(activePath)) {
      const active = readFileSync(activePath, "utf-8");
      sections.push(`## ACTIVE.md\n\n${active}`);
    } else {
      sections.push("## ACTIVE.md\n\n(not found)");
    }

    // 2. Recent corrections
    const correctionsPath = join(BRAIN_ROOT, "context", "CORRECTIONS.md");
    if (existsSync(correctionsPath)) {
      const corrections = readFileSync(correctionsPath, "utf-8");
      sections.push(`## Recent Corrections\n\n${corrections}`);
    }

    // 3. All notes tagged #status/active (excluding context/ files already loaded)
    const allPaths = getAllNotes();
    const activeNotes: string[] = [];
    for (const p of allPaths) {
      if (p.startsWith("context/")) continue;
      if (p.startsWith("_")) continue;
      const note = loadNote(p);
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
      const note = loadNote(p);
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

// ── Agents context tools ────────────────────────────────────────────────

function resolveAgentsPath(): string {
  const p = mcpConfig.agentsFilePath || "AGENTS.md";
  return isAbsolute(p) ? p : resolve(PROJECT_ROOT, p);
}

server.tool(
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

server.tool(
  "agents_write",
  "Write updated content to AGENTS.md. Use this to sync brain context to cloud agents. Preserves the Agent Reports section unless explicitly overwriting.",
  { content: z.string().describe("Full markdown content to write to AGENTS.md") },
  async ({ content }) => {
    const filePath = resolveAgentsPath();
    writeFileSync(filePath, content, "utf-8");
    return { content: [{ type: "text", text: `AGENTS.md updated at ${filePath} (${content.length} chars)` }] };
  }
);

// ── Debug tool (temporary) ──────────────────────────────────────────────

server.tool(
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

// ── Service tools ───────────────────────────────────────────────────────

server.tool(
  "service_status",
  "List all workbot services and their connection status.",
  {},
  async () => {
    const store = loadStore();
    const lines: string[] = [];
    for (const [key, config] of Object.entries(SERVICES)) {
      const saved = store[key];
      if (saved) {
        lines.push(`${config.name} (${key}): connected — ${saved.user}`);
      } else {
        lines.push(`${config.name} (${key}): disconnected`);
      }
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

server.tool(
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
    const config = SERVICES[service];
    if (!config) {
      return {
        content: [{ type: "text", text: `Unknown service: ${service}. Use service_status to see available keys.` }],
        isError: true,
      };
    }

    const store = loadStore();
    const saved = store[service];
    if (!saved) {
      return {
        content: [{ type: "text", text: `Service "${config.name}" is not connected. Connect it via the dashboard first.` }],
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
      return {
        content: [
          {
            type: "text",
            text: `${statusLine}\n\n${formattedResponse}`,
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

// ── Start ───────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
