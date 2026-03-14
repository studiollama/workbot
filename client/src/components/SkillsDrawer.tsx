import { type Skill } from "../api/client";
import Tooltip from "./Tooltip";

const RISK_COLORS: Record<string, string> = {
  low: "text-green-400",
  medium: "text-yellow-400",
  high: "text-red-400",
  unknown: "text-theme-muted",
};

const RISK_BG: Record<string, string> = {
  low: "bg-green-500/15 border-green-500/30",
  medium: "bg-yellow-500/15 border-yellow-500/30",
  high: "bg-red-500/15 border-red-500/30",
  unknown: "bg-surface-hover/50 border-theme",
};

interface SkillsDrawerProps {
  open: boolean;
  onClose: () => void;
  skills: Skill[];
  onToggle: (id: string) => void;
}

export default function SkillsDrawer({ open, onClose, skills, onToggle }: SkillsDrawerProps) {
  const enabled = skills.filter((s) => s.enabled);
  const disabled = skills.filter((s) => !s.enabled);

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
          <h2 className="text-lg font-semibold">Skills</h2>
          <button
            onClick={onClose}
            className="text-theme-secondary hover:text-theme-primary text-xl leading-none"
          >
            &times;
          </button>
        </div>

        <div className="p-4 space-y-1 overflow-y-auto h-[calc(100%-60px)]">
          <p className="text-xs text-theme-muted mb-3">
            Toggle skills on/off. Enabled skills are available in Claude Code.
          </p>

          {/* Enabled skills */}
          {enabled.length > 0 && (
            <div className="mb-4">
              <p className="text-xs text-theme-secondary uppercase tracking-wider mb-2">
                Enabled
              </p>
              {enabled.map((skill) => (
                <SkillRow key={skill.id} skill={skill} onToggle={onToggle} />
              ))}
            </div>
          )}

          {/* Disabled skills */}
          {disabled.length > 0 && (
            <div>
              <p className="text-xs text-theme-secondary uppercase tracking-wider mb-2">
                Available
              </p>
              {disabled.map((skill) => (
                <SkillRow key={skill.id} skill={skill} onToggle={onToggle} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function SkillRow({ skill, onToggle }: { skill: Skill; onToggle: (id: string) => void }) {
  const riskColor = RISK_COLORS[skill.risk] || RISK_COLORS.unknown;
  const riskBg = RISK_BG[skill.risk] || RISK_BG.unknown;

  return (
    <div
      className={`flex items-center gap-2 p-2 rounded-lg mb-1 ${
        skill.enabled
          ? "bg-surface-card hover:bg-surface-input"
          : "bg-surface-card/50 hover:bg-surface-input/50"
      }`}
    >
      <button
        onClick={() => onToggle(skill.id)}
        className={`relative w-8 h-4 rounded-full transition-colors shrink-0 ${
          skill.enabled ? "bg-accent-600" : "bg-surface-hover"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
            skill.enabled ? "translate-x-4" : ""
          }`}
        />
      </button>
      <div className="flex-1 min-w-0">
        <span className={`text-sm truncate block ${skill.enabled ? "" : "text-theme-secondary"}`}>
          {skill.name}
        </span>
      </div>
      <Tooltip
        content={skill.description}
        className="bg-surface-card border-theme text-theme-primary"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-theme-muted hover:text-theme-secondary cursor-help transition shrink-0"
        >
          <circle cx="8" cy="8" r="7" />
          <line x1="8" y1="7" x2="8" y2="11" />
          <circle cx="8" cy="5" r="0.5" fill="currentColor" />
        </svg>
      </Tooltip>
      <Tooltip
        content={<><span className="font-medium capitalize">{skill.risk} risk</span><span className="mx-1">—</span>{skill.riskNote}</>}
        className="bg-surface-card border-theme text-theme-primary"
      >
        <span className={`text-[10px] cursor-help shrink-0 ${riskColor}`}>
          {skill.risk}
        </span>
      </Tooltip>
    </div>
  );
}
