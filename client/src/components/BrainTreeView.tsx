import { useState, useEffect, useCallback } from "react";
import { api, type BrainTreeNode } from "../api/client";

const TAG_COLORS: Record<string, string> = {
  decision: "text-blue-400",
  pattern: "text-green-400",
  correction: "text-red-400",
  entity: "text-purple-400",
  project: "text-orange-400",
  context: "text-yellow-400",
};

function getFileColor(tags?: string[]): string {
  if (!tags) return "text-theme-secondary";
  for (const t of tags) {
    if (TAG_COLORS[t]) return TAG_COLORS[t];
  }
  return "text-theme-secondary";
}

function countFiles(node: BrainTreeNode): number {
  if (node.type === "file") return 1;
  return (node.children ?? []).reduce((sum, c) => sum + countFiles(c), 0);
}

interface Props {
  scope?: string;
  selectedNote: string | null;
  onSelect: (path: string) => void;
}

export default function BrainTreeView({ scope, selectedNote, onSelect }: Props) {
  const [tree, setTree] = useState<BrainTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPath, setCurrentPath] = useState<string[]>([]); // breadcrumb path of folder names

  const fetchTree = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getBrainTree(scope);
      setTree(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [scope]);

  useEffect(() => { fetchTree(); }, [fetchTree]);

  // Navigate into the current folder
  function getCurrentItems(): BrainTreeNode[] {
    let items = tree;
    for (const segment of currentPath) {
      const folder = items.find((i) => i.type === "folder" && i.name === segment);
      if (folder?.children) {
        items = folder.children;
      } else {
        break;
      }
    }
    return items;
  }

  function navigateInto(folderName: string) {
    setCurrentPath([...currentPath, folderName]);
  }

  function navigateTo(index: number) {
    setCurrentPath(currentPath.slice(0, index));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-5 h-5 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const items = getCurrentItems();
  const folders = items.filter((i) => i.type === "folder");
  const files = items.filter((i) => i.type === "file");

  return (
    <div className="flex flex-col h-full">
      {/* File/folder list */}
      <div className="flex-1 overflow-y-auto">
        {/* Folders */}
        {folders.map((folder) => (
          <button
            key={folder.path}
            onClick={() => navigateInto(folder.name)}
            className="w-full text-left flex items-center gap-3 px-4 py-2.5 hover:bg-surface-hover transition border-b border-theme/30"
          >
            <svg className="w-4 h-4 text-theme-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <span className="flex-1 text-sm text-theme-primary font-medium truncate">{folder.name}</span>
            <span className="text-xs text-theme-muted shrink-0">{countFiles(folder)}</span>
            <svg className="w-3.5 h-3.5 text-theme-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ))}

        {/* Files */}
        {files.map((file) => {
          const isSelected = file.path === selectedNote;
          return (
            <button
              key={file.path}
              onClick={() => onSelect(file.path)}
              className={`w-full text-left flex items-center gap-3 px-4 py-2.5 transition border-b border-theme/30 ${
                isSelected ? "bg-accent-600/15" : "hover:bg-surface-hover"
              }`}
            >
              <svg className={`w-4 h-4 shrink-0 ${isSelected ? "text-accent-400" : "text-theme-muted opacity-50"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className={`flex-1 text-sm truncate ${isSelected ? "text-accent-300 font-medium" : getFileColor(file.tags)}`}>
                {file.name}
              </span>
              {file.tags && file.tags.length > 0 && (
                <span className="text-[10px] text-theme-muted shrink-0">{file.tags[0]}</span>
              )}
            </button>
          );
        })}

        {/* Empty state */}
        {items.length === 0 && (
          <div className="flex items-center justify-center h-32 text-theme-muted text-sm">
            Empty folder
          </div>
        )}
      </div>

      {/* Breadcrumb bar at bottom */}
      <div className="flex items-center gap-1 px-3 py-2 border-t border-theme bg-surface-input/50 text-xs overflow-x-auto scrollbar-hide shrink-0">
        <button
          onClick={() => navigateTo(0)}
          className={`shrink-0 px-1.5 py-0.5 rounded transition ${currentPath.length === 0 ? "text-accent-400 font-medium" : "text-theme-secondary hover:text-theme-primary"}`}
        >
          root
        </button>
        {currentPath.map((segment, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className="text-theme-muted">/</span>
            <button
              onClick={() => navigateTo(i + 1)}
              className={`shrink-0 px-1.5 py-0.5 rounded transition ${i === currentPath.length - 1 ? "text-accent-400 font-medium" : "text-theme-secondary hover:text-theme-primary"}`}
            >
              {segment}
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
