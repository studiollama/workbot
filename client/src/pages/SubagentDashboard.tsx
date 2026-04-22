import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api } from "../api/client";
import McpPanel from "../components/McpPanel";
import LogsPanel from "../components/LogsPanel";
import WorkflowsPanel from "../components/WorkflowsPanel";
import BrainPanel from "../components/BrainPanel";
import DevPanel from "../components/DevPanel";

interface SubagentInfo {
  id: string;
  name: string;
  description: string;
  allowedServices: string[];
  enabled: boolean;
}

interface ServiceStatus {
  connected: boolean;
  user?: string;
  allowed: boolean;
}

interface Props {
  onLogout: () => void;
}

export default function SubagentDashboard({ onLogout }: Props) {
  const { id, tab: urlTab } = useParams<{ id: string; tab?: string }>();
  const navigate = useNavigate();
  const [subagent, setSubagent] = useState<SubagentInfo | null>(null);
  const [services, setServices] = useState<Record<string, ServiceStatus>>({});
  const [loading, setLoading] = useState(true);
  const validTabs = ["services", "brain", "development", "workflows", "mcp", "logs"] as const;
  type SubTab = typeof validTabs[number];
  const activeTab: SubTab = validTabs.includes(urlTab as any) ? (urlTab as SubTab) : "services";
  const setActiveTab = (tab: SubTab) => navigate(`/subagent/${id}/${tab}`);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      api.getSubagent(id),
      api.getSubagentServices(id),
    ]).then(([sub, svcs]) => {
      setSubagent(sub);
      setServices(svcs);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-gray-600 border-t-gray-200 rounded-full animate-spin" />
      </div>
    );
  }

  if (!subagent) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-theme-muted">Subagent not found</p>
          <Link to="/" className="text-sm text-accent-400 hover:text-accent-300 transition">Back to host dashboard</Link>
        </div>
      </div>
    );
  }

  const allowedServices = Object.entries(services).filter(([, v]) => v.allowed);
  const connectedServices = allowedServices.filter(([, v]) => v.connected);

  const tabs = [
    { key: "services", label: "Services" },
    { key: "brain", label: "Brain" },
    { key: "development", label: "Dev" },
    { key: "workflows", label: "Workflows" },
    { key: "mcp", label: "MCP" },
    { key: "logs", label: "Logs" },
  ] as const;

  const isBrainTab = activeTab === ("brain" as any);

  return (
    <div className="min-h-screen p-3 sm:p-6">
      <div className={`mx-auto space-y-4 sm:space-y-6 transition-all ${isBrainTab ? "max-w-7xl" : "max-w-3xl"}`}>
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Link to="/" className="text-xs text-theme-muted hover:text-theme-secondary transition">&larr; Host</Link>
              <span className="text-xs text-theme-muted">/</span>
            </div>
            <h1 className="text-lg sm:text-2xl font-bold truncate">{subagent.name}</h1>
            {subagent.description && (
              <p className="text-theme-secondary text-xs sm:text-sm mt-1 truncate">{subagent.description}</p>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={`w-2.5 h-2.5 rounded-full ${subagent.enabled ? "bg-green-500" : "bg-gray-500"}`} />
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
                onClick={() => setActiveTab(key as SubTab)}
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

        {/* Services tab (read-only) */}
        {activeTab === "services" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Allowed Services ({allowedServices.length})</p>
              <p className="text-xs text-theme-muted">Managed by host dashboard</p>
            </div>

            {allowedServices.length === 0 ? (
              <div className="bg-surface-card/50 border border-theme border-dashed rounded-xl p-8 text-center text-theme-muted">
                No services assigned. Ask the host admin to grant access.
              </div>
            ) : (
              <div className="grid gap-2">
                {allowedServices.map(([key, status]) => (
                  <div key={key} className="glass-card p-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`w-2.5 h-2.5 rounded-full ${status.connected ? "bg-green-500" : "bg-gray-500"}`} />
                      <span className="text-sm font-medium">{key}</span>
                    </div>
                    <span className="text-xs text-theme-secondary">
                      {status.connected ? status.user ?? "connected" : "not connected on host"}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Not-allowed services (dimmed) */}
            {Object.entries(services).filter(([, v]) => !v.allowed).length > 0 && (
              <div className="space-y-2 opacity-40">
                <p className="text-xs text-theme-muted uppercase tracking-wider">Not Available</p>
                {Object.entries(services).filter(([, v]) => !v.allowed).map(([key]) => (
                  <div key={key} className="bg-surface-card/50 rounded-lg px-3 py-2 text-xs text-theme-muted">{key}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "mcp" && <McpPanel />}
        {activeTab === "development" && <DevPanel scope={id} />}
        {activeTab === "workflows" && <WorkflowsPanel scope={id} />}
        {activeTab === "logs" && <LogsPanel scope={id} />}
        {activeTab === "brain" && <BrainPanel scope={`subagent:${id}`} />}
      </div>
    </div>
  );
}
