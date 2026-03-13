import { useState, useEffect, useRef } from "react";
import { useServices } from "../context/ServicesContext";
import { ACCENT_COLORS } from "../constants/colors";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { workbotName, accentColor, updateSettings } = useServices();
  const [name, setName] = useState(workbotName);
  const [color, setColor] = useState(accentColor);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Sync local state when modal opens
  useEffect(() => {
    if (open) {
      setName(workbotName);
      setColor(accentColor);
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
          className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg p-6 space-y-5 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Settings</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white text-xl leading-none"
            >
              &times;
            </button>
          </div>

          {/* Name input */}
          <div className="space-y-2">
            <label className="text-xs text-gray-400 uppercase tracking-wider">
              Workbot Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Workbot"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
            />
          </div>

          {/* Color picker */}
          <div className="space-y-2">
            <label className="text-xs text-gray-400 uppercase tracking-wider">
              Accent Color
            </label>
            <div className="grid grid-cols-10 gap-2">
              {ACCENT_COLORS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => handleColorChange(c.id)}
                  className={`w-8 h-8 rounded-full transition-all duration-150 ${
                    color === c.id
                      ? "ring-2 ring-white ring-offset-2 ring-offset-gray-900 scale-110"
                      : "hover:scale-110"
                  }`}
                  style={{ backgroundColor: c.hex }}
                  title={c.id}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
