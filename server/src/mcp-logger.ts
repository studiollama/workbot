import {
  existsSync,
  readFileSync,
  appendFileSync,
  renameSync,
  statSync,
  mkdirSync,
} from "fs";
import { join } from "path";
import { STORE_DIR } from "./paths.js";

const LOG_DIR = join(STORE_DIR, "logs");
const LOG_PATH = join(LOG_DIR, "mcp-tools.jsonl");
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export interface LogEntry {
  timestamp: string;
  tool: string;
  args: Record<string, unknown>;
  duration_ms?: number;
}

function summarizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string") {
      const maxLen = k === "content" ? 50 : 100;
      summary[k] = v.length > maxLen ? v.slice(0, maxLen) + "..." : v;
    } else {
      summary[k] = v;
    }
  }
  return summary;
}

export function logToolCall(
  tool: string,
  args: Record<string, unknown>,
  durationMs?: number
): void {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  // Auto-rotate
  try {
    if (existsSync(LOG_PATH) && statSync(LOG_PATH).size > MAX_SIZE) {
      renameSync(LOG_PATH, LOG_PATH + ".1");
    }
  } catch {
    // Ignore rotation errors
  }

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    tool,
    args: summarizeArgs(args),
    ...(durationMs !== undefined ? { duration_ms: durationMs } : {}),
  };

  appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
}

export function readLogs(opts?: {
  limit?: number;
  offset?: number;
  tool?: string;
}): { entries: LogEntry[]; total: number } {
  if (!existsSync(LOG_PATH)) return { entries: [], total: 0 };

  const limit = opts?.limit ?? 100;
  const offset = opts?.offset ?? 0;
  const toolFilter = opts?.tool;

  const lines = readFileSync(LOG_PATH, "utf-8")
    .split("\n")
    .filter((l) => l.trim());

  // Parse all lines (newest first)
  let entries: LogEntry[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry: LogEntry = JSON.parse(lines[i]);
      if (toolFilter && entry.tool !== toolFilter) continue;
      entries.push(entry);
    } catch {
      // Skip malformed lines
    }
  }

  const total = entries.length;
  entries = entries.slice(offset, offset + limit);

  return { entries, total };
}
