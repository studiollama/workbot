import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { STORE_DIR } from "./services.js";

const MCP_CONFIG_PATH = join(STORE_DIR, "mcp.json");

export interface McpConfig {
  qmdCliPath: string | null;
  qmdIndex: string | null;
  nodePath: string;
  agentsFilePath: string;
  claudeMdPath: string;
  serverPort: number;
  clientPort: number;
}

const DEFAULTS: McpConfig = {
  qmdCliPath: null,
  qmdIndex: null,
  nodePath: process.execPath.replace(/\\/g, "/"),
  agentsFilePath: "AGENTS.md",
  claudeMdPath: "CLAUDE.md",
  serverPort: 3001,
  clientPort: 5173,
};

export function loadMcpConfig(): McpConfig {
  try {
    if (!existsSync(MCP_CONFIG_PATH)) return { ...DEFAULTS };
    const raw = JSON.parse(readFileSync(MCP_CONFIG_PATH, "utf-8"));
    return {
      qmdCliPath: typeof raw.qmdCliPath === "string" ? raw.qmdCliPath : null,
      qmdIndex: typeof raw.qmdIndex === "string" ? raw.qmdIndex : null,
      nodePath: typeof raw.nodePath === "string" ? raw.nodePath : DEFAULTS.nodePath,
      agentsFilePath: typeof raw.agentsFilePath === "string" ? raw.agentsFilePath : DEFAULTS.agentsFilePath,
      claudeMdPath: typeof raw.claudeMdPath === "string" ? raw.claudeMdPath : DEFAULTS.claudeMdPath,
      serverPort: typeof raw.serverPort === "number" ? raw.serverPort : DEFAULTS.serverPort,
      clientPort: typeof raw.clientPort === "number" ? raw.clientPort : DEFAULTS.clientPort,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveMcpConfig(config: Partial<McpConfig>) {
  const current = loadMcpConfig();
  const merged = { ...current, ...config };
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
  writeFileSync(MCP_CONFIG_PATH, JSON.stringify(merged, null, 2));
}

export const MCP_TOOLS = [
  { name: "brain_search", description: "BM25 keyword search on the workbot brain (Obsidian vault). Fast, use first." },
  { name: "brain_vsearch", description: "Vector semantic search on the brain. Slower (~5s) but finds conceptual matches." },
  { name: "brain_get", description: "Retrieve a specific note from the brain by path." },
  { name: "brain_write", description: "Create or update a brain note. Validates frontmatter and wikilinks, auto re-indexes." },
  { name: "brain_update", description: "Re-index the brain after adding/editing notes. Optionally re-embed vectors." },
  { name: "brain_links", description: "Show incoming and outgoing wikilinks for a note. Trace decision chains and relationships." },
  { name: "brain_list", description: "List notes filtered by folder, tag, or status. Browse the brain without searching." },
  { name: "brain_recent", description: "Show recently modified notes. See what changed since the last conversation." },
  { name: "brain_orphans", description: "Find notes with missing links. Enforce the 'no orphan notes' graph health rule." },
  { name: "brain_context", description: "Smart session bootstrap. Loads ACTIVE.md + corrections + active notes + recent changes in one call." },
  { name: "agents_read", description: "Read the AGENTS.md context file shared with cloud agents." },
  { name: "agents_write", description: "Write updated context to AGENTS.md for cloud agents." },
  { name: "service_status", description: "List all workbot services and their connection status." },
  { name: "service_request", description: "Make an authenticated HTTP request to any connected service." },
];
