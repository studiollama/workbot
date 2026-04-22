import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { api } from "../api/client";
import { useServices } from "../context/ServicesContext";
import ServiceDrawer from "../components/ServiceDrawer";
import SettingsModal from "../components/SettingsModal";
import McpPanel from "../components/McpPanel";
import DevPanel from "../components/DevPanel";
import SkillsPanel from "../components/SkillsPanel";
import LogsPanel from "../components/LogsPanel";
import WorkflowsPanel from "../components/WorkflowsPanel";
import SubagentsPanel from "../components/SubagentsPanel";
import BrainPanel from "../components/BrainPanel";

// Brand logos from cdn.simpleicons.org (SVG, auto-colored)
const SERVICE_LOGOS: Record<string, { icon: string; color: string }> = {
  github:      { icon: "github", color: "white" },
  airtable:    { icon: "airtable", color: "18BFFF" },
  asana:       { icon: "asana", color: "F06A6A" },
  zendesk:     { icon: "zendesk", color: "03363D" },
  squarespace: { icon: "squarespace", color: "000000" },
  freshdesk:   { icon: "freshdesk", color: "058B38" },
  quickbooks:  { icon: "quickbooks", color: "2CA01C" },
  googleads:   { icon: "googleads", color: "4285F4" },
  canva:       { icon: "canva", color: "00C4CC" },
  gmail:       { icon: "gmail", color: "EA4335" },
  stripe:      { icon: "stripe", color: "635BFF" },
  supabase:    { icon: "supabase", color: "3FCF8E" },
  render:      { icon: "render", color: "46E3B7" },
  postgresql:  { icon: "postgresql", color: "4169E1" },
  betterstack: { icon: "betterstack", color: "4CE47C" },
  guru:        { icon: "guru", color: "5CC7C1" },
  // oracle uses inline SVG below (not on simpleicons)
  dagster:     { icon: "dagster", color: "4F43DD" },
};

// Fallback text icons for services without simple-icons
const SERVICE_ICONS: Record<string, string> = {
  codex: "CX",
  entra: "EN",
  intune: "IN",
  security: "SC",
  nanobanana: "NB",
  jules: "JL",
  sharepoint: "SP",
  outlook: "OL",
  googleadmin: "GC",
  ticktick: "TT",
  readai: "RA",
  oracle: "OR",
  postgresql: "PG",
  ssh: "SSH",
  sftp: "SF",
  ftp: "FTP",
  telnet: "TN",
  winrm: "WR",
};

// Microsoft services use the MS logo
const MS_SERVICES = new Set(["entra", "intune", "security", "sharepoint", "outlook", "winrm"]);

interface DashboardProps {
  onLogout: () => void;
}

export default function Dashboard({ onLogout }: DashboardProps) {
  const { services, config, enabledServices, workbotName, loading, refresh, setEnabledServices } =
    useServices();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { tab: urlTab, "*": urlRest } = useParams();
  const navigate = useNavigate();
  const validTabs = ["services", "agents", "brain", "workflows", "mcp", "skills", "logs", "development"] as const;
  type TabKey = typeof validTabs[number];
  const activeTab: TabKey = validTabs.includes(urlTab as any) ? (urlTab as TabKey) : "services";
  const setActiveTab = (tab: TabKey) => navigate(`/${tab}${tab === "brain" && urlRest ? `/${urlRest}` : ""}`);
  const [subagents, setSubagents] = useState<any[]>([]);

  const fetchSubagents = useCallback(async () => {
    try { setSubagents(await api.getSubagents()); } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchSubagents(); }, [fetchSubagents]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-gray-600 border-t-gray-200 rounded-full animate-spin" />
      </div>
    );
  }

  const tabs = [
    { key: "services", label: "Services" },
    { key: "agents", label: "Agents" },
    { key: "brain", label: "Brain" },
    { key: "workflows", label: "Workflows" },
    { key: "mcp", label: "MCP" },
    { key: "skills", label: "Skills" },
    { key: "logs", label: "Logs" },
    { key: "development", label: "Dev" },
  ] as const;

  const isBrainTab = activeTab === "brain";

  return (
    <div className="min-h-screen p-3 sm:p-6">
      <div className={`mx-auto space-y-4 sm:space-y-6 transition-all ${isBrainTab ? "max-w-7xl" : "max-w-3xl"}`}>
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg sm:text-2xl font-bold truncate">{workbotName}</h1>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              onClick={async () => {
                if (!confirm("Shut down the workbot container?\n\nThis will stop all sessions, subagents, and the dashboard.\nThe container will need to be restarted manually.")) return;
                try { await api.shutdown(); } catch {}
              }}
              className="p-1.5 sm:p-2 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-500 hover:text-red-600 dark:bg-red-900/40 dark:hover:bg-red-800 dark:text-red-400 dark:hover:text-red-300 transition"
              title="Shutdown container"
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 2v8" /><path d="M14.5 4.5a7 7 0 11-9 0" />
              </svg>
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="p-1.5 sm:p-2 rounded-lg bg-surface-input hover:bg-surface-hover text-theme-secondary hover:text-theme-primary transition"
              title="Settings"
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
                <path d="M16.2 12.8a1.3 1.3 0 00.26 1.43l.05.05a1.575 1.575 0 11-2.23 2.23l-.05-.05a1.3 1.3 0 00-1.43-.26 1.3 1.3 0 00-.79 1.19v.14a1.575 1.575 0 11-3.15 0v-.07a1.3 1.3 0 00-.85-1.19 1.3 1.3 0 00-1.43.26l-.05.05a1.575 1.575 0 11-2.23-2.23l.05-.05a1.3 1.3 0 00.26-1.43 1.3 1.3 0 00-1.19-.79h-.14a1.575 1.575 0 110-3.15h.07a1.3 1.3 0 001.19-.85 1.3 1.3 0 00-.26-1.43l-.05-.05a1.575 1.575 0 112.23-2.23l.05.05a1.3 1.3 0 001.43.26h.06a1.3 1.3 0 00.79-1.19v-.14a1.575 1.575 0 013.15 0v.07a1.3 1.3 0 00.79 1.19 1.3 1.3 0 001.43-.26l.05-.05a1.575 1.575 0 112.23 2.23l-.05.05a1.3 1.3 0 00-.26 1.43v.06a1.3 1.3 0 001.19.79h.14a1.575 1.575 0 010 3.15h-.07a1.3 1.3 0 00-1.19.79z" />
              </svg>
            </button>
            <button
              onClick={async () => { await api.dashboardLogout(); onLogout(); }}
              className="p-1.5 sm:p-2 rounded-lg bg-surface-input hover:bg-surface-hover text-theme-secondary hover:text-theme-primary transition"
              title="Sign out"
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M7 17H4a1 1 0 01-1-1V4a1 1 0 011-1h3" /><path d="M14 14l3-4-3-4" /><path d="M17 10H7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tab bar — scrollable on mobile */}
        <div className="overflow-x-auto -mx-3 sm:-mx-0 px-3 sm:px-0 scrollbar-hide">
          <div className="flex gap-0.5 border-b border-theme min-w-max">
            {tabs.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key as TabKey)}
                className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition border-b-2 -mb-px whitespace-nowrap ${
                  activeTab === key
                    ? "border-accent-500 text-theme-primary"
                    : "border-transparent text-theme-secondary hover:text-theme-primary"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {activeTab === "mcp" && <McpPanel />}
        {activeTab === "development" && <DevPanel />}
        {activeTab === "skills" && <SkillsPanel />}
        {activeTab === "workflows" && <WorkflowsPanel />}
        {activeTab === "agents" && <SubagentsPanel />}
        {activeTab === "logs" && <LogsPanel />}
        {activeTab === "brain" && <BrainPanel />}

        {activeTab === "services" && (() => {
          const isServiceConnected = (key: string) =>
            services[key]?.connected ||
            Object.values(services).some((s) => s.serviceType === key && s.connected);
          const connected = enabledServices.filter(isServiceConnected);
          const disconnected = enabledServices.filter((key) => !isServiceConnected(key));

          function handleDisableAll() {
            const connectedOnly = enabledServices.filter(
              (key) => services[key]?.connected
            );
            setEnabledServices(connectedOnly);
          }

          const hasDisconnectedEnabled = enabledServices.some(
            (key) => !services[key]?.connected
          );

          const toggleButton = (
            <div className="flex items-center gap-2">
              {hasDisconnectedEnabled && (
                <button
                  onClick={handleDisableAll}
                  className="text-xs text-theme-secondary hover:text-theme-primary transition"
                >
                  Hide disconnected
                </button>
              )}
              <button
                onClick={() => setDrawerOpen(true)}
                className="p-1.5 rounded-lg bg-surface-input hover:bg-surface-hover text-theme-secondary hover:text-theme-primary transition"
                title="Enable / disable services"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <line x1="2" y1="4" x2="14" y2="4" />
                  <line x1="2" y1="8" x2="14" y2="8" />
                  <line x1="2" y1="12" x2="14" y2="12" />
                  <circle cx="5" cy="4" r="1.5" fill="currentColor" />
                  <circle cx="11" cy="8" r="1.5" fill="currentColor" />
                  <circle cx="7" cy="12" r="1.5" fill="currentColor" />
                </svg>
              </button>
            </div>
          );

          const renderCard = (key: string) => (
            <ServiceCard
              key={key}
              serviceKey={key}
              name={config[key]?.name ?? key}
              tokenUrl={config[key]?.tokenUrl ?? ""}
              tokenPrefix={config[key]?.tokenPrefix ?? ""}
              tokenLabel={config[key]?.tokenLabel}
              authNote={config[key]?.authNote}
              difficulty={config[key]?.difficulty}
              extraFields={config[key]?.extraFields}
              oauth={config[key]?.oauth}
              kind={config[key]?.kind}
              connectionFields={config[key]?.connectionFields}
              status={services[key] ?? Object.values(services).find((s) => s.serviceType === key && s.connected) ?? { connected: false }}
              allServices={services}
              onUpdate={refresh}
              subagents={subagents}
              onSubagentsChange={fetchSubagents}
            />
          );

          return (
            <>
              {connected.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-theme-secondary uppercase tracking-wider">
                      Connected ({connected.length})
                    </p>
                    {toggleButton}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {connected.map(renderCard)}
                  </div>
                </div>
              )}

              {disconnected.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-theme-secondary uppercase tracking-wider">
                      Available ({disconnected.length})
                    </p>
                    {connected.length === 0 && toggleButton}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {disconnected.map(renderCard)}
                  </div>
                </div>
              )}

              {enabledServices.length === 0 && (
                <div className="bg-surface-card/50 border border-theme border-dashed rounded-xl p-8 text-center text-theme-muted space-y-3">
                  <p>No services enabled.</p>
                  <button
                    onClick={() => setDrawerOpen(true)}
                    className="text-sm text-accent-400 hover:text-accent-300 transition"
                  >
                    Add services
                  </button>
                </div>
              )}
            </>
          );
        })()}

      </div>

      <ServiceDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}

const DIFFICULTY_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  "API Key": { bg: "bg-green-500/15", text: "text-green-600", border: "border border-green-500/30" },
  "API Key + Config": { bg: "bg-blue-500/15", text: "text-blue-600", border: "border border-blue-500/30" },
  "OAuth Token": { bg: "bg-yellow-500/15", text: "text-yellow-600", border: "border border-yellow-500/30" },
  "OAuth + Credentials": { bg: "bg-yellow-500/15", text: "text-yellow-600", border: "border border-yellow-500/30" },
  "Admin + OAuth": { bg: "bg-orange-500/15", text: "text-orange-600", border: "border border-orange-500/30" },
  "Enterprise App": { bg: "bg-purple-500/15", text: "text-purple-600", border: "border border-purple-500/30" },
  "Device Login": { bg: "bg-surface-hover/50", text: "text-theme-muted", border: "border border-theme" },
};

function InstanceRow({ instId, inst, onUpdate }: {
  instId: string;
  inst: { instanceName?: string; user?: string };
  onUpdate: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(inst.instanceName || instId);
  const [busy, setBusy] = useState(false);

  async function handleRename() {
    if (!name.trim() || name === inst.instanceName) { setEditing(false); return; }
    setBusy(true);
    try {
      await api.renameServiceInstance(instId, name.trim());
      await onUpdate();
    } catch { /* ignore */ }
    finally { setBusy(false); setEditing(false); }
  }

  return (
    <div className="flex items-center justify-between bg-surface-input/50 rounded px-2 py-1.5 gap-2">
      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="flex gap-1">
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") setEditing(false); }}
              className="flex-1 px-1 py-0.5 bg-surface-input border border-theme-input rounded text-xs text-theme-primary focus:outline-none focus:ring-1 focus:ring-accent-500" />
            <button onClick={handleRename} disabled={busy} className="text-[10px] text-accent-400">{busy ? "..." : "save"}</button>
            <button onClick={() => setEditing(false)} className="text-[10px] text-theme-muted">cancel</button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs text-theme-primary font-medium truncate" title={instId}>{inst.instanceName || instId}</span>
            {inst.user && <span className="text-[10px] text-theme-muted truncate max-w-[120px]" title={inst.user}>{inst.user}</span>}
            <button onClick={() => setEditing(true)} className="text-[10px] text-theme-muted hover:text-accent-400 transition shrink-0">rename</button>
          </div>
        )}
      </div>
      <button onClick={async () => {
        try { await api.disconnectService(instId); await onUpdate(); } catch {}
      }} className="text-[10px] text-theme-muted hover:text-red-400 transition shrink-0">remove</button>
    </div>
  );
}

function ServiceCard({
  serviceKey,
  name,
  tokenUrl,
  tokenPrefix,
  tokenLabel,
  authNote,
  difficulty,
  extraFields,
  oauth,
  kind,
  connectionFields,
  status,
  allServices,
  onUpdate,
  subagents,
  onSubagentsChange,
}: {
  serviceKey: string;
  name: string;
  tokenUrl: string;
  tokenPrefix: string;
  tokenLabel?: string;
  authNote?: string;
  difficulty?: string;
  extraFields?: { key: string; label: string; placeholder: string }[];
  oauth?: { scopes: string[]; redirectPath: string };
  kind?: string;
  connectionFields?: { key: string; label: string; placeholder: string; type: string; required?: boolean; defaultValue?: string }[];
  status: { connected: boolean; user?: string };
  allServices: Record<string, any>;
  onUpdate: () => Promise<void>;
  subagents: any[];
  onSubagentsChange: () => void;
}) {
  const [token, setToken] = useState("");
  const [instanceName, setInstanceName] = useState("Default");
  const [extras, setExtras] = useState<Record<string, string>>(status.extras ?? {});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showManualToken, setShowManualToken] = useState(false);
  const [showAgents, setShowAgents] = useState(false);
  const [showAddInstance, setShowAddInstance] = useState(false);
  const [newInstanceName, setNewInstanceName] = useState("");
  const [newInstanceToken, setNewInstanceToken] = useState("");
  const [newInstanceExtras, setNewInstanceExtras] = useState<Record<string, string>>({});

  async function toggleAgentService(agentId: string, currentServices: string[], instanceId?: string) {
    const key = instanceId || serviceKey;
    const updated = currentServices.includes(key)
      ? currentServices.filter((k) => k !== key)
      : [...currentServices, key];
    try {
      await api.updateSubagent(agentId, { allowedServices: updated });
      onSubagentsChange();
    } catch { /* ignore */ }
  }

  // Codex device code flow state
  const [deviceCode, setDeviceCode] = useState<{
    url: string;
    code: string;
  } | null>(null);
  const [polling, setPolling] = useState(false);

  const isCodex = serviceKey === "codex";

  async function handleConnect(e?: React.FormEvent) {
    e?.preventDefault();
    // Connection services: token comes from extras, REST services need explicit token
    if (kind !== "connection" && !token.trim()) return;
    // Validate extra fields (REST)
    if (extraFields) {
      for (const field of extraFields) {
        if (!extras[field.key]?.trim()) {
          setError(`${field.label} is required`);
          return;
        }
      }
    }
    // Validate connection fields
    if (connectionFields) {
      for (const field of connectionFields) {
        if (field.required && !extras[field.key]?.trim()) {
          setError(`${field.label} is required`);
          return;
        }
      }
    }
    setError("");
    setBusy(true);
    try {
      // For connection services, pass a placeholder token and all fields as extras
      const connectToken = kind === "connection" ? (token || extras.config || extras.password || "connection") : token;
      const connectExtras = kind === "connection" ? extras : (extraFields ? extras : undefined);
      await api.connectServiceInstance(
        serviceKey,
        connectToken,
        instanceName.trim() || "Default",
        connectExtras
      );
      setToken("");
      setExtras({});
      setShowForm(false);
      await onUpdate();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCodexLogin() {
    setError("");
    setBusy(true);
    try {
      const res = await api.startChatGPTLogin();
      if (res.authenticated) {
        await onUpdate();
        return;
      }
      if (res.verificationUrl && res.userCode) {
        setDeviceCode({ url: res.verificationUrl, code: res.userCode });
        setPolling(true);
        const interval = setInterval(async () => {
          try {
            const check = await api.checkChatGPTLogin();
            if (check.authenticated) {
              clearInterval(interval);
              setPolling(false);
              setDeviceCode(null);
              await onUpdate();
            }
          } catch {
            // keep polling
          }
        }, 3000);
        setTimeout(() => {
          clearInterval(interval);
          setPolling(false);
        }, 300000);
      } else if (res.error) {
        setError(res.error);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleOAuthStart() {
    if (!extras["client_id"]?.trim() || !extras["client_secret"]?.trim()) {
      setError("Client ID and Client Secret are required");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const { authUrl } = await api.startOAuth(serviceKey, extras);
      const popup = window.open(authUrl, "oauth-popup", "width=500,height=700");

      const handler = (event: MessageEvent) => {
        if (event.data?.type === "oauth-success") {
          window.removeEventListener("message", handler);
          popup?.close();
          setShowForm(false);
          setExtras({});
          onUpdate();
        }
      };
      window.addEventListener("message", handler);

      // Poll for popup close as fallback
      const interval = setInterval(() => {
        if (popup?.closed) {
          clearInterval(interval);
          window.removeEventListener("message", handler);
          onUpdate();
        }
      }, 2000);
      setTimeout(() => {
        clearInterval(interval);
        window.removeEventListener("message", handler);
      }, 300_000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      await api.disconnectService(serviceKey);
      await onUpdate();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Determine the placeholder for the token input
  const tokenPlaceholder = tokenLabel
    ? tokenLabel
    : tokenPrefix
      ? `${tokenPrefix}...`
      : "API Token";

  return (
    <div className="glass-card p-4 sm:p-5 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-surface-input flex items-center justify-center overflow-hidden shrink-0">
            {SERVICE_LOGOS[serviceKey] ? (
              <img
                src={`https://cdn.simpleicons.org/${SERVICE_LOGOS[serviceKey].icon}/${SERVICE_LOGOS[serviceKey].color}`}
                alt={name}
                className="w-6 h-6"
                loading="lazy"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; (e.target as HTMLImageElement).parentElement!.innerHTML = `<span class="text-[10px] font-bold text-theme-secondary">${SERVICE_ICONS[serviceKey] ?? serviceKey.substring(0, 2).toUpperCase()}</span>`; }}
              />
            ) : serviceKey === "oracle" ? (
              <svg className="w-7 h-7" viewBox="0 0 24 24" fill="#F80000"><path d="M7.076 7.076C4.952 7.076 3.215 8.813 3.215 10.937v2.126c0 2.124 1.737 3.861 3.861 3.861h9.848c2.124 0 3.861-1.737 3.861-3.861v-2.126c0-2.124-1.737-3.861-3.861-3.861H7.076zm9.848 1.693c1.197 0 2.168.971 2.168 2.168v2.126c0 1.197-.971 2.168-2.168 2.168H7.076c-1.197 0-2.168-.971-2.168-2.168v-2.126c0-1.197.971-2.168 2.168-2.168h9.848z"/></svg>
            ) : MS_SERVICES.has(serviceKey) ? (
              <img
                src="https://cdn.simpleicons.org/microsoft/00A4EF"
                alt={name}
                className="w-6 h-6"
                loading="lazy"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; (e.target as HTMLImageElement).parentElement!.innerHTML = `<span class="text-[10px] font-bold text-theme-secondary">MS</span>`; }}
              />
            ) : (
              <span className="text-[10px] font-bold text-theme-secondary">{SERVICE_ICONS[serviceKey] ?? serviceKey.substring(0, 2).toUpperCase()}</span>
            )}
          </div>
          <div className="min-w-0">
            <h3 className="font-medium truncate">{name}</h3>
            {status.connected && status.user && (
              <p className="text-xs text-theme-secondary truncate">{status.user}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {difficulty && (() => {
            const style = DIFFICULTY_STYLES[difficulty] ?? DIFFICULTY_STYLES["API Key"];
            return (
              <span className={`w-2 h-2 rounded-full ${style.bg}`} title={difficulty} />
            );
          })()}
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              status.connected ? "bg-green-500" : "bg-surface-hover border border-theme"
            }`}
            title={status.connected ? "Connected" : "Not connected"}
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-900/50 border border-red-700 rounded-lg p-2 text-red-300 text-xs">
          {error}
        </div>
      )}

      {/* Connected state */}
      {status.connected && (
        <div className="space-y-2">
        <div className="flex items-center gap-3">
          <button
            onClick={handleDisconnect}
            disabled={busy}
            className="text-sm text-theme-secondary hover:text-red-400 transition"
          >
            Disconnect
          </button>
          {subagents.length > 0 && (
            <button
              onClick={() => setShowAgents(!showAgents)}
              className="text-sm text-accent-400 hover:text-accent-300 transition"
            >
              Agents ({subagents.filter((a) => a.allowedServices?.some((s: string) => s === serviceKey || s.startsWith(serviceKey + ":"))).length}/{subagents.length})
            </button>
          )}
          {oauth && (
            <button
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const { authUrl } = await api.reauthOAuth(serviceKey);
                  const popup = window.open(authUrl, "oauth-popup", "width=500,height=700");
                  const handler = (event: MessageEvent) => {
                    if (event.data?.type === "oauth-success") {
                      window.removeEventListener("message", handler);
                      popup?.close();
                      onUpdate();
                    }
                  };
                  window.addEventListener("message", handler);
                  const interval = setInterval(() => {
                    if (popup?.closed) {
                      clearInterval(interval);
                      window.removeEventListener("message", handler);
                      onUpdate();
                    }
                  }, 2000);
                  setTimeout(() => { clearInterval(interval); window.removeEventListener("message", handler); }, 300_000);
                } catch (err: any) {
                  setError(err.message);
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
              className="text-sm text-blue-400 hover:text-blue-300 transition"
            >
              Re-authorize
            </button>
          )}
        </div>
        {/* Assign to Agents popup — shows all instances of this type */}
        {showAgents && (() => {
          const instances = Object.entries(allServices).filter(
            ([k, v]) => v.connected && (v.serviceType === serviceKey || k === serviceKey)
          );
          return (
            <div className="bg-surface-input/50 rounded-lg p-3 space-y-2">
              <p className="text-[10px] text-theme-muted">Toggle which subagents can access {name}</p>
              {subagents.map((agent) => (
                <div key={agent.id} className="space-y-1">
                  <p className="text-xs text-theme-secondary font-medium">{agent.name}</p>
                  <div className="flex flex-wrap gap-1 ml-2">
                    {instances.map(([instId, instStatus]) => {
                      const instName = instStatus.instanceName || instId;
                      const assigned = agent.allowedServices?.includes(instId);
                      return (
                        <button key={instId} onClick={() => toggleAgentService(agent.id, agent.allowedServices ?? [], instId)}
                          className={`px-2 py-0.5 text-[10px] rounded transition ${
                            assigned ? "bg-accent-600/30 text-accent-300 border border-accent-500/40" : "bg-surface-input text-theme-muted border border-transparent hover:border-theme-input"
                          }`}>
                          {assigned ? "+" : ""} {instName}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}

        {/* All instances of this type */}
        {(() => {
          const allInstances = Object.entries(allServices).filter(
            ([, v]) => v.connected && v.serviceType === serviceKey
          );
          if (allInstances.length === 0) return null;
          return (
            <div className="space-y-1">
              <p className="text-[10px] text-theme-muted uppercase tracking-wider">Instances ({allInstances.length})</p>
              {allInstances.map(([instId, inst]) => (
                <InstanceRow key={instId} instId={instId} inst={inst} onUpdate={onUpdate} />
              ))}
            </div>
          );
        })()}

        {/* Add Instance button + form */}
        {!showAddInstance ? (
          <button onClick={() => setShowAddInstance(true)} className="text-xs text-accent-400 hover:text-accent-300 transition">
            + Add Instance
          </button>
        ) : (
          <div className="bg-surface-input/50 rounded-lg p-3 space-y-2">
            <input value={newInstanceName} onChange={(e) => setNewInstanceName(e.target.value)} placeholder="Instance name (e.g. Read Only)" autoFocus
              className="w-full px-2 py-1.5 bg-surface-input border border-theme-input rounded text-xs text-theme-primary focus:outline-none focus:ring-1 focus:ring-accent-500" />
            {kind === "connection" && connectionFields ? (
              <>
                {connectionFields.map((field) => (
                  <div key={field.key} className="space-y-1">
                    <label className="text-xs text-theme-secondary">{field.label}{field.required && <span className="text-red-400 ml-0.5">*</span>}</label>
                    {field.type === "textarea" ? (
                      <textarea
                        placeholder={field.placeholder}
                        value={newInstanceExtras[field.key] ?? field.defaultValue ?? ""}
                        onChange={(e) => setNewInstanceExtras({ ...newInstanceExtras, [field.key]: e.target.value })}
                        rows={8}
                        className="w-full px-2 py-1.5 bg-surface-input border border-theme-input rounded text-xs font-mono focus:outline-none focus:ring-1 focus:ring-accent-500 resize-y"
                      />
                    ) : (
                      <input
                        type={field.type === "password" ? "password" : field.type === "number" ? "number" : "text"}
                        placeholder={field.placeholder}
                        value={newInstanceExtras[field.key] ?? field.defaultValue ?? ""}
                        onChange={(e) => setNewInstanceExtras({ ...newInstanceExtras, [field.key]: e.target.value })}
                        className="w-full px-2 py-1.5 bg-surface-input border border-theme-input rounded text-xs focus:outline-none focus:ring-1 focus:ring-accent-500"
                      />
                    )}
                  </div>
                ))}
              </>
            ) : (
              <>
                <input type="password" value={newInstanceToken} onChange={(e) => setNewInstanceToken(e.target.value)}
                  placeholder={tokenLabel || (tokenPrefix ? `${tokenPrefix}...` : "API Token")}
                  className="w-full px-2 py-1.5 bg-surface-input border border-theme-input rounded text-xs text-theme-primary focus:outline-none focus:ring-1 focus:ring-accent-500 font-mono" />
                {extraFields?.map((field) => (
                  <input key={field.key} value={newInstanceExtras[field.key] || ""} onChange={(e) => setNewInstanceExtras({ ...newInstanceExtras, [field.key]: e.target.value })}
                    placeholder={field.placeholder}
                    className="w-full px-2 py-1.5 bg-surface-input border border-theme-input rounded text-xs text-theme-primary focus:outline-none focus:ring-1 focus:ring-accent-500" />
                ))}
              </>
            )}
            <div className="flex gap-2">
              <button onClick={async () => {
                if (!newInstanceName.trim()) return;
                if (kind === "connection" && connectionFields) {
                  for (const field of connectionFields) {
                    if (field.required && !newInstanceExtras[field.key]?.trim()) {
                      setError(`${field.label} is required`);
                      return;
                    }
                  }
                } else if (!newInstanceToken.trim()) return;
                setBusy(true);
                setError("");
                try {
                  const connectToken = kind === "connection" ? (newInstanceExtras.config || newInstanceExtras.password || "connection") : newInstanceToken;
                  const connectExtras = kind === "connection" ? newInstanceExtras : (extraFields ? newInstanceExtras : undefined);
                  await api.connectServiceInstance(serviceKey, connectToken, newInstanceName, connectExtras);
                  setNewInstanceName(""); setNewInstanceToken(""); setNewInstanceExtras({}); setShowAddInstance(false);
                  await onUpdate();
                } catch (err: any) { setError(err.message); } finally { setBusy(false); }
              }} disabled={busy || !newInstanceName.trim()}
                className="px-3 py-1 bg-accent-600 hover:bg-accent-700 text-white text-xs rounded transition disabled:opacity-50">
                {busy ? "..." : "Connect"}
              </button>
              <button onClick={() => { setShowAddInstance(false); setNewInstanceName(""); setNewInstanceToken(""); setNewInstanceExtras({}); setError(""); }}
                className="px-3 py-1 text-xs text-theme-secondary hover:text-theme-primary transition">Cancel</button>
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
          </div>
        )}
        </div>
      )}

      {/* Disconnected state — Connection services (WireGuard, PostgreSQL, SSH, etc.) */}
      {!status.connected && !isCodex && kind === "connection" && connectionFields && (
        <>
          {!showForm ? (
            <button
              onClick={() => setShowForm(true)}
              className="w-full bg-accent-600 hover:bg-accent-700 text-white text-sm font-medium py-2 px-4 rounded-lg transition"
            >
              Connect
            </button>
          ) : (
            <form onSubmit={handleConnect} className="space-y-2">
              <input
                type="text"
                placeholder="Instance name (e.g. Default, Office VPN)"
                value={instanceName}
                onChange={(e) => setInstanceName(e.target.value)}
                className="w-full bg-surface-input border border-theme-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
              />
              {connectionFields.map((field) => (
                <div key={field.key} className="space-y-1">
                  <label className="text-xs text-theme-secondary">{field.label}{field.required && <span className="text-red-400 ml-0.5">*</span>}</label>
                  {field.type === "textarea" ? (
                    <textarea
                      placeholder={field.placeholder}
                      value={extras[field.key] ?? field.defaultValue ?? ""}
                      onChange={(e) => setExtras((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      rows={8}
                      className="w-full bg-surface-input border border-theme-input rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-accent-500 resize-y"
                    />
                  ) : field.type === "password" ? (
                    <input
                      type="password"
                      placeholder={field.placeholder}
                      value={extras[field.key] ?? ""}
                      onChange={(e) => setExtras((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      className="w-full bg-surface-input border border-theme-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
                    />
                  ) : field.type === "number" ? (
                    <input
                      type="number"
                      placeholder={field.placeholder}
                      value={extras[field.key] ?? field.defaultValue ?? ""}
                      onChange={(e) => setExtras((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      className="w-full bg-surface-input border border-theme-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
                    />
                  ) : (
                    <input
                      type="text"
                      placeholder={field.placeholder}
                      value={extras[field.key] ?? field.defaultValue ?? ""}
                      onChange={(e) => setExtras((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      className="w-full bg-surface-input border border-theme-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
                    />
                  )}
                </div>
              ))}
              {tokenLabel && (
                <div className="space-y-1">
                  <label className="text-xs text-theme-secondary">{tokenLabel}</label>
                  {tokenLabel.toLowerCase().includes("key") || tokenLabel.toLowerCase().includes("json") ? (
                    <textarea
                      placeholder={tokenLabel}
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      rows={4}
                      className="w-full bg-surface-input border border-theme-input rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-accent-500 resize-y"
                    />
                  ) : (
                    <input
                      type="password"
                      placeholder={tokenLabel}
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      className="w-full bg-surface-input border border-theme-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
                    />
                  )}
                </div>
              )}
              {authNote && <p className="text-xs text-yellow-400">{authNote}</p>}
              {error && <p className="text-xs text-red-400">{error}</p>}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="flex-1 bg-accent-600 hover:bg-accent-700 disabled:opacity-50 text-white text-sm font-medium py-2 px-4 rounded-lg transition"
                >
                  {busy ? "Connecting..." : "Connect"}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setExtras({}); setToken(""); setError(""); }}
                  className="text-sm text-theme-secondary hover:text-theme-primary px-3"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </>
      )}

      {/* Disconnected state — PAT services */}
      {!status.connected && !isCodex && kind !== "connection" && (
        <>
          {!showForm ? (
            <button
              onClick={() => setShowForm(true)}
              className="w-full bg-accent-600 hover:bg-accent-700 text-white text-sm font-medium py-2 px-4 rounded-lg transition"
            >
              Connect
            </button>
          ) : (
            <form onSubmit={handleConnect} className="space-y-2">
              {/* Instance name */}
              <input
                type="text"
                placeholder="Instance name (e.g. Default, Read Only, Production)"
                value={instanceName}
                onChange={(e) => setInstanceName(e.target.value)}
                className="w-full bg-surface-input border border-theme-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
              />
              {/* OAuth services: show credential fields + sign-in button */}
              {oauth && extraFields ? (
                <>
                  {extraFields.map((field) => (
                    <div key={field.key} className="space-y-1">
                      <label className="text-xs text-theme-secondary">{field.label}</label>
                      <input
                        type={field.key.includes("secret") ? "password" : "text"}
                        placeholder={field.placeholder}
                        value={extras[field.key] ?? ""}
                        onChange={(e) =>
                          setExtras((prev) => ({
                            ...prev,
                            [field.key]: e.target.value,
                          }))
                        }
                        className="w-full bg-surface-input border border-theme-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
                      />
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={handleOAuthStart}
                    disabled={busy}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2.5 px-4 rounded-lg transition flex items-center justify-center gap-2"
                  >
                    <svg width="16" height="16" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                    {busy ? "Opening..." : "Sign in with Google"}
                  </button>

                  {/* Manual token fallback */}
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setShowManualToken(!showManualToken)}
                      className="text-xs text-theme-secondary hover:text-theme-primary transition"
                    >
                      {showManualToken ? "Hide manual entry" : "Or paste a refresh token manually"}
                    </button>
                  </div>
                  {showManualToken && (
                    <>
                      <input
                        type="password"
                        placeholder={tokenPlaceholder}
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        className="w-full bg-surface-input border border-theme-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
                      />
                      <button
                        type="submit"
                        disabled={busy || !token.trim()}
                        className="w-full bg-accent-600 hover:bg-accent-700 disabled:opacity-50 text-white text-sm font-medium py-2 px-4 rounded-lg transition"
                      >
                        {busy ? "Validating..." : "Connect with Token"}
                      </button>
                    </>
                  )}

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setShowForm(false);
                        setToken("");
                        setExtras({});
                        setError("");
                        setShowManualToken(false);
                      }}
                      className="text-sm text-theme-secondary hover:text-theme-primary px-1"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {/* Standard token flow */}
                  {extraFields?.map((field) => (
                    <input
                      key={field.key}
                      type="text"
                      placeholder={field.placeholder}
                      value={extras[field.key] ?? ""}
                      onChange={(e) =>
                        setExtras((prev) => ({
                          ...prev,
                          [field.key]: e.target.value,
                        }))
                      }
                      className="w-full bg-surface-input border border-theme-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
                    />
                  ))}
                  {tokenLabel?.toLowerCase().includes("json") ? (
                    <textarea
                      placeholder={tokenPlaceholder}
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      rows={6}
                      className="w-full bg-surface-input border border-theme-input rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-accent-500 resize-y"
                    />
                  ) : (
                    <input
                      type="password"
                      placeholder={tokenPlaceholder}
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      className="w-full bg-surface-input border border-theme-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
                    />
                  )}
                  {authNote && (
                    <p className="text-xs text-yellow-400">{authNote}</p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={busy || !token.trim()}
                      className="flex-1 bg-accent-600 hover:bg-accent-700 disabled:opacity-50 text-white text-sm font-medium py-2 px-4 rounded-lg transition"
                    >
                      {busy ? "Validating..." : "Connect"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowForm(false);
                        setToken("");
                        setExtras({});
                        setError("");
                      }}
                      className="text-sm text-theme-secondary hover:text-theme-primary px-3"
                    >
                      Cancel
                    </button>
                  </div>
                  {tokenUrl && (
                    <a
                      href={tokenUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-xs text-accent-400 hover:underline"
                    >
                      Get a token →
                    </a>
                  )}
                </>
              )}
            </form>
          )}
        </>
      )}

      {/* Disconnected state — Codex (ChatGPT device code flow) */}
      {!status.connected && isCodex && (
        <>
          {deviceCode ? (
            <div className="space-y-2">
              <p className="text-xs">
                Go to{" "}
                <a
                  href={deviceCode.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-400 underline"
                >
                  {deviceCode.url}
                </a>{" "}
                and enter:
              </p>
              <div className="bg-surface-input rounded-lg p-3 text-center">
                <span className="text-lg font-mono font-bold tracking-widest">
                  {deviceCode.code}
                </span>
              </div>
              {polling && (
                <p className="text-xs text-theme-secondary flex items-center gap-2">
                  <span className="inline-block w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
                  Waiting for login...
                </p>
              )}
            </div>
          ) : (
            <button
              onClick={handleCodexLogin}
              disabled={busy}
              className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium py-2 px-4 rounded-lg transition"
            >
              {busy ? "Connecting..." : "Connect with ChatGPT"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
