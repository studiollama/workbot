import { useState, useEffect, useCallback } from "react";
import { api, type Skill } from "../api/client";
import SkillsDrawer from "./SkillsDrawer";
import Tooltip from "./Tooltip";

const RISK_STYLES: Record<string, { bg: string; text: string; border: string; label: string }> = {
  low:     { bg: "bg-green-500/15",  text: "text-green-400",  border: "border-green-500/30",  label: "Low Risk" },
  medium:  { bg: "bg-yellow-500/15", text: "text-yellow-400", border: "border-yellow-500/30", label: "Medium Risk" },
  high:    { bg: "bg-red-500/15",    text: "text-red-400",    border: "border-red-500/30",    label: "High Risk" },
  unknown: { bg: "bg-surface-hover/50", text: "text-theme-muted", border: "border-theme", label: "Unassessed" },
};

export default function SkillsPanel() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Add form
  const [showAdd, setShowAdd] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");



  const fetchSkills = useCallback(async () => {
    try {
      const data = await api.getSkills();
      setSkills(data);
      setError("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  async function handleToggle(id: string) {
    try {
      const skill = skills.find((s) => s.id === id);
      if (skill && !skill.builtIn) {
        // Auto-install when enabling a non-built-in skill
        if (!skill.enabled && !skill.installed) {
          try {
            await api.installSkill(id);
            setSkills((prev) =>
              prev.map((s) => (s.id === id ? { ...s, installed: true } : s))
            );
          } catch {
            // Install failed — still toggle
          }
        }
        // Auto-uninstall when disabling a non-built-in skill
        if (skill.enabled && skill.installed) {
          try {
            await api.uninstallSkill(id);
            setSkills((prev) =>
              prev.map((s) => (s.id === id ? { ...s, installed: false } : s))
            );
          } catch {
            // Uninstall failed — still toggle
          }
        }
      }
      await api.toggleSkill(id);
      setSkills((prev) =>
        prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s))
      );
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newUrl.trim()) return;
    setAddError("");
    setAdding(true);
    try {
      const skill = await api.addSkill(
        newUrl.trim(),
        newName.trim() || undefined,
        newDesc.trim() || undefined
      );
      setSkills((prev) => [...prev, skill]);
      setNewUrl("");
      setNewName("");
      setNewDesc("");
      setShowAdd(false);
    } catch (err: any) {
      setAddError(err.message);
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(id: string) {
    try {
      await api.removeSkill(id);
      setSkills((prev) => prev.filter((s) => s.id !== id));
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-gray-600 border-t-gray-200 rounded-full animate-spin" />
      </div>
    );
  }

  const enabled = skills.filter((s) => s.enabled);

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-900/50 border border-red-700 rounded-lg p-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Header row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <p className="text-xs text-theme-muted">
          Manage Claude Code skills. Toggle skills on/off to include them in your workflow.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="text-sm text-accent-400 hover:text-accent-300 transition whitespace-nowrap"
          >
            {showAdd ? "Cancel" : "+ Add Skill"}
          </button>
          <button
            onClick={() => setDrawerOpen(true)}
            className="p-1.5 rounded-lg bg-surface-input hover:bg-surface-hover text-theme-secondary hover:text-theme-primary transition"
            title="Toggle skills on/off"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="2" y1="4" x2="14" y2="4" />
              <line x1="2" y1="8" x2="14" y2="8" />
              <line x1="2" y1="12" x2="14" y2="12" />
              <circle cx="5" cy="4" r="1.5" fill="currentColor" />
              <circle cx="11" cy="8" r="1.5" fill="currentColor" />
              <circle cx="7" cy="12" r="1.5" fill="currentColor" />
            </svg>
          </button>
        </div>
      </div>

      {/* Add skill form */}
      {showAdd && (
        <form onSubmit={handleAdd} className="glass-card p-4 space-y-3 overflow-y-auto max-h-[60vh]">
          <p className="text-sm font-medium">Add Skill from GitHub</p>
          <input
            type="text"
            placeholder="https://github.com/owner/skill-repo"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            className="w-full bg-surface-input border border-theme-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              placeholder="Name (optional)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="bg-surface-input border border-theme-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
            />
            <input
              type="text"
              placeholder="Description (optional)"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              className="bg-surface-input border border-theme-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
            />
          </div>
          {addError && (
            <p className="text-xs text-red-400">{addError}</p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={adding || !newUrl.trim()}
              className="bg-accent-600 hover:bg-accent-700 disabled:opacity-50 text-white text-sm font-medium py-2 px-4 rounded-lg transition"
            >
              {adding ? "Adding..." : "Add Skill"}
            </button>
            <p className="text-xs text-theme-muted">
              New skills default to off with an "Unassessed" risk rating.
            </p>
          </div>
        </form>
      )}

      {/* Enabled skills cards */}
      {enabled.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-theme-secondary uppercase tracking-wider">
            Enabled ({enabled.length})
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {enabled.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                onToggle={() => handleToggle(skill.id)}
                onRemove={!skill.curated ? () => handleRemove(skill.id) : undefined}
              />
            ))}
          </div>
        </div>
      )}

      {enabled.length === 0 && (
        <div className="bg-surface-card/50 border border-theme border-dashed rounded-xl p-8 text-center text-theme-muted space-y-3">
          <p>No skills enabled.</p>
          <button
            onClick={() => setDrawerOpen(true)}
            className="text-sm text-accent-400 hover:text-accent-300 transition"
          >
            Enable skills
          </button>
        </div>
      )}

      <SkillsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        skills={skills}
        onToggle={handleToggle}
      />
    </div>
  );
}

function SkillCard({
  skill,
  onToggle,
  onRemove,
}: {
  skill: Skill;
  onToggle: () => void;
  onRemove?: () => void;
}) {
  const risk = RISK_STYLES[skill.risk] ?? RISK_STYLES.unknown;

  return (
    <div className="glass-card p-3 sm:p-5 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-surface-input flex items-center justify-center text-sm font-bold text-theme-secondary">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" opacity="0.6">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-medium">{skill.name}</h3>
              {skill.curated && (
                <span className="text-[10px] leading-normal text-theme-muted border border-theme rounded px-1 whitespace-nowrap">
                  curated
                </span>
              )}
              <Tooltip
                content={<><span className="font-medium">{risk.label}</span><span className="mx-1">—</span>{skill.riskNote}</>}
                className="bg-surface-card border-theme text-theme-primary"
              >
                <span
                  className={`text-[10px] leading-normal ${risk.text} border ${risk.border} rounded px-1 whitespace-nowrap cursor-help`}
                >
                  {risk.label}
                </span>
              </Tooltip>
            </div>
            <p className="text-xs text-theme-secondary line-clamp-1">{skill.description}</p>
          </div>
        </div>
        <div className="flex items-center shrink-0">
          <span className="w-3 h-3 rounded-full bg-green-500 border border-green-500" />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={onToggle}
          className="text-sm text-theme-secondary hover:text-red-400 transition"
        >
          Disable
        </button>
        <a
          href={skill.githubUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-theme-secondary hover:text-accent-400 transition"
        >
          View on GitHub
        </a>
        {onRemove && (
          <button
            onClick={onRemove}
            className="text-sm text-theme-secondary hover:text-red-400 transition ml-auto"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
