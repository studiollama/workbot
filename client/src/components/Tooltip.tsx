import { useState, useRef, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  className?: string;
}

export default function Tooltip({ content, children, className = "" }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLSpanElement>(null);

  const show = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({
      top: rect.top - 8,
      left: rect.right,
    });
    setVisible(true);
  }, []);

  const hide = useCallback(() => setVisible(false), []);

  return (
    <span
      ref={triggerRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      className="inline-flex shrink-0"
    >
      {children}
      {visible &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              transform: "translate(-100%, -100%)",
              zIndex: 99999,
              pointerEvents: "none",
            }}
            className={`w-64 p-2.5 rounded-lg border text-xs shadow-xl ${className}`}
          >
            {content}
          </div>,
          document.body
        )}
    </span>
  );
}
