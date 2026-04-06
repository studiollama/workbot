import { useState, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, type BrainNote } from "../api/client";

const TAG_COLORS: Record<string, string> = {
  decision: "tag-decision",
  pattern: "tag-pattern",
  correction: "tag-correction",
  entity: "tag-entity",
  project: "tag-project",
  context: "tag-context",
  retrospective: "tag-default",
};

function getTagClass(tag: string): string {
  for (const [key, cls] of Object.entries(TAG_COLORS)) {
    if (tag === key || tag.startsWith(key + "/")) return cls;
  }
  if (tag.startsWith("status/")) return "tag-status";
  if (tag.startsWith("domain/")) return "tag-domain";
  return "tag-default";
}

interface Props {
  notePath: string | null;
  scope?: string;
  onNavigate: (path: string) => void;
  onClose: () => void;
  onExpand?: () => void;
  isExpanded?: boolean;
  titleToPath: Record<string, string>;
  onNoteUpdated?: () => void;
}

export default function BrainNoteReader({ notePath, scope, onNavigate, onClose, onExpand, isExpanded, titleToPath, onNoteUpdated }: Props) {
  const [note, setNote] = useState<BrainNote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (!notePath) { setNote(null); setEditing(false); return; }
    setLoading(true);
    setError("");
    setEditing(false);
    api.getBrainNote(notePath, scope)
      .then((n) => { setNote(n); setEditContent(n.content); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [notePath, scope]);

  const processContent = useCallback(
    (content: string): string => {
      const stripped = content.replace(/^---\n[\s\S]*?\n---\n/, "");
      return stripped.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target, display) => {
        const label = display || target;
        const resolved = titleToPath[target.toLowerCase()];
        if (resolved) return `[${label}](#note:${resolved})`;
        return `**${label}**`;
      });
    },
    [titleToPath]
  );

  const handleLinkClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      const link = target.closest("a");
      if (link) {
        const href = link.getAttribute("href");
        if (href?.startsWith("#note:")) {
          e.preventDefault();
          const notePath = href.slice(6);
          // Cross-brain link: "scope:path" format
          onNavigate(notePath);
        }
      }
    },
    [onNavigate]
  );

  async function handleSave() {
    if (!notePath || !editContent.trim()) return;
    setSaving(true);
    setSaveError("");
    try {
      await api.updateBrainNote(notePath, editContent, scope, true);
      // Refresh note
      const updated = await api.getBrainNote(notePath, scope);
      setNote(updated);
      setEditing(false);
      onNoteUpdated?.();
    } catch (err: any) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!notePath) {
    return (
      <div className="flex items-center justify-center h-full text-theme-muted text-sm">
        Select a note to view
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-5 h-5 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full status-error text-sm p-4">
        {error}
      </div>
    );
  }

  if (!note) return null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between p-3 sm:p-4 border-b border-theme flex-shrink-0">
        <div className="min-w-0 flex-1">
          <h2 className="text-base sm:text-lg font-semibold text-theme-primary truncate">{note.title}</h2>
          <p className="text-[11px] text-theme-muted mt-0.5 truncate font-mono">{note.path}</p>
          {note.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {note.tags.map((tag) => (
                <span key={tag} className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${getTagClass(tag)}`}>
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 ml-2 shrink-0">
          {/* Edit toggle */}
          <button
            onClick={() => { if (editing) { setEditing(false); setEditContent(note.content); } else { setEditing(true); setEditContent(note.content); } }}
            className={`p-1.5 rounded transition ${editing ? "bg-accent-600 text-white" : "hover:bg-surface-hover text-theme-secondary hover:text-theme-primary"}`}
            title={editing ? "Cancel edit" : "Edit note"}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          {/* Expand/collapse */}
          {onExpand && (
            <button
              onClick={onExpand}
              className="p-1.5 rounded hover:bg-surface-hover text-theme-secondary hover:text-theme-primary transition"
              title={isExpanded ? "Collapse" : "Expand full screen"}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                {isExpanded ? (
                  <path d="M9 9L4 4m0 0v4m0-4h4m6 6l5 5m0 0v-4m0 4h-4" />
                ) : (
                  <path d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" />
                )}
              </svg>
            </button>
          )}
          {/* Close */}
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-surface-hover text-theme-secondary hover:text-theme-primary transition"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      {editing ? (
        <div className="flex-1 flex flex-col overflow-hidden p-3 sm:p-4 gap-2">
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="flex-1 w-full bg-surface-input border border-theme-input rounded-lg p-3 text-sm font-mono text-theme-primary focus:outline-none focus:ring-1 focus:ring-accent-500 resize-none"
            spellCheck={false}
          />
          {saveError && (
            <div className="bg-red-900/30 border border-red-700/50 rounded px-3 py-1.5 text-xs text-red-400">{saveError}</div>
          )}
          <div className="flex gap-2 shrink-0">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-1.5 bg-accent-600 hover:bg-accent-700 text-white text-sm rounded-lg transition disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              onClick={() => { setEditing(false); setEditContent(note.content); setSaveError(""); }}
              className="px-4 py-1.5 text-sm text-theme-secondary hover:text-theme-primary transition"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-3 sm:p-4" onClick={handleLinkClick}>
          <div className="prose-brain brain-prose">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {processContent(note.content)}
            </ReactMarkdown>
          </div>
        </div>
      )}

      {/* Backlinks (hidden in edit mode) */}
      {!editing && (note.incoming.length > 0 || note.outgoing.length > 0) && (
        <div className="border-t border-theme p-3 flex-shrink-0 max-h-40 overflow-y-auto">
          {note.incoming.length > 0 && (
            <div className="mb-2">
              <span className="text-[10px] font-medium text-theme-muted uppercase tracking-wider">Backlinks</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {note.incoming.map((p) => (
                  <button key={p} onClick={() => onNavigate(p)}
                    className="text-xs px-2 py-0.5 rounded bg-surface-hover text-accent-400 hover:text-accent-300 transition">
                    {p.split("/").pop()?.replace(".md", "")}
                  </button>
                ))}
              </div>
            </div>
          )}
          {note.outgoing.length > 0 && (
            <div>
              <span className="text-[10px] font-medium text-theme-muted uppercase tracking-wider">Links to</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {note.outgoing.map((p) => {
                  // Resolve unresolved titles through titleToPath (supports cross-brain)
                  const resolved = p.endsWith(".md") ? p : (titleToPath[p.toLowerCase()] ?? p);
                  const isCrossBrain = resolved.includes(":") && !resolved.startsWith("/");
                  const displayName = p.endsWith(".md") ? p.split("/").pop()?.replace(".md", "") : p;
                  return (
                    <button key={p} onClick={() => onNavigate(resolved)}
                      className={`text-xs px-2 py-0.5 rounded transition ${isCrossBrain ? "bg-purple-900/50 text-purple-300 hover:text-purple-200" : "bg-surface-hover text-accent-400 hover:text-accent-300"}`}>
                      {displayName}{isCrossBrain && " ↗"}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
