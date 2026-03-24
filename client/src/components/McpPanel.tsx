import { useState, useEffect, useRef } from "react";
import { api, type McpConfigData, type McpTool, type McpStatus } from "../api/client";

export default function McpPanel() {
  const [qmdPath, setQmdPath] = useState("");
  const [tools, setTools] = useState<McpTool[]>([]);
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [saved, setSaved] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    loadConfig();
  }, []);

  async function loadConfig() {
    setLoading(true);
    try {
      const [info, mcpStatus] = await Promise.all([
        api.getMcpConfig(),
        api.getMcpStatus(),
      ]);
      setQmdPath(info.config.qmdCliPath ?? "");
      setTools(info.tools);
      setStatus(mcpStatus);
    } catch {
      // server not running yet
    } finally {
      setLoading(false);
    }
  }

  function handlePathChange(value: string) {
    setQmdPath(value);
    setSaved(false);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      await api.updateMcpConfig({ qmdCliPath: value || null });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }, 600);
  }

  async function checkStatus() {
    setChecking(true);
    try {
      const s = await api.getMcpStatus();
      setStatus(s);
    } catch {
      setStatus({ qmdAvailable: false, error: "Failed to check status" });
    } finally {
      setChecking(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-gray-600 border-t-gray-200 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* QMD Configuration */}
      <div className="bg-surface-card rounded-xl p-5 space-y-4">
        <h3 className="font-medium">Brain Search (QMD)</h3>

        <div className="space-y-2">
          <label className="text-xs text-theme-secondary uppercase tracking-wider">
            QMD CLI Path
          </label>
          <input
            type="text"
            value={qmdPath}
            onChange={(e) => handlePathChange(e.target.value)}
            placeholder="/path/to/node_modules/@tobilu/qmd/dist/cli/qmd.js"
            className="w-full bg-surface-input border border-theme-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 font-mono"
          />
          <p className="text-xs text-theme-muted">
            Path to <code className="text-theme-secondary">qmd.js</code> on this machine.
            Install with: <code className="text-theme-secondary">npm i -g @tobilu/qmd</code>,
            then find it with: <code className="text-theme-secondary">npm root -g</code>
          </p>
        </div>

        {/* Status */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            {status === null ? (
              <span className="w-2.5 h-2.5 rounded-full bg-gray-500" />
            ) : status.qmdAvailable ? (
              <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
            ) : !qmdPath ? (
              <span className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
            ) : (
              <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
            )}
            <span className="text-sm text-theme-secondary">
              {status === null
                ? "Unknown"
                : status.qmdAvailable
                  ? "Connected"
                  : !qmdPath
                    ? "Not configured"
                    : status.error ?? "Error"}
            </span>
          </div>
          <button
            onClick={checkStatus}
            disabled={checking}
            className="text-xs text-accent-400 hover:text-accent-300 transition disabled:opacity-50"
          >
            {checking ? "Checking..." : "Check status"}
          </button>
          {saved && (
            <span className="text-xs text-green-400">Saved</span>
          )}
        </div>
      </div>

      {/* Tools list */}
      <div className="bg-surface-card rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">MCP Tools</h3>
          <span className="text-xs text-theme-muted">{tools.length} registered</span>
        </div>

        <div className="space-y-2">
          {tools.map((tool) => (
            <div
              key={tool.name}
              className="flex items-start gap-3 p-3 rounded-lg bg-surface-input/50"
            >
              <code className="text-xs text-accent-400 font-mono whitespace-nowrap pt-0.5">
                {tool.name}
              </code>
              <span className="text-xs text-theme-secondary leading-relaxed">
                {tool.description}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Info */}
      <div className="flex items-start gap-2 px-1">
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-theme-muted mt-0.5 shrink-0"
        >
          <circle cx="8" cy="8" r="6" />
          <path d="M8 7v4M8 5.5v0" strokeLinecap="round" />
        </svg>
        <p className="text-xs text-theme-muted">
          The MCP server runs as a separate process managed by Claude Code.
          After changing the QMD path, restart Claude Code for changes to take effect.
        </p>
      </div>
    </div>
  );
}
