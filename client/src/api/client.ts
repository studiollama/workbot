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
};
