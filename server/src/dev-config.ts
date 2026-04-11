import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { STORE_DIR } from "./services.js";

const DEV_CONFIG_PATH = join(STORE_DIR, "development.json");

export interface DevProject {
  id: string;
  name: string;
  scope?: string | null; // null/undefined = host, subagent ID = that agent's project
  repoUrl: string;
  owner: string;
  repo: string;
  cloneStatus: "idle" | "cloning" | "cloned" | "error";
  cloneError: string | null;
  lastClonedAt: string | null;
  createdAt: string;
}

export interface DevConfigStore {
  projects: DevProject[];
}

// ── Backward compatibility: migrate old single-repo config ──────────

function migrateOldConfig(raw: any): DevConfigStore {
  if (Array.isArray(raw.projects)) return raw as DevConfigStore;
  // Old format: single repo at top level
  if (raw.repoUrl && raw.owner && raw.repo) {
    const id = raw.repo.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return {
      projects: [{
        id,
        name: raw.repo,
        repoUrl: raw.repoUrl,
        owner: raw.owner,
        repo: raw.repo,
        cloneStatus: raw.cloneStatus || "idle",
        cloneError: raw.cloneError || null,
        lastClonedAt: raw.lastClonedAt || null,
        createdAt: new Date().toISOString(),
      }],
    };
  }
  return { projects: [] };
}

export function loadDevConfig(): DevConfigStore {
  try {
    if (!existsSync(DEV_CONFIG_PATH)) return { projects: [] };
    const raw = JSON.parse(readFileSync(DEV_CONFIG_PATH, "utf-8"));
    return migrateOldConfig(raw);
  } catch {
    return { projects: [] };
  }
}

export function saveDevConfig(config: DevConfigStore) {
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
  writeFileSync(DEV_CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function getProject(id: string): DevProject | undefined {
  return loadDevConfig().projects.find((p) => p.id === id);
}

export function addProject(project: DevProject) {
  const config = loadDevConfig();
  config.projects.push(project);
  saveDevConfig(config);
}

export function updateProject(id: string, updates: Partial<DevProject>) {
  const config = loadDevConfig();
  const idx = config.projects.findIndex((p) => p.id === id);
  if (idx < 0) return;
  config.projects[idx] = { ...config.projects[idx], ...updates };
  saveDevConfig(config);
}

export function removeProject(id: string) {
  const config = loadDevConfig();
  config.projects = config.projects.filter((p) => p.id !== id);
  saveDevConfig(config);
}

export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };
  const sshMatch = url.match(/github\.com:([^/]+)\/([^/.]+)/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };
  return null;
}
