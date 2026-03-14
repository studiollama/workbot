import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, isAbsolute } from "path";
import { SERVICES, loadStore, PROJECT_ROOT } from "./services.js";
import { loadMcpConfig } from "./mcp-config.js";

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
    const { stdout, stderr } = await execFileAsync(
      nodePath,
      [qmdPath, ...args],
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
