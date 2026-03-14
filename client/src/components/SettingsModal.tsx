import { useState, useEffect, useRef } from "react";
import { useServices } from "../context/ServicesContext";
import { ACCENT_COLORS } from "../constants/colors";
import { api } from "../api/client";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { workbotName, accentColor, updateSettings } = useServices();
  const [name, setName] = useState(workbotName);
  const [color, setColor] = useState(accentColor);
  const [agentsPath, setAgentsPath] = useState("AGENTS.md");
  const [claudeMdPath, setClaudeMdPath] = useState("CLAUDE.md");
  const [serverPort, setServerPort] = useState(3001);
  const [savedField, setSavedField] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pathDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Sync local state when modal opens
  useEffect(() => {
    if (open) {
      setName(workbotName);
      setColor(accentColor);
      api.getMcpConfig().then((info) => {
        setAgentsPath(info.config.agentsFilePath || "AGENTS.md");
        setClaudeMdPath(info.config.claudeMdPath || "CLAUDE.md");
        setServerPort(info.config.serverPort || 3001);
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

  function handlePortChange(value: string) {
    const port = parseInt(value, 10);
    if (isNaN(port)) return;
    setServerPort(port);
    clearTimeout(pathDebounceRef.current);
    setSavedField(null);
    pathDebounceRef.current = setTimeout(() => {
      if (port > 0 && port < 65536) {
        api.updateMcpConfig({ serverPort: port } as any).then(() => {
          setSavedField("serverPort");
          setTimeout(() => setSavedField(null), 2000);
        }).catch(() => {});
      }
    }, 600);
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
      <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 overflow-y-auto">
        <div
          className="bg-surface-card border border-theme sm:rounded-2xl w-full max-w-lg p-6 space-y-5 shadow-2xl min-h-screen sm:min-h-0 sm:my-auto"
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

          {/* Server port */}
          <div className="space-y-2 pt-1">
            <label className="text-xs text-theme-secondary uppercase tracking-wider">
              Server Port
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={serverPort}
                onChange={(e) => handlePortChange(e.target.value)}
                min={1}
                max={65535}
                className="w-28 bg-surface-input border border-theme-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 font-mono"
              />
              {savedField === "serverPort" && (
                <span className="text-xs text-green-400 whitespace-nowrap">Saved</span>
              )}
            </div>
            <p className="text-xs text-theme-secondary">
              Restart the server for port changes to take effect.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
