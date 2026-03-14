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
  const [agentsPathSaved, setAgentsPathSaved] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const agentsDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Sync local state when modal opens
  useEffect(() => {
    if (open) {
      setName(workbotName);
      setColor(accentColor);
      api.getMcpConfig().then((info) => {
        setAgentsPath(info.config.agentsFilePath || "AGENTS.md");
      }).catch(() => {});
    }
  }, [open, workbotName, accentColor]);

  function handleNameChange(value: string) {
    setName(value);
    // Debounce name saves
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateSettings(value || "Workbot", color);
    }, 400);
  }

  function handleColorChange(colorId: string) {
    setColor(colorId);
    updateSettings(name || "Workbot", colorId);
  }

  function handleAgentsPathChange(value: string) {
    setAgentsPath(value);
    setAgentsPathSaved(false);
    clearTimeout(agentsDebounceRef.current);
    agentsDebounceRef.current = setTimeout(() => {
      api.updateMcpConfig({ agentsFilePath: value || "AGENTS.md" }).then(() => {
        setAgentsPathSaved(true);
        setTimeout(() => setAgentsPathSaved(false), 2000);
      }).catch(() => {});
    }, 600);
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
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="bg-surface-card border border-theme rounded-2xl w-full max-w-lg p-6 space-y-5 shadow-2xl"
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

          {/* Agents context file */}
          <div className="space-y-2">
            <label className="text-xs text-theme-secondary uppercase tracking-wider">
              Agents Context File
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={agentsPath}
                onChange={(e) => handleAgentsPathChange(e.target.value)}
                placeholder="AGENTS.md"
                className="flex-1 bg-surface-input border border-theme-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 font-mono"
              />
              {agentsPathSaved && (
                <span className="text-xs text-green-400 whitespace-nowrap">Saved</span>
              )}
            </div>
            <p className="text-xs text-theme-secondary">
              Path to AGENTS.md shared with cloud agents. Relative to project root or absolute.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
