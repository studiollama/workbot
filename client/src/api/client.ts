const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data as T;
}

// --- Service types ---

export interface ServiceStatus {
  connected: boolean;
  user?: string;
}

export interface ServiceConfig {
  name: string;
  tokenUrl: string;
  tokenPrefix: string;
  extraFields?: { key: string; label: string; placeholder: string }[];
  tokenLabel?: string;
  authNote?: string;
  difficulty?: string;
}

export interface DashboardConfig {
  enabledServices: string[];
  workbotName?: string;
  accentColor?: string;
}

export interface DeviceCodeResponse {
  verificationUrl?: string;
  userCode?: string;
  authenticated?: boolean;
  method?: string;
  error?: string;
}

export interface CodexPing {
  available: boolean;
  version?: string;
  error?: string;
}

// --- MCP types ---

export interface McpConfigData {
  qmdCliPath: string | null;
  nodePath: string;
  agentsFilePath: string;
  claudeMdPath: string;
  serverPort: number;
  clientPort: number;
}

export interface McpTool {
  name: string;
  description: string;
}

export interface McpInfo {
  config: McpConfigData;
  tools: McpTool[];
}

export interface McpStatus {
  qmdAvailable: boolean;
  error?: string;
  details?: string;
}

// --- Development types ---

export interface DevStatus {
  repoUrl: string | null;
  owner: string | null;
  repo: string | null;
  cloneStatus: "idle" | "cloning" | "cloned" | "error";
  cloneError: string | null;
  lastClonedAt: string | null;
  analysisStatus: "idle" | "running" | "done" | "error";
  analysisError: string | null;
  githubConnected: boolean;
}

export interface GitCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
}

export interface GitIssue {
  number: number;
  title: string;
  state: string;
  user: string;
  labels: string[];
  created_at: string;
}

export interface GitPR {
  number: number;
  title: string;
  state: string;
  user: string;
  head: string;
  base: string;
  created_at: string;
}

export interface EnvFile {
  filename: string;
  entries: { key: string; value: string }[];
}

// --- Skills types ---

export interface Skill {
  id: string;
  name: string;
  description: string;
  githubUrl: string;
  enabled: boolean;
  risk: "low" | "medium" | "high" | "unknown";
  riskNote: string;
  installed: boolean;
  curated: boolean;
  builtIn?: boolean;
}

// --- API ---

export const api = {
  // Services (GitHub, Airtable, Asana)
  getServicesStatus: () =>
    request<Record<string, ServiceStatus>>("/services/status"),

  getServicesConfig: () =>
    request<Record<string, ServiceConfig>>("/services/config"),

  connectService: (service: string, token: string, extras?: Record<string, string>) =>
    request<{ connected: boolean; user: string }>(`/services/${service}/connect`, {
      method: "POST",
      body: JSON.stringify({ token, ...extras }),
    }),

  disconnectService: (service: string) =>
    request<{ disconnected: boolean }>(`/services/${service}/disconnect`, {
      method: "POST",
    }),

  // Codex / ChatGPT auth (kept from v1)
  startChatGPTLogin: () =>
    request<DeviceCodeResponse>("/auth/chatgpt/start", { method: "POST" }),

  checkChatGPTLogin: () =>
    request<{ authenticated: boolean; method: string | null }>(
      "/auth/chatgpt/check",
      { method: "POST" }
    ),

  codexPing: () => request<CodexPing>("/codex/ping", { method: "POST" }),

  // Dashboard layout
  getDashboardConfig: () =>
    request<DashboardConfig>("/services/dashboard"),

  saveDashboardConfig: (config: DashboardConfig) =>
    request<{ ok: boolean }>("/services/dashboard", {
      method: "PUT",
      body: JSON.stringify(config),
    }),

  // MCP
  getMcpConfig: () => request<McpInfo>("/mcp/config"),

  updateMcpConfig: (config: Partial<McpConfigData>) =>
    request<{ ok: boolean }>("/mcp/config", {
      method: "PUT",
      body: JSON.stringify(config),
    }),

  getMcpStatus: () => request<McpStatus>("/mcp/status"),

  restartServer: (ports: { serverPort?: number; clientPort?: number }) =>
    request<{ ok: boolean; serverPort: number; clientPort: number }>("/mcp/restart", {
      method: "POST",
      body: JSON.stringify(ports),
    }),

  pickFile: () =>
    request<{ path: string }>("/mcp/pick-file", { method: "POST" }),

  // Development
  getDevStatus: () => request<DevStatus>("/dev/status"),

  setDevRepo: (repoUrl: string) =>
    request<{ ok: boolean }>("/dev/repo", {
      method: "POST",
      body: JSON.stringify({ repoUrl }),
    }),

  removeDevRepo: () =>
    request<{ ok: boolean }>("/dev/repo", { method: "DELETE" }),

  startClone: () =>
    request<{ ok: boolean }>("/dev/clone", { method: "POST" }),

  getDevCommits: () => request<GitCommit[]>("/dev/commits"),

  getDevIssues: () => request<GitIssue[]>("/dev/issues"),

  getDevPulls: () => request<GitPR[]>("/dev/pulls"),

  getDevEnvFiles: (reveal?: boolean) =>
    request<EnvFile[]>(`/dev/env${reveal ? "?reveal=true" : ""}`),

  updateDevEnvFile: (file: string, entries: { key: string; value: string }[]) =>
    request<{ ok: boolean }>("/dev/env", {
      method: "PUT",
      body: JSON.stringify({ file, entries }),
    }),

  startAnalysis: () =>
    request<{ ok: boolean }>("/dev/analyze", { method: "POST" }),

  // Skills
  getSkills: () => request<Skill[]>("/skills"),

  toggleSkill: (id: string) =>
    request<{ ok: boolean; enabled: boolean }>(`/skills/${id}/toggle`, {
      method: "PUT",
    }),

  addSkill: (githubUrl: string, name?: string, description?: string) =>
    request<Skill>("/skills", {
      method: "POST",
      body: JSON.stringify({ githubUrl, name, description }),
    }),

  removeSkill: (id: string) =>
    request<{ ok: boolean }>(`/skills/${id}`, { method: "DELETE" }),

  installSkill: (id: string) =>
    request<{ ok: boolean; installed: boolean; size: number }>(`/skills/${id}/install`, {
      method: "POST",
    }),

  uninstallSkill: (id: string) =>
    request<{ ok: boolean }>(`/skills/${id}/uninstall`, {
      method: "POST",
    }),
};
