import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  renameSync,
  cpSync,
} from "fs";
import { join } from "path";
import { execFileSync } from "child_process";
import { STORE_DIR, PROJECT_ROOT } from "./paths.js";
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
  bypassPermissions?: boolean;
  autoSpawn?: boolean;
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

  // Create isolated Linux user for this subagent
  createLinuxUser(id);

  // Create .mcp.json in the subagent's brain dir pointing to the scoped MCP server
  const brainDir = join(BRAIN_ROOT, brainPath);
  const mcpServerName = `workbot-${id}`;
  const mcpJson = {
    mcpServers: {
      [mcpServerName]: {
        command: "bash",
        args: [
          "-c",
          `cd ${PROJECT_ROOT} && exec node node_modules/tsx/dist/cli.mjs server/src/mcp.ts --subagent ${id}`,
        ],
      },
    },
  };
  writeFileSync(join(brainDir, ".mcp.json"), JSON.stringify(mcpJson, null, 2));

  // Create .claude/settings.local.json in the brain dir
  const claudeDir = join(brainDir, ".claude");
  mkdirSync(claudeDir, { recursive: true });
  const mcpPrefix = `mcp__${mcpServerName}__`;
  const mcpToolPerms = [
    `${mcpPrefix}brain_search`,
    `${mcpPrefix}brain_vsearch`,
    `${mcpPrefix}brain_get`,
    `${mcpPrefix}brain_write`,
    `${mcpPrefix}brain_update`,
    `${mcpPrefix}brain_list`,
    `${mcpPrefix}brain_context`,
    `${mcpPrefix}service_status`,
    `${mcpPrefix}service_request`,
    `${mcpPrefix}git_credentials`,
    `${mcpPrefix}debug_env`,
  ];
  // Project-level settings.local.json — permissions + hooks
  const projectSettings = {
    permissions: { allow: mcpToolPerms, deny: [] as string[] },
    hooks: {
      SessionStart: [{
        hooks: [{
          type: "command",
          command: `echo '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"BRAIN BOOT: You MUST read context/ACTIVE.md via brain_context or brain_get BEFORE doing anything else. You are subagent ${id}. Only use YOUR scoped MCP tools (${mcpServerName}). Do not skip this step."}}'`,
          statusMessage: "Loading brain context...",
        }],
      }],
      Stop: [{
        hooks: [{
          type: "command",
          command: `echo '{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"BRAIN SAVE: Before ending, you MUST: 1) Update context/ACTIVE.md with current session state via brain_write. 2) Write any new reusable knowledge to the appropriate brain folder (decisions/, patterns/, corrections/, entities/, projects/). Do NOT skip this step."}}'`,
          statusMessage: "Saving brain context...",
        }],
      }],
    },
  };
  writeFileSync(join(claudeDir, "settings.local.json"), JSON.stringify(projectSettings, null, 2));

  // Ensure claude home exists (credentials must be set up via Terminal)
  const claudeHome = getSubagentClaudeHome(id);

  // Write user-level and project-level claude settings for MCP approval
  // Claude stores project settings at ~/.claude/projects/{path-slug}/settings.json
  const brainAbsPath = join(BRAIN_ROOT, brainPath);
  const pathSlug = brainAbsPath.replace(/\//g, "-");
  const userClaudeDir = join(claudeHome, ".claude");
  const projSettingsDir = join(userClaudeDir, "projects", pathSlug);
  mkdirSync(projSettingsDir, { recursive: true });

  // User-level settings — enabledMcpjsonServers and permissions work here
  const userSettings = {
    permissions: { allow: mcpToolPerms, deny: [] as string[] },
    enabledMcpjsonServers: [mcpServerName],
    enableAllProjectMcpServers: false,
  };
  writeFileSync(join(userClaudeDir, "settings.json"), JSON.stringify(userSettings, null, 2));

  // Per-project user settings — permissions only
  writeFileSync(join(projSettingsDir, "settings.json"), JSON.stringify(projectSettings, null, 2));

  // Set ownership on all subagent dirs
  const username = getSubagentLinuxUser(id);
  try {
    execFileSync("chown", ["-R", `${username}:subagents`, brainDir], { stdio: "pipe" });
    execFileSync("chmod", ["-R", "2770", brainDir], { stdio: "pipe" });
    execFileSync("chown", ["-R", `${username}:subagents`, claudeHome], { stdio: "pipe" });
    execFileSync("chmod", ["700", claudeHome], { stdio: "pipe" });
  } catch { /* non-fatal */ }

  // Lock down host brain so subagents can only traverse to their own dir
  try {
    execFileSync("chown", ["workbot:workbot", BRAIN_ROOT], { stdio: "pipe" });
    execFileSync("chmod", ["711", BRAIN_ROOT], { stdio: "pipe" });
    execFileSync("chown", ["workbot:workbot", join(BRAIN_ROOT, "subagents")], { stdio: "pipe" });
    execFileSync("chmod", ["711", join(BRAIN_ROOT, "subagents")], { stdio: "pipe" });
    // Ensure /tmp/claude is world-writable for session temp files
    execFileSync("mkdir", ["-p", "/tmp/claude"], { stdio: "pipe" });
    execFileSync("chmod", ["1777", "/tmp/claude"], { stdio: "pipe" });
  } catch { /* non-fatal */ }

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

export function deleteSubagent(id: string): { archived: boolean; archivePath: string | null } {
  const all = loadSubagents();
  const subagent = all.find((s) => s.id === id);
  if (!subagent) throw new Error(`Subagent "${id}" not found`);

  const filtered = all.filter((s) => s.id !== id);
  saveSubagents(filtered);

  // Kill any running processes for this user
  const username = getSubagentLinuxUser(id);
  try {
    execFileSync("pkill", ["-u", username], { stdio: "pipe" });
  } catch { /* no processes or user doesn't exist */ }

  // Remove Linux user
  deleteLinuxUser(id);

  // Archive brain to HOST archive folder (workbot-brain/archive/deleted-subagents/)
  let archivePath: string | null = null;
  const brainDir = join(BRAIN_ROOT, "subagents", id);
  if (existsSync(brainDir)) {
    const archiveBase = join(BRAIN_ROOT, "archive", "deleted-subagents");
    mkdirSync(archiveBase, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    archivePath = join(archiveBase, `${id}_${timestamp}`);
    try {
      // Copy brain content to archive (not move — we'll clean up after)
      cpSync(brainDir, archivePath, { recursive: true });

      // Strip credentials and .claude config from archive (keep only brain content)
      const archiveClaudeDir = join(archivePath, ".claude");
      if (existsSync(archiveClaudeDir)) rmSync(archiveClaudeDir, { recursive: true, force: true });
      const archiveMcp = join(archivePath, ".mcp.json");
      if (existsSync(archiveMcp)) rmSync(archiveMcp, { force: true });
    } catch { /* archive failed — still proceed with cleanup */ }

    // Remove the entire subagent brain directory
    rmSync(brainDir, { recursive: true, force: true });
  }

  // Clean up claude home (credentials, config)
  const claudeHome = join(STORE_DIR, "subagent-claude-home", id);
  if (existsSync(claudeHome)) {
    rmSync(claudeHome, { recursive: true, force: true });
  }

  // Clean up QMD index
  const qmdDir = join(STORE_DIR, "qmd-indexes", id);
  if (existsSync(qmdDir)) {
    rmSync(qmdDir, { recursive: true, force: true });
  }

  return { archived: !!archivePath, archivePath };
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

  // Create subagent-specific CLAUDE.md (prevents inheriting host brain instructions)
  const claudeMdPath = join(brainDir, "CLAUDE.md");
  if (!existsSync(claudeMdPath)) {
    writeFileSync(claudeMdPath, `# ${subagent.name}

Subagent of the Workbot system. Your brain is this directory.

## Brain Usage

**Boot:** Read \`context/ACTIVE.md\` at the start of every session.

**During work:** Use the workbot MCP brain tools:
- \`brain_search\` / \`brain_vsearch\` — search your brain
- \`brain_get\` — read a specific note
- \`brain_write\` — write/update a note
- \`brain_list\` — list notes
- \`brain_context\` — load ACTIVE.md + recent notes
- \`service_status\` — check available services
- \`service_request\` — make API calls to allowed services

**End of session:** Update \`context/ACTIVE.md\` with current state.

## Your Brain Structure

- \`context/\` — Active context (ACTIVE.md)
- \`knowledge/decisions/\` — Architecture decisions
- \`knowledge/patterns/\` — Reusable patterns
- \`knowledge/corrections/\` — Corrections and fixes
- \`knowledge/entities/\` — People, services, tools
- \`knowledge/projects/\` — Project state
- \`inbox/\` — Unprocessed captures

## Boundaries

- You can only access YOUR brain directory, not the host brain or other subagents
- You can only use services that have been assigned to you
- Write to your brain when you learn something reusable
`);
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

// ── Linux User Isolation ──────────────────────────────────────────────

export function getSubagentLinuxUser(subagentId: string): string {
  return `sa-${subagentId}`;
}

export function createLinuxUser(subagentId: string): void {
  const username = getSubagentLinuxUser(subagentId);

  // Check if user already exists
  try {
    execFileSync("id", [username], { stdio: "pipe" });
    return; // already exists
  } catch { /* doesn't exist, create it */ }

  try {
    execFileSync("useradd", [
      "--system", "--no-create-home",
      "--shell", "/bin/bash", "--gid", "subagents", username,
    ], { stdio: "pipe" });
  } catch (err: any) {
    console.error(`[subagents] Failed to create Linux user ${username}:`, err.message);
    return; // non-fatal — user isolation won't work but subagent still functions
  }

  // Set ownership on brain dir and claude home
  const brainDir = join(BRAIN_ROOT, "subagents", subagentId);
  const claudeHome = getSubagentClaudeHome(subagentId);

  try {
    execFileSync("chown", ["-R", `${username}:subagents`, brainDir], { stdio: "pipe" });
    execFileSync("chmod", ["-R", "2770", brainDir], { stdio: "pipe" });
  } catch { /* brain dir might not exist yet */ }

  try {
    execFileSync("chown", ["-R", `${username}:subagents`, claudeHome], { stdio: "pipe" });
    execFileSync("chmod", ["700", claudeHome], { stdio: "pipe" });
  } catch { /* claude home might not exist yet */ }
}

export function deleteLinuxUser(subagentId: string): void {
  const username = getSubagentLinuxUser(subagentId);
  try {
    execFileSync("userdel", [username], { stdio: "pipe" });
  } catch { /* user may not exist */ }
}
