import { useState, useRef, useCallback } from "react";
import { useServices } from "../context/ServicesContext";

interface ServiceDrawerProps {
  open: boolean;
  onClose: () => void;
}

export default function ServiceDrawer({ open, onClose }: ServiceDrawerProps) {
  const { config, enabledServices, allServiceKeys, setEnabledServices } =
    useServices();

  const disabledKeys = allServiceKeys.filter(
    (k) => !enabledServices.includes(k)
  );

  // Drag state
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const dragNode = useRef<HTMLDivElement | null>(null);

  const handleDragStart = useCallback(
    (idx: number, e: React.DragEvent<HTMLDivElement>) => {
      setDragIdx(idx);
      dragNode.current = e.currentTarget;
      e.dataTransfer.effectAllowed = "move";
      // Slight delay so the dragged item doesn't disappear immediately
      requestAnimationFrame(() => {
        if (dragNode.current) dragNode.current.style.opacity = "0.4";
      });
    },
    []
  );

  const handleDragOver = useCallback(
    (idx: number, e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dragIdx === null || idx === dragIdx) return;
      setOverIdx(idx);
    },
    [dragIdx]
  );

  const handleDrop = useCallback(
    (idx: number, e: React.DragEvent) => {
      e.preventDefault();
      if (dragIdx === null || idx === dragIdx) return;
      const newOrder = [...enabledServices];
      const [moved] = newOrder.splice(dragIdx, 1);
      newOrder.splice(idx, 0, moved);
      setEnabledServices(newOrder);
    },
    [dragIdx, enabledServices, setEnabledServices]
  );

  const handleDragEnd = useCallback(() => {
    if (dragNode.current) dragNode.current.style.opacity = "1";
    setDragIdx(null);
    setOverIdx(null);
    dragNode.current = null;
  }, []);

  function toggleService(key: string) {
    if (enabledServices.includes(key)) {
      setEnabledServices(enabledServices.filter((k) => k !== key));
    } else {
      setEnabledServices([...enabledServices, key]);
    }
  }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-40 transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 h-full w-80 bg-surface-page border-l border-theme z-50 transform transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between p-4 border-b border-theme">
          <h2 className="text-lg font-semibold">Services</h2>
          <button
            onClick={onClose}
            className="text-theme-secondary hover:text-theme-primary text-xl leading-none"
          >
            &times;
          </button>
        </div>

        <div className="p-4 space-y-1 overflow-y-auto h-[calc(100%-60px)]">
          <p className="text-xs text-theme-muted mb-3">
            Toggle services on/off. Drag enabled services to reorder.
          </p>

          {/* Enabled services — draggable */}
          {enabledServices.length > 0 && (
            <div className="mb-4">
              <p className="text-xs text-theme-secondary uppercase tracking-wider mb-2">
                Enabled
              </p>
              {enabledServices.map((key, idx) => (
                <div
                  key={key}
                  draggable
                  onDragStart={(e) => handleDragStart(idx, e)}
                  onDragOver={(e) => handleDragOver(idx, e)}
                  onDrop={(e) => handleDrop(idx, e)}
                  onDragEnd={handleDragEnd}
                  className={`flex items-center gap-2 p-2 rounded-lg mb-1 cursor-grab active:cursor-grabbing select-none transition-colors ${
                    overIdx === idx && dragIdx !== null && dragIdx !== idx
                      ? "bg-accent-900/30 border border-accent-500/30"
                      : "bg-surface-card hover:bg-surface-input"
                  }`}
                >
                  {/* Drag handle */}
                  <span className="text-theme-muted shrink-0">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                      <circle cx="3" cy="2" r="1.2" />
                      <circle cx="9" cy="2" r="1.2" />
                      <circle cx="3" cy="6" r="1.2" />
                      <circle cx="9" cy="6" r="1.2" />
                      <circle cx="3" cy="10" r="1.2" />
                      <circle cx="9" cy="10" r="1.2" />
                    </svg>
                  </span>

                  <span className="flex-1 text-sm">
                    {config[key]?.name ?? key}
                  </span>

                  <button
                    onClick={() => toggleService(key)}
                    className="text-red-400 hover:text-red-300 text-lg leading-none shrink-0"
                    title="Remove from dashboard"
                  >
                    &minus;
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Disabled services — static */}
          {disabledKeys.length > 0 && (
            <div>
              <p className="text-xs text-theme-secondary uppercase tracking-wider mb-2">
                Available
              </p>
              {disabledKeys.map((key) => (
                <div
                  key={key}
                  className="flex items-center gap-2 p-2 rounded-lg mb-1 bg-surface-card/50 hover:bg-surface-input/50"
                >
                  <div className="w-3 shrink-0" />
                  <span className="flex-1 text-sm text-theme-secondary">
                    {config[key]?.name ?? key}
                  </span>
                  <button
                    onClick={() => toggleService(key)}
                    className="text-green-400 hover:text-green-300 text-lg leading-none shrink-0"
                    title="Add to dashboard"
                  >
                    +
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
