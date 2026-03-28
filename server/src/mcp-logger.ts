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

// Keys whose values should always be fully redacted
const REDACT_KEYS = new Set([
  "token", "password", "secret", "key", "apiKey", "api_key",
  "client_secret", "refresh_token", "access_token", "authorization",
]);

// Patterns that indicate a value is a secret (even if the key name is generic)
const SECRET_PATTERNS = [
  /^ghp_/,          // GitHub PAT
  /^gho_/,          // GitHub OAuth
  /^github_pat_/,   // GitHub fine-grained PAT
  /^sk[-_]/,        // Stripe, OpenAI, etc.
  /^pk[-_]/,        // Stripe publishable
  /^pat[A-Za-z0-9]/, // Airtable PAT
  /^xox[bpas]-/,    // Slack tokens
  /^AIza/,          // Google API keys
  /^ya29\./,        // Google OAuth access tokens
  /^Bearer /i,      // Auth headers
  /^Basic /i,       // Auth headers
  /^GOCSPX-/,       // Google OAuth client secrets
  /^rnd_/,          // Render API keys
  /^sbp_/,          // Supabase keys
];

export interface LogEntry {
  timestamp: string;
  tool: string;
  args: Record<string, unknown>;
  duration_ms?: number;
}

function looksLikeSecret(value: string): boolean {
  return SECRET_PATTERNS.some((p) => p.test(value));
}

function redactValue(key: string, value: unknown): unknown {
  if (typeof value === "string") {
    // Redact by key name
    if (REDACT_KEYS.has(key.toLowerCase())) {
      return "[REDACTED]";
    }
    // Redact by value pattern
    if (looksLikeSecret(value)) {
      return "[REDACTED]";
    }
    // Truncate long strings (content, body, etc.)
    const maxLen = key === "content" ? 50 : 100;
    return value.length > maxLen ? value.slice(0, maxLen) + "..." : value;
  }
  if (typeof value === "object" && value !== null) {
    return redactObject(value as Record<string, unknown>);
  }
  return value;
}

function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = redactValue(k, v);
  }
  return result;
}

function summarizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  return redactObject(args);
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
