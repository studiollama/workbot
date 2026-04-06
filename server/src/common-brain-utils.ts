/**
 * Common knowledge brain — a shared brain directory that all agents (host + subagents)
 * can read/write to, backed by its own git repo for change tracking and recovery.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { execFileSync } from "child_process";
import { promisify } from "util";
import { execFile } from "child_process";
import { BRAIN_ROOT } from "./brain-utils.js";
import { STORE_DIR } from "./paths.js";
import { createScopedBrainUtils } from "./subagent-brain-utils.js";

const execFileAsync = promisify(execFile);

export const COMMON_BRAIN_ROOT = join(BRAIN_ROOT, "common");
export const COMMON_QMD_INDEX = join(STORE_DIR, "qmd-indexes", "common");

let _commonBrain: ReturnType<typeof createScopedBrainUtils> | null = null;

/** Get cached scoped brain utils for the common knowledge directory */
export function getCommonBrain() {
  if (!_commonBrain) _commonBrain = createScopedBrainUtils(COMMON_BRAIN_ROOT);
  return _commonBrain;
}

/** Validate a note path — reject traversal and absolute paths */
export function validateCommonPath(path: string): string | null {
  if (path.startsWith("/")) return "Path must be relative, not absolute";
  if (path.includes("..")) return "Path must not contain '..'";
  if (path.includes("\0")) return "Path must not contain null bytes";
  return null;
}

/** Ensure common brain directory structure, git repo, and permissions exist */
export function ensureCommonBrainDir(): void {
  const dirs = [
    COMMON_BRAIN_ROOT,
    join(COMMON_BRAIN_ROOT, "context"),
    join(COMMON_BRAIN_ROOT, "knowledge"),
    join(COMMON_BRAIN_ROOT, "knowledge", "decisions"),
    join(COMMON_BRAIN_ROOT, "knowledge", "patterns"),
    join(COMMON_BRAIN_ROOT, "knowledge", "corrections"),
    join(COMMON_BRAIN_ROOT, "knowledge", "entities"),
    join(COMMON_BRAIN_ROOT, "knowledge", "projects"),
    join(COMMON_BRAIN_ROOT, "inbox"),
    COMMON_QMD_INDEX,
  ];

  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }

  // Initialize git repo if not exists
  if (!existsSync(join(COMMON_BRAIN_ROOT, ".git"))) {
    try {
      execFileSync("git", ["init"], { cwd: COMMON_BRAIN_ROOT, stdio: "pipe" });
      execFileSync("git", ["config", "user.name", "Workbot System"], { cwd: COMMON_BRAIN_ROOT, stdio: "pipe" });
      execFileSync("git", ["config", "user.email", "system@workbot"], { cwd: COMMON_BRAIN_ROOT, stdio: "pipe" });

      // Initial commit
      const readmePath = join(COMMON_BRAIN_ROOT, "context", "README.md");
      if (!existsSync(readmePath)) {
        writeFileSync(readmePath, `---
tags:
  - context
  - status/active
aliases: [common knowledge readme]
---

# Common Knowledge

Shared knowledge base accessible by all workbot agents (host and subagents).

Notes here are version-controlled via git. Every change is committed with the agent's identity.

## Structure

- \`knowledge/decisions/\` — Architecture decisions
- \`knowledge/patterns/\` — Reusable patterns
- \`knowledge/corrections/\` — Corrections and fixes
- \`knowledge/entities/\` — Systems, services, people
- \`knowledge/projects/\` — Project state
- \`context/\` — Shared operational context
- \`inbox/\` — Unprocessed captures

## Related

- See also: [[ACTIVE]]
`);
      }
      execFileSync("git", ["add", "-A"], { cwd: COMMON_BRAIN_ROOT, stdio: "pipe" });
      execFileSync("git", ["commit", "-m", "Initialize common knowledge brain"], { cwd: COMMON_BRAIN_ROOT, stdio: "pipe" });
    } catch { /* git init may fail in some environments — non-fatal */ }
  }

  // Set group permissions so all subagents (sa-* users in 'subagents' group) can read/write
  try {
    execFileSync("chown", ["-R", "root:subagents", COMMON_BRAIN_ROOT], { stdio: "pipe" });
    execFileSync("chmod", ["-R", "2770", COMMON_BRAIN_ROOT], { stdio: "pipe" });
    // QMD index also needs to be writable
    execFileSync("chown", ["-R", "root:subagents", COMMON_QMD_INDEX], { stdio: "pipe" });
    execFileSync("chmod", ["-R", "2770", COMMON_QMD_INDEX], { stdio: "pipe" });
  } catch { /* non-fatal if user/group setup isn't available */ }
}

/**
 * Git commit all pending changes in the common brain.
 * @returns commit hash, or "nothing to commit" if clean.
 */
export async function commonGitCommit(
  message: string,
  authorName: string,
  authorEmail: string
): Promise<string> {
  const opts = { cwd: COMMON_BRAIN_ROOT, timeout: 15_000 };

  // Stage all changes
  await execFileAsync("git", ["add", "-A"], opts);

  // Check if there's anything to commit
  try {
    await execFileAsync("git", ["diff", "--cached", "--quiet"], opts);
    return "nothing to commit";
  } catch {
    // diff --cached --quiet exits non-zero when there are staged changes — that's what we want
  }

  // Commit with author identification
  const author = `${authorName} <${authorEmail}>`;
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["commit", `--author=${author}`, "-m", message],
      opts
    );
    // Extract commit hash from output
    const hashMatch = stdout.match(/\[[\w-]+ ([a-f0-9]+)\]/);
    return hashMatch ? hashMatch[1] : stdout.trim();
  } catch (err: any) {
    // Retry once on lock conflict
    if (err.message?.includes("lock")) {
      await new Promise((r) => setTimeout(r, 500));
      const { stdout } = await execFileAsync(
        "git",
        ["commit", `--author=${author}`, "-m", message],
        opts
      );
      const hashMatch = stdout.match(/\[[\w-]+ ([a-f0-9]+)\]/);
      return hashMatch ? hashMatch[1] : stdout.trim();
    }
    throw err;
  }
}

const COMMON_CONTEXT_PATH = join(COMMON_BRAIN_ROOT, "context", "README.md");

/** Read the common brain context/README.md guide. Returns the body (after frontmatter). */
export function readCommonContext(): string {
  try {
    if (!existsSync(COMMON_CONTEXT_PATH)) return "";
    const raw = readFileSync(COMMON_CONTEXT_PATH, "utf-8");
    // Strip frontmatter
    const match = raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
    return match ? match[1].trim() : raw.trim();
  } catch {
    return "";
  }
}

/** Get recent git log from the common brain repo */
export async function commonGitLog(limit = 10): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["log", `--oneline`, `-${limit}`, "--format=%h %an — %s (%ar)"],
      { cwd: COMMON_BRAIN_ROOT, timeout: 5_000 }
    );
    return stdout.trim() || "No commits yet.";
  } catch {
    return "No commits yet.";
  }
}
