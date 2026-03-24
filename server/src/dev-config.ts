import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { STORE_DIR } from "./services.js";

const DEV_CONFIG_PATH = join(STORE_DIR, "development.json");

export interface DevConfig {
  repoUrl: string | null;
  owner: string | null;
  repo: string | null;
  cloneStatus: "idle" | "cloning" | "cloned" | "error";
  cloneError: string | null;
  lastClonedAt: string | null;
  analysisStatus: "idle" | "running" | "done" | "error";
  analysisError: string | null;
}

const DEFAULTS: DevConfig = {
  repoUrl: null,
  owner: null,
  repo: null,
  cloneStatus: "idle",
  cloneError: null,
  lastClonedAt: null,
  analysisStatus: "idle",
  analysisError: null,
};

export function loadDevConfig(): DevConfig {
  try {
    if (!existsSync(DEV_CONFIG_PATH)) return { ...DEFAULTS };
    const raw = JSON.parse(readFileSync(DEV_CONFIG_PATH, "utf-8"));
    return {
      repoUrl: typeof raw.repoUrl === "string" ? raw.repoUrl : null,
      owner: typeof raw.owner === "string" ? raw.owner : null,
      repo: typeof raw.repo === "string" ? raw.repo : null,
      cloneStatus: ["idle", "cloning", "cloned", "error"].includes(raw.cloneStatus)
        ? raw.cloneStatus
        : "idle",
      cloneError: typeof raw.cloneError === "string" ? raw.cloneError : null,
      lastClonedAt: typeof raw.lastClonedAt === "string" ? raw.lastClonedAt : null,
      analysisStatus: ["idle", "running", "done", "error"].includes(raw.analysisStatus)
        ? raw.analysisStatus
        : "idle",
      analysisError: typeof raw.analysisError === "string" ? raw.analysisError : null,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveDevConfig(config: Partial<DevConfig>) {
  const current = loadDevConfig();
  const merged = { ...current, ...config };
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
  writeFileSync(DEV_CONFIG_PATH, JSON.stringify(merged, null, 2));
}

export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  // Supports: https://github.com/owner/repo, https://github.com/owner/repo.git,
  // git@github.com:owner/repo.git
  const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };
  const sshMatch = url.match(/github\.com:([^/]+)\/([^/.]+)/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };
  return null;
}
