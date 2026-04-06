import { useState, useEffect, useRef } from "react";
import { useServices } from "../context/ServicesContext";
import { ACCENT_COLORS } from "../constants/colors";
import { api } from "../api/client";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { workbotName, accentColor, themeMode, updateSettings, setThemeMode } = useServices();
  const [name, setName] = useState(workbotName);
  const [color, setColor] = useState(accentColor);
  const [agentsPath, setAgentsPath] = useState("AGENTS.md");
  const [claudeMdPath, setClaudeMdPath] = useState("CLAUDE.md");
  const [serverPort, setServerPort] = useState(3001);
  const [clientPort, setClientPort] = useState(5173);
  const [hostServerPort, setHostServerPort] = useState<number | null>(null);
  const [hostClientPort, setHostClientPort] = useState<number | null>(null);
  const [savedField, setSavedField] = useState<string | null>(null);
  const [restarting, setRestarting] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pathDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const portDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Sync local state when modal opens
  useEffect(() => {
    if (open) {
      setName(workbotName);
      setColor(accentColor);
      api.getMcpConfig().then((info) => {
        setAgentsPath(info.config.agentsFilePath || "AGENTS.md");
        setClaudeMdPath(info.config.claudeMdPath || "CLAUDE.md");
        setServerPort(info.config.serverPort || 3001);
        setClientPort(info.config.clientPort || 5173);
        setHostServerPort(info.config.hostServerPort || null);
        setHostClientPort(info.config.hostClientPort || null);
      }).catch(() => {});
    }
  }, [open, workbotName, accentColor]);

  function handleNameChange(value: string) {
    setName(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateSettings(value || "Workbot", color);
    }, 400);
  }

  function handleColorChange(colorId: string) {
    setColor(colorId);
    updateSettings(name || "Workbot", colorId);
  }

  function savePathConfig(field: string, value: string) {
    clearTimeout(pathDebounceRef.current);
    setSavedField(null);
    pathDebounceRef.current = setTimeout(() => {
      api.updateMcpConfig({ [field]: value } as Record<string, string>).then(() => {
        setSavedField(field);
        setTimeout(() => setSavedField(null), 2000);
      }).catch(() => {});
    }, 600);
  }

  function handleAgentsPathChange(value: string) {
    setAgentsPath(value);
    savePathConfig("agentsFilePath", value || "AGENTS.md");
  }

  function handleClaudeMdPathChange(value: string) {
    setClaudeMdPath(value);
    savePathConfig("claudeMdPath", value || "CLAUDE.md");
  }

  function handlePortChange(field: "serverPort" | "clientPort", value: string) {
    const port = parseInt(value, 10);
    if (isNaN(port)) return;
    if (field === "serverPort") setServerPort(port);
    else setClientPort(port);
    clearTimeout(portDebounceRef.current);
    setSavedField(null);
    portDebounceRef.current = setTimeout(() => {
      if (port > 0 && port < 65536) {
        api.updateMcpConfig({ [field]: port } as any).then(() => {
          setSavedField(field);
          setTimeout(() => setSavedField(null), 2000);
        }).catch(() => {});
      }
    }, 600);
  }

  function handleApplyPorts() {
    setRestarting("ports");
    api.restartServer({ serverPort, clientPort }).then(() => {
      setRestarting(null);
      setSavedField("ports");
      setTimeout(() => setSavedField(null), 2000);
    }).catch(() => {
      setRestarting(null);
    });
  }

  async function handleBrowse(setter: (v: string) => void, configField: string) {
    try {
      const result = await api.pickFile();
      setter(result.path);
      savePathConfig(configField, result.path);
    } catch {
      // User cancelled
    }
  }

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-40"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-0 sm:p-4">
        <div
          className="bg-surface-card border border-theme sm:rounded-2xl w-full max-w-lg p-6 space-y-5 shadow-2xl h-screen sm:h-auto sm:max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Settings</h2>
            <button
              onClick={onClose}
              className="text-theme-secondary hover:text-theme-primary text-xl leading-none"
            >
              &times;
            </button>
          </div>

          {/* Name input */}
          <div className="space-y-2">
            <label className="text-xs text-theme-secondary uppercase tracking-wider">
              Workbot Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Workbot"
              className="w-full bg-surface-input border border-theme-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
            />
          </div>

          {/* Theme mode toggle */}
          <div className="space-y-2">
            <label className="text-xs text-theme-secondary uppercase tracking-wider">
              Appearance
            </label>
            <div className="flex rounded-xl border border-theme overflow-hidden">
              {([["light", "Light", "M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"],
                ["dark", "Dark", "M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"],
                ["system", "System", "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"],
              ] as const).map(([mode, label, icon]) => (
                <button
                  key={mode}
                  onClick={() => setThemeMode(mode as any)}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition ${
                    themeMode === mode
                      ? "bg-accent-600 text-white"
                      : "bg-surface-input text-theme-secondary hover:text-theme-primary"
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d={icon} />
                  </svg>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Color picker */}
          <div className="space-y-2">
            <label className="text-xs text-theme-secondary uppercase tracking-wider">
              Accent Color
            </label>
            <div className="grid grid-cols-10 gap-2">
              {ACCENT_COLORS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => handleColorChange(c.id)}
                  className={`w-8 h-8 rounded-full transition-all duration-150 ${
                    color === c.id
                      ? "ring-2 ring-white ring-offset-2 ring-offset-surface-card scale-110"
                      : "hover:scale-110"
                  }${c.mono ? " border border-theme-input" : ""}`}
                  style={
                    c.mono
                      ? { background: "linear-gradient(135deg, #000 50%, #fff 50%)" }
                      : { backgroundColor: c.hex }
                  }
                  title={c.id}
                />
              ))}
            </div>
          </div>

          {/* File paths section */}
          <div className="space-y-3 pt-1">
            <p className="text-xs text-theme-secondary uppercase tracking-wider">
              File Paths
            </p>

            {/* CLAUDE.md path */}
            <div className="space-y-1">
              <label className="text-xs text-theme-secondary">CLAUDE.md</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={claudeMdPath}
                  onChange={(e) => handleClaudeMdPathChange(e.target.value)}
                  placeholder="CLAUDE.md"
                  className="flex-1 bg-surface-input border border-theme-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 font-mono"
                />
                <button
                  onClick={() => handleBrowse(setClaudeMdPath, "claudeMdPath")}
                  className="px-3 py-2 bg-surface-input border border-theme-input rounded-lg text-xs text-theme-secondary hover:text-theme-primary transition"
                >
                  Browse
                </button>
                {savedField === "claudeMdPath" && (
                  <span className="text-xs text-green-400 whitespace-nowrap">Saved</span>
                )}
              </div>
            </div>

            {/* AGENTS.md path */}
            <div className="space-y-1">
              <label className="text-xs text-theme-secondary">AGENTS.md</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={agentsPath}
                  onChange={(e) => handleAgentsPathChange(e.target.value)}
                  placeholder="AGENTS.md"
                  className="flex-1 bg-surface-input border border-theme-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 font-mono"
                />
                <button
                  onClick={() => handleBrowse(setAgentsPath, "agentsFilePath")}
                  className="px-3 py-2 bg-surface-input border border-theme-input rounded-lg text-xs text-theme-secondary hover:text-theme-primary transition"
                >
                  Browse
                </button>
                {savedField === "agentsFilePath" && (
                  <span className="text-xs text-green-400 whitespace-nowrap">Saved</span>
                )}
              </div>
            </div>

            <p className="text-xs text-theme-secondary">
              Relative to project root or absolute paths. Use Browse to pick from filesystem.
            </p>
          </div>

          {/* Ports */}
          <div className="space-y-2 pt-1">
            <p className="text-xs text-theme-secondary uppercase tracking-wider">
              Ports
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-theme-secondary">Server (Express)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={serverPort}
                    onChange={(e) => handlePortChange("serverPort", e.target.value)}
                    min={1}
                    max={65535}
                    className="w-full bg-surface-input border border-theme-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 font-mono"
                  />
                  {savedField === "serverPort" && (
                    <span className="text-xs text-green-400 whitespace-nowrap">Saved</span>
                  )}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-theme-secondary">Client (Vite)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={clientPort}
                    onChange={(e) => handlePortChange("clientPort", e.target.value)}
                    min={1}
                    max={65535}
                    className="w-full bg-surface-input border border-theme-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 font-mono"
                  />
                  {savedField === "clientPort" && (
                    <span className="text-xs text-green-400 whitespace-nowrap">Saved</span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleApplyPorts}
                disabled={restarting === "ports"}
                className="px-3 py-1.5 bg-accent-600 hover:bg-accent-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition"
              >
                {restarting === "ports" ? "Saving..." : "Apply & Restart"}
              </button>
              {savedField === "ports" && (
                <span className="text-xs text-green-400">Saved — restart servers to apply</span>
              )}
            </div>

            {/* Host-mapped ports (read-only) */}
            {(hostServerPort || hostClientPort) && (
              <div className="pt-2 space-y-2">
                <p className="text-xs text-theme-secondary uppercase tracking-wider">
                  Host Ports (Docker)
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-theme-secondary">Server (Host)</label>
                    <input
                      type="number"
                      value={hostServerPort ?? ""}
                      readOnly
                      className="w-full bg-surface-input/50 border border-theme-input rounded-lg px-3 py-2 text-sm font-mono text-theme-secondary cursor-default"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-theme-secondary">Client (Host)</label>
                    <input
                      type="number"
                      value={hostClientPort ?? ""}
                      readOnly
                      className="w-full bg-surface-input/50 border border-theme-input rounded-lg px-3 py-2 text-sm font-mono text-theme-secondary cursor-default"
                    />
                  </div>
                </div>
                <p className="text-xs text-theme-secondary">
                  External ports mapped by Docker. OAuth callbacks use the host server port.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
