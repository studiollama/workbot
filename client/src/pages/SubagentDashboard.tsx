import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api/client";
import McpPanel from "../components/McpPanel";
import LogsPanel from "../components/LogsPanel";
import WorkflowsPanel from "../components/WorkflowsPanel";

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
  const { id } = useParams<{ id: string }>();
  const [subagent, setSubagent] = useState<SubagentInfo | null>(null);
  const [services, setServices] = useState<Record<string, ServiceStatus>>({});
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"services" | "mcp" | "workflows" | "logs">("services");

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

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Link to="/" className="text-xs text-theme-muted hover:text-theme-secondary transition">&larr; Host</Link>
              <span className="text-xs text-theme-muted">/</span>
            </div>
            <h1 className="text-2xl font-bold">{subagent.name}</h1>
            {subagent.description && (
              <p className="text-theme-secondary text-sm mt-1">{subagent.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${subagent.enabled ? "bg-green-500" : "bg-gray-500"}`} />
            <button
              onClick={async () => { await api.dashboardLogout(); onLogout(); }}
              className="p-2 rounded-lg bg-surface-input hover:bg-surface-hover text-theme-secondary hover:text-theme-primary transition"
              title="Sign out"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M7 17H4a1 1 0 01-1-1V4a1 1 0 011-1h3" />
                <path d="M14 14l3-4-3-4" />
                <path d="M17 10H7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-theme">
          {(["services", "mcp", "workflows", "logs"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium transition border-b-2 -mb-px capitalize ${
                activeTab === tab
                  ? "border-accent-500 text-theme-primary"
                  : "border-transparent text-theme-secondary hover:text-theme-primary"
              }`}
            >
              {tab}
            </button>
          ))}
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
                  <div key={key} className="bg-surface-card rounded-xl p-3 flex items-center justify-between">
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
        {activeTab === "workflows" && <WorkflowsPanel scope={id} />}
        {activeTab === "logs" && <LogsPanel scope={id} />}
      </div>
    </div>
  );
}
