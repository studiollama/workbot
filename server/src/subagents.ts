import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from "fs";
import { join } from "path";
import { STORE_DIR } from "./paths.js";
import { BRAIN_ROOT } from "./brain-utils.js";

const SUBAGENTS_PATH = join(STORE_DIR, "subagents.json");

// ── Types ──────────────────────────────────────────────────────────────

export interface SubagentDefinition {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  allowedServices: string[];
  brainPath: string; // relative to BRAIN_ROOT, always "subagents/{id}"
  qmdIndex: string | null; // path to .workbot/qmd-indexes/{id}/
  claudeAuth: {
    mode: "host-spawned" | "oauth";
  };
  systemPromptPath?: string;
}

// ── CRUD ───────────────────────────────────────────────────────────────

export function loadSubagents(): SubagentDefinition[] {
  try {
    if (!existsSync(SUBAGENTS_PATH)) return [];
    return JSON.parse(readFileSync(SUBAGENTS_PATH, "utf-8"));
  } catch {
    return [];
  }
}

export function saveSubagents(subagents: SubagentDefinition[]): void {
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
  writeFileSync(SUBAGENTS_PATH, JSON.stringify(subagents, null, 2));
}

export function getSubagent(id: string): SubagentDefinition | undefined {
  return loadSubagents().find((s) => s.id === id);
}

export function createSubagent(input: {
  name: string;
  description?: string;
  allowedServices?: string[];
  claudeAuth?: SubagentDefinition["claudeAuth"];
  systemPromptPath?: string;
}): SubagentDefinition {
  const id = input.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  if (!id) throw new Error("Invalid subagent name");
  if (getSubagent(id)) throw new Error(`Subagent "${id}" already exists`);

  const now = new Date().toISOString();
  const brainPath = `subagents/${id}`;
  const qmdIndexDir = join(STORE_DIR, "qmd-indexes", id);

  const subagent: SubagentDefinition = {
    id,
    name: input.name,
    description: input.description ?? "",
    enabled: true,
    createdAt: now,
    updatedAt: now,
    allowedServices: input.allowedServices ?? [],
    brainPath,
    qmdIndex: qmdIndexDir,
    claudeAuth: input.claudeAuth ?? { mode: "host-spawned" },
    systemPromptPath: input.systemPromptPath,
  };

  // Create brain directory structure
  ensureBrainDir(subagent);

  // Create QMD index directory
  mkdirSync(qmdIndexDir, { recursive: true });

  // Trust the subagent brain directory for Claude Code
  // Running a trivial -p command with bypassPermissions auto-trusts the dir
  const brainDir = join(BRAIN_ROOT, brainPath);
  try {
    const { execFileSync } = require("child_process");
    const trustEnv: Record<string, string> = { ...process.env as any };
    if (subagent.claudeAuth.mode === "oauth") {
      trustEnv.HOME = getSubagentClaudeHome(id);
    }
    execFileSync("claude", ["-p", "hello", "--permission-mode", "bypassPermissions"], {
      cwd: brainDir,
      timeout: 30_000,
      stdio: "pipe",
      env: trustEnv,
    });
  } catch {
    // Non-fatal — trust will happen on first spawn
  }

  // Save
  const all = loadSubagents();
  all.push(subagent);
  saveSubagents(all);

  return subagent;
}

export function updateSubagent(
  id: string,
  updates: Partial<Omit<SubagentDefinition, "id" | "createdAt">>
): SubagentDefinition {
  const all = loadSubagents();
  const idx = all.findIndex((s) => s.id === id);
  if (idx < 0) throw new Error(`Subagent "${id}" not found`);

  all[idx] = {
    ...all[idx],
    ...updates,
    id, // prevent ID override
    createdAt: all[idx].createdAt, // prevent createdAt override
    updatedAt: new Date().toISOString(),
  };

  saveSubagents(all);
  return all[idx];
}

export function deleteSubagent(id: string, deleteBrain = false): boolean {
  const all = loadSubagents();
  const filtered = all.filter((s) => s.id !== id);
  if (filtered.length === all.length) return false;

  saveSubagents(filtered);

  // Delete brain directory if requested
  if (deleteBrain) {
    const brainDir = join(BRAIN_ROOT, "subagents", id);
    if (existsSync(brainDir)) {
      rmSync(brainDir, { recursive: true, force: true });
    }
  }

  // Clean up QMD index
  const qmdDir = join(STORE_DIR, "qmd-indexes", id);
  if (existsSync(qmdDir)) {
    rmSync(qmdDir, { recursive: true, force: true });
  }

  return true;
}

// ── Brain Directory Helpers ────────────────────────────────────────────

export function ensureBrainDir(subagent: SubagentDefinition): void {
  const brainDir = join(BRAIN_ROOT, subagent.brainPath);
  const dirs = [
    brainDir,
    join(brainDir, "context"),
    join(brainDir, "knowledge"),
    join(brainDir, "knowledge", "decisions"),
    join(brainDir, "knowledge", "patterns"),
    join(brainDir, "knowledge", "corrections"),
    join(brainDir, "knowledge", "entities"),
    join(brainDir, "knowledge", "projects"),
    join(brainDir, "inbox"),
    join(brainDir, "archive"),
  ];

  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }

  // Create initial ACTIVE.md if not exists
  const activePath = join(brainDir, "context", "ACTIVE.md");
  if (!existsSync(activePath)) {
    writeFileSync(
      activePath,
      `# ${subagent.name} — Active Context\n\nSubagent initialized ${new Date().toISOString().slice(0, 10)}.\n`
    );
  }
}

export function getSubagentBrainRoot(subagentId: string): string {
  return join(BRAIN_ROOT, "subagents", subagentId);
}

// ── Claude Home Directory ──────────────────────────────────────────────

export function getSubagentClaudeHome(subagentId: string): string {
  const dir = join(STORE_DIR, "subagent-claude-home", subagentId);
  mkdirSync(dir, { recursive: true });
  // Ensure .claude subdir exists (where credentials.json lives)
  mkdirSync(join(dir, ".claude"), { recursive: true });
  return dir;
}
