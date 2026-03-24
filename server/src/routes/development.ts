import { Router } from "express";
import { spawn } from "child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join, basename } from "path";
import { loadDevConfig, saveDevConfig, parseGitHubUrl } from "../dev-config.js";
import { loadStore, SERVICES, PROJECT_ROOT } from "../services.js";

const router = Router();
const DEV_DIR = join(PROJECT_ROOT, "development");

// Helper: fetch from GitHub API using stored token
async function githubFetch(path: string): Promise<Response> {
  const store = loadStore();
  const gh = store.github;
  if (!gh) throw new Error("GitHub not connected");
  return fetch(`https://api.github.com${path}`, {
    headers: SERVICES.github.authHeader(gh.token),
  });
}

// GET /api/dev/status
router.get("/status", (_req, res) => {
  const config = loadDevConfig();
  const store = loadStore();
  res.json({
    ...config,
    githubConnected: !!store.github,
  });
});

// POST /api/dev/repo — set repo URL
router.post("/repo", (req, res) => {
  const { repoUrl } = req.body;
  if (!repoUrl || typeof repoUrl !== "string") {
    return res.status(400).json({ error: "repoUrl is required" });
  }
  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) {
    return res.status(400).json({ error: "Invalid GitHub URL" });
  }
  saveDevConfig({
    repoUrl,
    owner: parsed.owner,
    repo: parsed.repo,
    cloneStatus: "idle",
    cloneError: null,
  });
  res.json({ ok: true });
});

// DELETE /api/dev/repo — remove repo config
router.delete("/repo", (_req, res) => {
  saveDevConfig({
    repoUrl: null,
    owner: null,
    repo: null,
    cloneStatus: "idle",
    cloneError: null,
    lastClonedAt: null,
    analysisStatus: "idle",
    analysisError: null,
  });
  res.json({ ok: true });
});

// POST /api/dev/clone — start cloning the repo
router.post("/clone", (_req, res) => {
  const config = loadDevConfig();
  const store = loadStore();

  if (!store.github) {
    return res.status(400).json({ error: "GitHub not connected" });
  }
  if (!config.repoUrl) {
    return res.status(400).json({ error: "No repo URL configured" });
  }

  // Build authenticated clone URL
  const token = store.github.token;
  const cloneUrl = config.repoUrl.replace(
    "https://github.com/",
    `https://x-access-token:${token}@github.com/`
  );

  // If already cloned, do git pull instead
  const isUpdate = existsSync(join(DEV_DIR, ".git"));

  saveDevConfig({ cloneStatus: "cloning", cloneError: null });
  res.json({ ok: true, action: isUpdate ? "pulling" : "cloning" });

  if (isUpdate) {
    const pull = spawn("git", ["pull"], {
      cwd: DEV_DIR,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    pull.stderr.on("data", (d) => (stderr += d.toString()));
    pull.on("close", (code) => {
      if (code === 0) {
        saveDevConfig({ cloneStatus: "cloned", lastClonedAt: new Date().toISOString() });
      } else {
        saveDevConfig({ cloneStatus: "error", cloneError: stderr.slice(0, 300) });
      }
    });
  } else {
    const clone = spawn("git", ["clone", "--depth", "1", cloneUrl, "development"], {
      cwd: PROJECT_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    clone.stderr.on("data", (d) => (stderr += d.toString()));
    clone.on("close", (code) => {
      if (code === 0) {
        saveDevConfig({ cloneStatus: "cloned", lastClonedAt: new Date().toISOString() });
      } else {
        // Scrub token from error message
        const cleanErr = stderr.replace(/x-access-token:[^@]+@/g, "***@");
        saveDevConfig({ cloneStatus: "error", cloneError: cleanErr.slice(0, 300) });
      }
    });
  }
});

// GET /api/dev/commits — recent commits from GitHub API
router.get("/commits", async (_req, res) => {
  const config = loadDevConfig();
  if (!config.owner || !config.repo) {
    return res.status(400).json({ error: "No repo configured" });
  }
  try {
    const resp = await githubFetch(`/repos/${config.owner}/${config.repo}/commits?per_page=10`);
    if (!resp.ok) return res.status(resp.status).json({ error: "GitHub API error" });
    const data = await resp.json();
    const commits = (data as any[]).map((c) => ({
      sha: c.sha?.substring(0, 7),
      message: c.commit?.message?.split("\n")[0]?.substring(0, 80),
      author: c.commit?.author?.name ?? c.author?.login ?? "unknown",
      date: c.commit?.author?.date,
    }));
    res.json(commits);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dev/issues — open issues from GitHub API
router.get("/issues", async (_req, res) => {
  const config = loadDevConfig();
  if (!config.owner || !config.repo) {
    return res.status(400).json({ error: "No repo configured" });
  }
  try {
    const resp = await githubFetch(
      `/repos/${config.owner}/${config.repo}/issues?state=open&per_page=20`
    );
    if (!resp.ok) return res.status(resp.status).json({ error: "GitHub API error" });
    const data = await resp.json();
    const issues = (data as any[])
      .filter((i) => !i.pull_request) // exclude PRs
      .map((i) => ({
        number: i.number,
        title: i.title?.substring(0, 100),
        state: i.state,
        user: i.user?.login ?? "unknown",
        labels: (i.labels ?? []).map((l: any) => l.name),
        created_at: i.created_at,
      }));
    res.json(issues);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dev/pulls — open PRs from GitHub API
router.get("/pulls", async (_req, res) => {
  const config = loadDevConfig();
  if (!config.owner || !config.repo) {
    return res.status(400).json({ error: "No repo configured" });
  }
  try {
    const resp = await githubFetch(
      `/repos/${config.owner}/${config.repo}/pulls?state=open&per_page=20`
    );
    if (!resp.ok) return res.status(resp.status).json({ error: "GitHub API error" });
    const data = await resp.json();
    const pulls = (data as any[]).map((p) => ({
      number: p.number,
      title: p.title?.substring(0, 100),
      state: p.state,
      user: p.user?.login ?? "unknown",
      head: p.head?.ref,
      base: p.base?.ref,
      created_at: p.created_at,
    }));
    res.json(pulls);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dev/env — list .env files and their entries
router.get("/env", (_req, res) => {
  if (!existsSync(DEV_DIR)) {
    return res.json([]);
  }
  const reveal = _req.query.reveal === "true";
  try {
    const files = readdirSync(DEV_DIR).filter((f) => f.startsWith(".env"));
    const result = files.map((filename) => {
      const content = readFileSync(join(DEV_DIR, filename), "utf-8");
      const entries = content
        .split("\n")
        .filter((line) => line.trim() && !line.trim().startsWith("#"))
        .map((line) => {
          const eqIdx = line.indexOf("=");
          if (eqIdx === -1) return { key: line.trim(), value: "" };
          const key = line.substring(0, eqIdx).trim();
          const value = line.substring(eqIdx + 1).trim();
          const isExample = filename.includes("example");
          return {
            key,
            value: reveal || isExample ? value : "********",
          };
        });
      return { filename, entries };
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/dev/env — update a .env file
router.put("/env", (req, res) => {
  const { file, entries } = req.body;
  if (!file || !Array.isArray(entries)) {
    return res.status(400).json({ error: "file and entries are required" });
  }
  // Security: validate filename (no path traversal)
  const safe = basename(file);
  if (!safe.startsWith(".env")) {
    return res.status(400).json({ error: "Invalid filename" });
  }
  const filePath = join(DEV_DIR, safe);
  if (!existsSync(DEV_DIR)) {
    return res.status(400).json({ error: "Development directory not found" });
  }
  try {
    const content = entries.map((e: { key: string; value: string }) => `${e.key}=${e.value}`).join("\n") + "\n";
    writeFileSync(filePath, content);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dev/analyze — kick off Claude Code analysis session
router.post("/analyze", (_req, res) => {
  const config = loadDevConfig();
  if (config.cloneStatus !== "cloned") {
    return res.status(400).json({ error: "Repo not cloned yet" });
  }
  if (config.analysisStatus === "running") {
    return res.status(400).json({ error: "Analysis already running" });
  }

  saveDevConfig({ analysisStatus: "running", analysisError: null });
  res.json({ ok: true });

  const prompt = `You are analyzing a codebase in the ./development/ directory for the workbot system.

Your task:
1. Read the key files: README.md, CLAUDE.md, package.json, and scan the source directory structure
2. Identify: tech stack, architecture patterns, key dependencies, API structure, database setup
3. Write a concise knowledge note to workbot-brain/knowledge/projects/ summarizing what you found
4. The note should follow the brain template format with YAML frontmatter (tags: #project, #status/active)
5. Include [[wikilinks]] to related brain notes if applicable
6. After writing, run: node "${join(PROJECT_ROOT, "node_modules/@tobilu/qmd/dist/cli/qmd.js").replace(/\\/g, "/")}" update --dir "${join(PROJECT_ROOT, "workbot-brain").replace(/\\/g, "/")}"

Keep the note practical — focus on what a developer or AI agent needs to know to work on this codebase.`;

  const claude = spawn("claude", ["--print", prompt], {
    cwd: PROJECT_ROOT,
    stdio: ["pipe", "pipe", "pipe"],
    shell: true,
  });

  let stderr = "";
  claude.stderr.on("data", (d) => (stderr += d.toString()));
  claude.on("close", (code) => {
    if (code === 0) {
      saveDevConfig({ analysisStatus: "done" });
    } else {
      saveDevConfig({
        analysisStatus: "error",
        analysisError: stderr.slice(0, 300) || `Exit code ${code}`,
      });
    }
  });
  claude.on("error", (err) => {
    saveDevConfig({
      analysisStatus: "error",
      analysisError: err.message.slice(0, 300),
    });
  });
});

export default router;
