import { Router } from "express";
import { existsSync, mkdirSync, writeFileSync, rmSync, readdirSync } from "fs";
import { join } from "path";
import { loadSkills, saveSkills, CURATED_SKILLS, type Skill } from "../skills-config.js";
import { PROJECT_ROOT } from "../services.js";

const router = Router();

const SKILLS_DIR = join(PROJECT_ROOT, ".claude", "skills");

/** Ensure .claude/skills/ directory exists */
function ensureSkillsDir() {
  if (!existsSync(SKILLS_DIR)) mkdirSync(SKILLS_DIR, { recursive: true });
}

/**
 * Attempt to fetch SKILL.md from a GitHub repo.
 * Tries common locations: SKILL.md at root, then skill.md, then .claude/skills/SKILL.md
 */
async function fetchSkillMd(githubUrl: string): Promise<string | null> {
  const ghMatch = githubUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!ghMatch) return null;

  const [, owner, repo] = ghMatch;
  const cleanRepo = repo.replace(/\.git$/, "");

  // Try common SKILL.md locations in raw GitHub
  const paths = [
    "SKILL.md",
    "skill.md",
    ".claude/skills/SKILL.md",
    "claude/SKILL.md",
  ];

  for (const p of paths) {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${cleanRepo}/main/${p}`;
    try {
      const resp = await fetch(rawUrl);
      if (resp.ok) {
        const text = await resp.text();
        // Sanity check: should look like markdown with some content
        if (text.length > 20) return text;
      }
    } catch {
      // Try next path
    }
    // Also try master branch
    const masterUrl = `https://raw.githubusercontent.com/${owner}/${cleanRepo}/master/${p}`;
    try {
      const resp = await fetch(masterUrl);
      if (resp.ok) {
        const text = await resp.text();
        if (text.length > 20) return text;
      }
    } catch {
      // Continue
    }
  }

  return null;
}

// GET /api/skills — list all skills
router.get("/", (_req, res) => {
  res.json(loadSkills());
});

// PUT /api/skills/:id/toggle — enable/disable a skill
router.put("/:id/toggle", (req, res) => {
  const skills = loadSkills();
  const skill = skills.find((s) => s.id === req.params.id);
  if (!skill) {
    return res.status(404).json({ error: "Skill not found" });
  }
  skill.enabled = !skill.enabled;
  saveSkills(skills);
  res.json({ ok: true, enabled: skill.enabled });
});

// POST /api/skills — add a new skill by GitHub URL
router.post("/", (req, res) => {
  const { githubUrl, name, description } = req.body;
  if (!githubUrl || typeof githubUrl !== "string") {
    return res.status(400).json({ error: "githubUrl is required" });
  }

  // Validate GitHub URL format
  const ghMatch = githubUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!ghMatch) {
    return res.status(400).json({ error: "Invalid GitHub URL" });
  }

  const repoName = ghMatch[2].replace(/\.git$/, "");
  const id = repoName.toLowerCase().replace(/[^a-z0-9-]/g, "-");

  const skills = loadSkills();
  if (skills.some((s) => s.id === id)) {
    return res.status(400).json({ error: "A skill with this ID already exists" });
  }

  const newSkill: Skill = {
    id,
    name: name || repoName.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
    description: description || "User-added skill. Review before enabling.",
    githubUrl,
    enabled: false,
    risk: "unknown",
    riskNote: "Not yet assessed. Run a web search to verify this skill's legitimacy before enabling.",
    installed: false,
    curated: false,
  };

  skills.push(newSkill);
  saveSkills(skills);
  res.json(newSkill);
});

// DELETE /api/skills/:id — remove a user-added skill
router.delete("/:id", (req, res) => {
  const { id } = req.params;

  if (CURATED_SKILLS.some((c) => c.id === id)) {
    return res.status(400).json({ error: "Cannot delete curated skills. Disable them instead." });
  }

  const skills = loadSkills();
  const filtered = skills.filter((s) => s.id !== id);
  if (filtered.length === skills.length) {
    return res.status(404).json({ error: "Skill not found" });
  }

  // Remove installed SKILL.md file if it exists
  const skillDir = join(SKILLS_DIR, id);
  if (existsSync(skillDir)) {
    rmSync(skillDir, { recursive: true });
  }

  saveSkills(filtered);
  res.json({ ok: true });
});

// POST /api/skills/:id/install — fetch SKILL.md from GitHub and install to .claude/skills/
router.post("/:id/install", async (req, res) => {
  const skills = loadSkills();
  const skill = skills.find((s) => s.id === req.params.id);
  if (!skill) {
    return res.status(404).json({ error: "Skill not found" });
  }

  try {
    const content = await fetchSkillMd(skill.githubUrl);
    if (!content) {
      return res.status(404).json({
        error: "Could not find SKILL.md in the GitHub repository. Checked SKILL.md, skill.md, and .claude/skills/SKILL.md on main and master branches.",
      });
    }

    // Write to .claude/skills/<skill-id>/SKILL.md
    ensureSkillsDir();
    const skillDir = join(SKILLS_DIR, skill.id);
    if (!existsSync(skillDir)) mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), content, "utf-8");

    skill.installed = true;
    saveSkills(skills);
    res.json({ ok: true, installed: true, size: content.length });
  } catch (err: any) {
    res.status(500).json({ error: `Install failed: ${err.message}` });
  }
});

// POST /api/skills/:id/uninstall — remove installed SKILL.md
router.post("/:id/uninstall", (req, res) => {
  const skills = loadSkills();
  const skill = skills.find((s) => s.id === req.params.id);
  if (!skill) {
    return res.status(404).json({ error: "Skill not found" });
  }

  const skillDir = join(SKILLS_DIR, skill.id);
  if (existsSync(skillDir)) {
    rmSync(skillDir, { recursive: true });
  }

  skill.installed = false;
  skill.enabled = false;
  saveSkills(skills);
  res.json({ ok: true });
});

// GET /api/skills/installed — list what's actually on disk in .claude/skills/
router.get("/installed", (_req, res) => {
  ensureSkillsDir();
  try {
    const dirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    res.json(dirs);
  } catch {
    res.json([]);
  }
});

// PUT /api/skills/:id/risk — update risk assessment
router.put("/:id/risk", (req, res) => {
  const { risk, riskNote } = req.body;
  if (!["low", "medium", "high", "unknown"].includes(risk)) {
    return res.status(400).json({ error: "Invalid risk level" });
  }
  const skills = loadSkills();
  const skill = skills.find((s) => s.id === req.params.id);
  if (!skill) {
    return res.status(404).json({ error: "Skill not found" });
  }
  skill.risk = risk;
  if (typeof riskNote === "string") skill.riskNote = riskNote;
  saveSkills(skills);
  res.json({ ok: true });
});

export default router;
