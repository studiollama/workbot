import { Router } from "express";
import { spawn } from "child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { join, basename } from "path";
import { loadDevConfig, saveDevConfig, addProject, updateProject, removeProject, getProject, parseGitHubUrl, type DevProject } from "../dev-config.js";
import { loadStore, SERVICES, PROJECT_ROOT, parseInstanceId } from "../services.js";

const router = Router();
const DEV_BASE = join(PROJECT_ROOT, "development");

// Ensure development base dir exists
if (!existsSync(DEV_BASE)) mkdirSync(DEV_BASE, { recursive: true });

// Helper: find a GitHub token from any connected github instance
function getGitHubToken(): string | null {
  const store = loadStore();
  for (const [key, val] of Object.entries(store)) {
    const { serviceType } = parseInstanceId(key);
    if (serviceType === "github" && val.token) return val.token;
  }
  return null;
}

// Helper: fetch from GitHub API
async function githubFetch(path: string): Promise<Response> {
  const token = getGitHubToken();
  if (!token) throw new Error("No GitHub service connected");
  return fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "workbot", Accept: "application/vnd.github.v3+json" },
  });
}

// Check if old single-dev-folder exists (needs migration)
function hasLegacyDevFolder(): boolean {
  return existsSync(join(DEV_BASE, ".git")) && !existsSync(join(DEV_BASE, ".git", ".."));
}

// GET /api/dev/status — list all projects + github connection status
router.get("/status", (_req, res) => {
  const config = loadDevConfig();
  // Detect legacy single-folder setup: development/.git exists but no project subfolders
  const needsMigration = existsSync(join(DEV_BASE, ".git"));
  res.json({
    projects: config.projects,
    githubConnected: !!getGitHubToken(),
    needsMigration,
  });
});

// POST /api/dev/migrate — convert old single-dev-folder to multi-project
router.post("/migrate", (_req, res) => {
  if (!existsSync(join(DEV_BASE, ".git"))) {
    return res.json({ ok: false, message: "No legacy development folder found" });
  }

  try {
    // Read the git remote to get the repo URL
    const { execFileSync } = require("child_process");
    let repoUrl = "";
    try {
      repoUrl = execFileSync("git", ["config", "--get", "remote.origin.url"], { cwd: DEV_BASE, encoding: "utf8" }).trim();
      // Strip any token from the URL
      repoUrl = repoUrl.replace(/x-access-token:[^@]+@/, "");
    } catch {}

    const parsed = repoUrl ? parseGitHubUrl(repoUrl) : null;
    const projectName = parsed?.repo || "legacy-project";
    const projectId = projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const projectDir = join(DEV_BASE, projectId);

    // Move the contents into a subfolder
    // First, create a temp dir, move everything there, then rename
    const tmpDir = join(DEV_BASE, "__migration_tmp__");
    mkdirSync(tmpDir, { recursive: true });

    // Move all files except the temp dir itself
    const items = readdirSync(DEV_BASE).filter((f) => f !== "__migration_tmp__" && f !== projectId);
    for (const item of items) {
      const { renameSync } = require("fs");
      renameSync(join(DEV_BASE, item), join(tmpDir, item));
    }

    // Rename temp to project dir
    const { renameSync: ren } = require("fs");
    ren(tmpDir, projectDir);

    // Add to config
    const project = {
      id: projectId,
      name: projectName,
      repoUrl: repoUrl || "unknown",
      owner: parsed?.owner || "unknown",
      repo: parsed?.repo || projectName,
      cloneStatus: "cloned" as const,
      cloneError: null,
      lastClonedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    addProject(project);

    res.json({ ok: true, project });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// POST /api/dev/projects — add a new project
router.post("/projects", (req, res) => {
  const { repoUrl, name } = req.body;
  if (!repoUrl || typeof repoUrl !== "string") return res.status(400).json({ error: "repoUrl is required" });

  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) return res.status(400).json({ error: "Invalid GitHub URL" });

  const id = (name || parsed.repo).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!id) return res.status(400).json({ error: "Invalid project name" });
  if (getProject(id)) return res.status(409).json({ error: `Project "${id}" already exists` });

  const project: DevProject = {
    id,
    name: name || parsed.repo,
    repoUrl,
    owner: parsed.owner,
    repo: parsed.repo,
    cloneStatus: "idle",
    cloneError: null,
    lastClonedAt: null,
    createdAt: new Date().toISOString(),
  };

  addProject(project);
  res.status(201).json(project);
});

// DELETE /api/dev/projects/:id — remove project + cloned files
router.delete("/projects/:id", (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  // Remove cloned directory
  const projectDir = join(DEV_BASE, project.id);
  if (existsSync(projectDir)) rmSync(projectDir, { recursive: true, force: true });

  removeProject(project.id);
  res.json({ ok: true });
});

// POST /api/dev/projects/:id/clone — clone or pull
router.post("/projects/:id/clone", (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const token = getGitHubToken();
  if (!token) return res.status(400).json({ error: "No GitHub service connected" });

  const cloneUrl = project.repoUrl.replace("https://github.com/", `https://x-access-token:${token}@github.com/`);
  const projectDir = join(DEV_BASE, project.id);
  const isUpdate = existsSync(join(projectDir, ".git"));

  updateProject(project.id, { cloneStatus: "cloning", cloneError: null });
  res.json({ ok: true, action: isUpdate ? "pulling" : "cloning" });

  if (isUpdate) {
    const pull = spawn("git", ["pull"], { cwd: projectDir, stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    pull.stderr.on("data", (d) => (stderr += d.toString()));
    pull.on("close", (code) => {
      updateProject(project.id, code === 0
        ? { cloneStatus: "cloned", lastClonedAt: new Date().toISOString() }
        : { cloneStatus: "error", cloneError: stderr.replace(/x-access-token:[^@]+@/g, "***@").slice(0, 300) });
    });
  } else {
    mkdirSync(DEV_BASE, { recursive: true });
    const clone = spawn("git", ["clone", "--depth", "1", cloneUrl, project.id], {
      cwd: DEV_BASE, stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    clone.stderr.on("data", (d) => (stderr += d.toString()));
    clone.on("close", (code) => {
      updateProject(project.id, code === 0
        ? { cloneStatus: "cloned", lastClonedAt: new Date().toISOString() }
        : { cloneStatus: "error", cloneError: stderr.replace(/x-access-token:[^@]+@/g, "***@").slice(0, 300) });
    });
  }
});

// GET /api/dev/projects/:id/commits
router.get("/projects/:id/commits", async (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  try {
    const resp = await githubFetch(`/repos/${project.owner}/${project.repo}/commits?per_page=10`);
    if (!resp.ok) return res.status(resp.status).json({ error: "GitHub API error" });
    const data = await resp.json();
    res.json((data as any[]).map((c) => ({
      sha: c.sha?.substring(0, 7),
      message: c.commit?.message?.split("\n")[0]?.substring(0, 80),
      author: c.commit?.author?.name ?? c.author?.login ?? "unknown",
      date: c.commit?.author?.date,
    })));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /api/dev/projects/:id/issues
router.get("/projects/:id/issues", async (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  try {
    const resp = await githubFetch(`/repos/${project.owner}/${project.repo}/issues?state=open&per_page=20`);
    if (!resp.ok) return res.status(resp.status).json({ error: "GitHub API error" });
    const data = await resp.json();
    res.json((data as any[]).filter((i) => !i.pull_request).map((i) => ({
      number: i.number, title: i.title?.substring(0, 100), state: i.state,
      user: i.user?.login ?? "unknown", labels: (i.labels ?? []).map((l: any) => l.name), created_at: i.created_at,
    })));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /api/dev/projects/:id/pulls
router.get("/projects/:id/pulls", async (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  try {
    const resp = await githubFetch(`/repos/${project.owner}/${project.repo}/pulls?state=open&per_page=20`);
    if (!resp.ok) return res.status(resp.status).json({ error: "GitHub API error" });
    const data = await resp.json();
    res.json((data as any[]).map((p) => ({
      number: p.number, title: p.title?.substring(0, 100), state: p.state,
      user: p.user?.login ?? "unknown", head: p.head?.ref, base: p.base?.ref, created_at: p.created_at,
    })));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /api/dev/projects/:id/env — .env files
router.get("/projects/:id/env", (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  const projectDir = join(DEV_BASE, project.id);
  if (!existsSync(projectDir)) return res.json([]);
  const reveal = req.query.reveal === "true";
  try {
    const files = readdirSync(projectDir).filter((f) => f.startsWith(".env"));
    const result = files.map((filename) => {
      const content = readFileSync(join(projectDir, filename), "utf-8");
      const entries = content.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).map((l) => {
        const eq = l.indexOf("=");
        if (eq === -1) return { key: l.trim(), value: "" };
        const key = l.substring(0, eq).trim();
        const value = l.substring(eq + 1).trim();
        return { key, value: reveal || filename.includes("example") ? value : "********" };
      });
      return { filename, entries };
    });
    res.json(result);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Legacy routes (backward compat for old single-repo API) ──────────

router.get("/commits", async (_req, res) => {
  const config = loadDevConfig();
  const first = config.projects[0];
  if (!first) return res.json([]);
  const resp = await githubFetch(`/repos/${first.owner}/${first.repo}/commits?per_page=10`).catch(() => null);
  if (!resp?.ok) return res.json([]);
  const data = await resp.json();
  res.json((data as any[]).map((c) => ({ sha: c.sha?.substring(0, 7), message: c.commit?.message?.split("\n")[0]?.substring(0, 80), author: c.commit?.author?.name ?? "unknown", date: c.commit?.author?.date })));
});

router.get("/issues", async (_req, res) => {
  const config = loadDevConfig();
  const first = config.projects[0];
  if (!first) return res.json([]);
  const resp = await githubFetch(`/repos/${first.owner}/${first.repo}/issues?state=open&per_page=20`).catch(() => null);
  if (!resp?.ok) return res.json([]);
  const data = await resp.json();
  res.json((data as any[]).filter((i) => !i.pull_request).map((i) => ({ number: i.number, title: i.title?.substring(0, 100), state: i.state, user: i.user?.login ?? "unknown", labels: (i.labels ?? []).map((l: any) => l.name), created_at: i.created_at })));
});

router.get("/pulls", async (_req, res) => {
  const config = loadDevConfig();
  const first = config.projects[0];
  if (!first) return res.json([]);
  const resp = await githubFetch(`/repos/${first.owner}/${first.repo}/pulls?state=open&per_page=20`).catch(() => null);
  if (!resp?.ok) return res.json([]);
  const data = await resp.json();
  res.json((data as any[]).map((p) => ({ number: p.number, title: p.title?.substring(0, 100), state: p.state, user: p.user?.login ?? "unknown", head: p.head?.ref, base: p.base?.ref, created_at: p.created_at })));
});

router.get("/env", (_req, res) => res.json([]));

export default router;
