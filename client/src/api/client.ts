const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });

  // On 401, fire event so App.tsx can redirect to login
  if (res.status === 401 && !path.startsWith("/dashboard-auth/")) {
    window.dispatchEvent(new Event("workbot-auth-expired"));
    throw new Error("Session expired");
  }

  const data = await res.json();
  if (!res.ok) {
    const err: any = new Error(data.error ?? "Request failed");
    if (data.needsOldPassword) err.needsOldPassword = true;
    throw err;
  }
  return data as T;
}

// --- Service types ---

export interface ServiceStatus {
  connected: boolean;
  user?: string;
  extras?: Record<string, string>;
  serviceType?: string;
  instanceName?: string;
}

export interface ConnectionField {
  key: string;
  label: string;
  placeholder: string;
  type: "text" | "password" | "textarea" | "number";
  required?: boolean;
  defaultValue?: string;
}

export interface ServiceConfig {
  name: string;
  kind?: "rest" | "connection";
  // REST fields
  tokenUrl?: string;
  tokenPrefix?: string;
  extraFields?: { key: string; label: string; placeholder: string }[];
  tokenLabel?: string;
  authNote?: string;
  difficulty?: string;
  oauth?: { scopes: string[]; redirectPath: string };
  // Connection fields
  connectionFields?: ConnectionField[];
  protocol?: string;
  defaultPort?: number;
  docsUrl?: string;
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

export interface DevProject {
  id: string;
  name: string;
  repoUrl: string;
  owner: string;
  repo: string;
  cloneStatus: "idle" | "cloning" | "cloned" | "error";
  cloneError: string | null;
  lastClonedAt: string | null;
  createdAt: string;
}

export interface DevStatus {
  projects: DevProject[];
  githubConnected: boolean;
  needsMigration?: boolean;
  // Legacy compat
  repoUrl?: string | null;
  owner?: string | null;
  repo?: string | null;
  cloneStatus?: string;
  cloneError?: string | null;
  lastClonedAt?: string | null;
  analysisStatus?: string;
  analysisError?: string | null;
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

  startOAuth: (service: string, allExtras: Record<string, string>) =>
    request<{ authUrl: string }>(`/services/${service}/oauth/start`, {
      method: "POST",
      body: JSON.stringify(allExtras),
    }),

  reauthOAuth: (service: string) =>
    request<{ authUrl: string }>(`/services/${service}/oauth/reauth`, {
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

  // Development migration + multi-project API
  migrateDevFolder: () =>
    request<{ ok: boolean; project?: any; message?: string }>("/dev/migrate", { method: "POST" }),
  addDevProject: (repoUrl: string, name?: string) =>
    request<DevProject>("/dev/projects", { method: "POST", body: JSON.stringify({ repoUrl, name }) }),
  removeDevProject: (id: string) =>
    request<{ ok: boolean }>(`/dev/projects/${id}`, { method: "DELETE" }),
  cloneDevProject: (id: string) =>
    request<{ ok: boolean }>(`/dev/projects/${id}/clone`, { method: "POST" }),
  getProjectCommits: (id: string) => request<GitCommit[]>(`/dev/projects/${id}/commits`),
  getProjectIssues: (id: string) => request<GitIssue[]>(`/dev/projects/${id}/issues`),
  getProjectPulls: (id: string) => request<GitPR[]>(`/dev/projects/${id}/pulls`),
  getProjectEnvFiles: (id: string, reveal?: boolean) =>
    request<EnvFile[]>(`/dev/projects/${id}/env${reveal ? "?reveal=true" : ""}`),

  // Legacy single-repo compat
  setDevRepo: (repoUrl: string) =>
    request<{ ok: boolean }>("/dev/repo", { method: "POST", body: JSON.stringify({ repoUrl }) }),
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

  // Dashboard auth
  checkSetupStatus: () =>
    request<{ setupComplete: boolean; hasEncryptedServices: boolean }>("/dashboard-auth/setup-status"),

  checkSession: () =>
    request<{ authenticated: boolean; username: string | null; role: string | null; subagentId: string | null }>("/dashboard-auth/session"),

  setup: (username: string, password: string, oldPassword?: string) =>
    request<{ ok: boolean; username: string; role: string }>("/dashboard-auth/setup", {
      method: "POST",
      body: JSON.stringify({ username, password, ...(oldPassword ? { oldPassword } : {}) }),
    }),

  login: (username: string, password: string) =>
    request<{ ok: boolean; username: string; role: string; subagentId: string | null }>("/dashboard-auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  dashboardLogout: () =>
    request<{ ok: boolean }>("/dashboard-auth/logout", { method: "POST" }),

  // User management (admin only)
  listUsers: () =>
    request<{ username: string; subagentId: string }[]>("/dashboard-auth/users"),

  createUser: (username: string, password: string, subagentId: string, keyHolder?: boolean) =>
    request<{ ok: boolean }>("/dashboard-auth/users", {
      method: "POST",
      body: JSON.stringify({ username, password, subagentId, keyHolder: !!keyHolder }),
    }),

  deleteUser: (username: string) =>
    request<{ ok: boolean }>(`/dashboard-auth/users/${encodeURIComponent(username)}`, { method: "DELETE" }),

  shutdown: () =>
    request<{ ok: boolean }>("/shutdown", { method: "POST" }),

  // Multi-instance service connections
  connectServiceInstance: (serviceType: string, token: string, instanceName: string, extras?: Record<string, string>) =>
    request<{ connected: boolean; user: string; instanceId: string }>(`/services/${serviceType}/connect`, {
      method: "POST",
      body: JSON.stringify({ token, instanceName, ...extras }),
    }),
  renameServiceInstance: (instanceId: string, name: string) =>
    request<{ ok: boolean; newInstanceId: string; name: string }>(`/services/${instanceId}/rename`, {
      method: "PUT",
      body: JSON.stringify({ name }),
    }),

  // Subagents
  getSubagents: () => request<any[]>("/subagents"),
  getSubagent: (id: string) => request<any>(`/subagents/${id}`),
  createSubagent: (data: { name: string; description?: string; allowedServices?: string[]; claudeAuth?: { mode: string }; bypassPermissions?: boolean }) =>
    request<any>("/subagents", { method: "POST", body: JSON.stringify(data) }),
  updateSubagent: (id: string, data: any) =>
    request<any>(`/subagents/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteSubagent: (id: string) =>
    request<{ ok: boolean }>(`/subagents/${id}`, { method: "DELETE" }),
  stopSubagent: (id: string) =>
    request<{ ok: boolean }>(`/subagents/${id}/stop`, { method: "POST" }),
  spawnSubagent: (id: string, prompt?: string) =>
    request<{ sessionId: string; pid: number }>(`/subagents/${id}/spawn`, {
      method: "POST",
      body: JSON.stringify({ prompt }),
    }),
  getSubagentServices: (id: string) =>
    request<Record<string, { connected: boolean; user?: string; allowed: boolean }>>(`/subagents/${id}/services`),
  startSubagentLogin: (id: string) =>
    request<{ started: boolean; verificationUrl?: string; userCode?: string; rawOutput?: string }>(`/subagents/${id}/auth/login`, { method: "POST" }),
  checkSubagentLogin: (id: string) =>
    request<{ authenticated: boolean; raw?: string }>(`/subagents/${id}/auth/check`, { method: "POST" }),
  setSubagentToken: (id: string, token: string) =>
    request<{ ok: boolean }>(`/subagents/${id}/auth/token`, { method: "POST", body: JSON.stringify({ token }) }),
  getSubagentAuthStatus: (id: string) =>
    request<{ mode: string; authenticated: boolean; raw?: string; hasCredentials?: boolean }>(`/subagents/${id}/auth/status`),
  subagentLogout: (id: string) =>
    request<{ ok: boolean }>(`/subagents/${id}/auth/logout`, { method: "POST" }),

  // Subagent terminals
  startTerminal: (id: string) =>
    request<{ url: string; port: number; pid?: number; alreadyRunning?: boolean }>(`/subagents/${id}/terminal`, { method: "POST" }),
  stopTerminal: (id: string) =>
    request<{ ok: boolean }>(`/subagents/${id}/terminal`, { method: "DELETE" }),

  // Workflows (scope = subagentId for scoped calls, undefined for host)
  getWorkflows: (scope?: string) => request<any[]>(scope ? `/subagents/${scope}/workflows` : "/workflows"),
  getWorkflow: (id: string, scope?: string) => request<any>(scope ? `/subagents/${scope}/workflows/${id}` : `/workflows/${id}`),
  createWorkflow: (data: any, scope?: string) => request<any>(scope ? `/subagents/${scope}/workflows` : "/workflows", { method: "POST", body: JSON.stringify(data) }),
  updateWorkflow: (id: string, data: any, scope?: string) => request<any>(scope ? `/subagents/${scope}/workflows/${id}` : `/workflows/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteWorkflow: (id: string, scope?: string) => request<{ ok: boolean }>(scope ? `/subagents/${scope}/workflows/${id}` : `/workflows/${id}`, { method: "DELETE" }),
  toggleWorkflow: (id: string, scope?: string) => request<{ ok: boolean; enabled: boolean }>(scope ? `/subagents/${scope}/workflows/${id}/toggle` : `/workflows/${id}/toggle`, { method: "PUT" }),
  triggerWorkflow: (id: string, triggerData?: any, scope?: string) =>
    request<{ runId: string; status: string }>(scope ? `/subagents/${scope}/workflows/${id}/run` : `/workflows/${id}/run`, { method: "POST", body: JSON.stringify({ triggerData }) }),
  getWorkflowRuns: (id: string, scope?: string) => request<any[]>(scope ? `/subagents/${scope}/workflows/${id}/runs` : `/workflows/${id}/runs`),
  getWorkflowRun: (workflowId: string, runId: string, scope?: string) => request<any>(scope ? `/subagents/${scope}/workflows/${workflowId}/runs/${runId}` : `/workflows/${workflowId}/runs/${runId}`),
  cancelWorkflowRun: (workflowId: string, runId: string, scope?: string) =>
    request<{ ok: boolean }>(scope ? `/subagents/${scope}/workflows/${workflowId}/runs/${runId}/cancel` : `/workflows/${workflowId}/runs/${runId}/cancel`, { method: "POST" }),

  // Logs (scope = subagentId for scoped calls)
  getMcpLogs: (params?: { limit?: number; offset?: number; tool?: string; scope?: string }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.offset) q.set("offset", String(params.offset));
    if (params?.tool) q.set("tool", params.tool);
    const qs = q.toString();
    const base = params?.scope ? `/subagents/${params.scope}/logs` : "/logs/mcp";
    return request<{ entries: any[]; total: number }>(`${base}${qs ? `?${qs}` : ""}`);
  },

  // Brain
  getBrains: () => request<BrainInfo[]>("/brain/brains"),
  getBrainNotes: (scope?: string) =>
    request<BrainNoteMeta[]>(`/brain/notes${scope ? `?scope=${scope}` : ""}`),
  getBrainNote: (path: string, scope?: string) =>
    request<BrainNote>(`/brain/notes/${path}${scope ? `?scope=${scope}` : ""}`),
  getBrainGraph: (scope?: string) =>
    request<BrainGraphData>(`/brain/graph${scope ? `?scope=${scope}` : ""}`),
  searchBrain: (q: string, scope?: string) =>
    request<BrainSearchResult[]>(`/brain/search?q=${encodeURIComponent(q)}${scope ? `&scope=${scope}` : ""}`),
  getBrainTree: (scope?: string) =>
    request<BrainTreeNode[]>(`/brain/tree${scope ? `?scope=${scope}` : ""}`),
  createBrainNote: (path: string, content: string, scope?: string, force?: boolean) =>
    request<{ ok: boolean; path: string; warnings: string[] }>("/brain/notes", {
      method: "POST",
      body: JSON.stringify({ path, content, scope, force }),
    }),
  updateBrainNote: (path: string, content: string, scope?: string, force?: boolean) =>
    request<{ ok: boolean; path: string; warnings: string[] }>(`/brain/notes/${path}`, {
      method: "PUT",
      body: JSON.stringify({ content, scope, force }),
    }),
  deleteBrainNote: (path: string, scope?: string) =>
    request<{ ok: boolean }>(`/brain/notes/${path}${scope ? `?scope=${scope}` : ""}`, { method: "DELETE" }),
};

// --- Brain types ---

export interface BrainInfo {
  id: string;
  label: string;
}

export interface BrainNoteMeta {
  path: string;
  title: string;
  tags: string[];
  aliases: string[];
  mtime: string | null;
}

export interface BrainNote extends BrainNoteMeta {
  content: string;
  frontmatter: Record<string, unknown>;
  outgoing: string[];
  incoming: string[];
}

export interface BrainGraphNode {
  id: string;
  title: string;
  tags: string[];
  connections: number;
}

export interface BrainGraphLink {
  source: string;
  target: string;
}

export interface BrainGraphData {
  nodes: BrainGraphNode[];
  links: BrainGraphLink[];
  titleToPath: Record<string, string>;
}

export interface BrainSearchResult extends BrainNoteMeta {
  snippet: string;
}

export interface BrainTreeNode {
  name: string;
  path: string;
  type: "folder" | "file";
  tags?: string[];
  children?: BrainTreeNode[];
}
