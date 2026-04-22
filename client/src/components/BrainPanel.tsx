import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, type BrainGraphData, type BrainInfo } from "../api/client";
import BrainGraphView from "./BrainGraphView";
import BrainNoteReader from "./BrainNoteReader";
import BrainSearch from "./BrainSearch";
import BrainTreeView from "./BrainTreeView";

interface BrainPanelProps {
  scope?: string;
}

export default function BrainPanel({ scope }: BrainPanelProps = {}) {
  const location = useLocation();
  const navigate = useNavigate();

  // Parse brain scope and note path from URL: /brain/{scope}/{notePath...}
  const urlParts = location.pathname.replace(/^\/brain\/?/, "").split("/");
  const urlScope = urlParts[0] && urlParts[0] !== "" ? urlParts[0] : null;
  const urlNotePath = urlParts.length > 1 ? urlParts.slice(1).join("/") : null;

  const [brains, setBrains] = useState<BrainInfo[]>([]);
  const [activeBrain, setActiveBrainState] = useState(scope || urlScope || "host");
  const [graphData, setGraphData] = useState<BrainGraphData | null>(null);
  const [selectedNote, setSelectedNoteState] = useState<string | null>(urlNotePath);

  // Sync URL when brain or note changes
  function setActiveBrain(brain: string) {
    setActiveBrainState(brain);
    if (!scope) navigate(`/brain/${brain}`, { replace: true });
  }
  function setSelectedNote(note: string | null) {
    setSelectedNoteState(note);
    if (!scope && note) {
      navigate(`/brain/${activeBrain}/${note}`, { replace: true });
    } else if (!scope && !note) {
      navigate(`/brain/${activeBrain}`, { replace: true });
    }
  }
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewMode, setViewMode] = useState<"graph" | "folders">("graph");
  const [fullScreen, setFullScreen] = useState(false);
  const [showNewNote, setShowNewNote] = useState(false);
  const [newNotePath, setNewNotePath] = useState("");
  const [newNoteContent, setNewNoteContent] = useState("---\ntags:\n  - note\n  - status/active\n---\n\n# New Note\n\n");
  const [newNoteBusy, setNewNoteBusy] = useState(false);
  const [newNoteError, setNewNoteError] = useState("");
  const graphContainerRef = useRef<HTMLDivElement>(null);
  const [graphDimensions, setGraphDimensions] = useState({ width: 800, height: 600 });

  useEffect(() => {
    if (!scope) { api.getBrains().then(setBrains).catch(() => {}); }
  }, [scope]);

  const fetchGraph = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getBrainGraph(activeBrain);
      setGraphData(data);
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  }, [activeBrain]);

  useEffect(() => { fetchGraph(); }, [fetchGraph]);

  useEffect(() => {
    const el = graphContainerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setGraphDimensions({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleNodeClick = useCallback((nodeId: string) => { setSelectedNote(nodeId); }, []);
  const handleNavigate = useCallback((path: string) => {
    // Cross-brain navigation: "scope:path" format (e.g. "common:knowledge/entities/foo.md")
    const colonIdx = path.indexOf(":");
    if (colonIdx > 0 && !path.startsWith("/")) {
      const newScope = path.slice(0, colonIdx);
      const notePath = path.slice(colonIdx + 1);
      if (newScope !== activeBrain) {
        setActiveBrain(newScope);
        // Delay note selection until graph reloads for new brain
        setTimeout(() => setSelectedNote(notePath), 500);
        return;
      }
      setSelectedNote(notePath);
      return;
    }
    setSelectedNote(path);
  }, [activeBrain]);
  const handleClose = useCallback(() => { setSelectedNote(null); setFullScreen(false); }, []);
  const handleNoteUpdated = useCallback(() => { fetchGraph(); }, [fetchGraph]);

  async function handleCreateNote() {
    if (!newNotePath.trim() || !newNoteContent.trim()) return;
    setNewNoteBusy(true);
    setNewNoteError("");
    try {
      await api.createBrainNote(newNotePath.trim(), newNoteContent, activeBrain, true);
      setShowNewNote(false);
      setNewNotePath("");
      setNewNoteContent("---\ntags:\n  - note\n  - status/active\n---\n\n# New Note\n\n");
      fetchGraph();
      setSelectedNote(newNotePath.trim());
    } catch (err: any) { setNewNoteError(err.message); }
    finally { setNewNoteBusy(false); }
  }

  const stats = graphData ? { notes: graphData.nodes.length, links: graphData.links.length } : null;

  // Full-screen note
  if (fullScreen && selectedNote && graphData) {
    return (
      <div className="flex flex-col h-[calc(100vh-10rem)]">
        <div className="flex-1 rounded-xl overflow-hidden glass-card">
          <BrainNoteReader
            notePath={selectedNote} scope={activeBrain}
            onNavigate={handleNavigate} onClose={handleClose}
            onExpand={() => setFullScreen(false)} isExpanded={true}
            titleToPath={graphData.titleToPath} onNoteUpdated={handleNoteUpdated}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-10rem)]">
      {/* Row 1: Brain selector + view toggle + actions */}
      <div className="flex items-center gap-2 mb-2">
        {!scope && (
          <select value={activeBrain} onChange={(e) => setActiveBrain(e.target.value)}
            className="px-2 py-1.5 bg-surface-input border border-theme rounded-lg text-xs text-theme-primary focus:outline-none shrink-0">
            {brains.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        )}
        <div className="flex rounded-lg border border-theme overflow-hidden shrink-0">
          <button onClick={() => setViewMode("graph")}
            className={`px-2.5 py-1 text-xs font-medium transition ${viewMode === "graph" ? "bg-accent-600 text-white" : "bg-surface-input text-theme-secondary"}`}>
            Graph
          </button>
          <button onClick={() => setViewMode("folders")}
            className={`px-2.5 py-1 text-xs font-medium transition ${viewMode === "folders" ? "bg-accent-600 text-white" : "bg-surface-input text-theme-secondary"}`}>
            Folders
          </button>
        </div>
        <div className="flex-1" />
        {stats && <span className="text-xs text-theme-muted hidden sm:inline">{stats.notes} notes</span>}
        <button onClick={() => setShowNewNote(!showNewNote)}
          className="px-2 py-1 text-xs bg-accent-600 hover:bg-accent-700 text-white rounded transition shrink-0">
          + Note
        </button>
        <button onClick={fetchGraph} className="p-1.5 rounded hover:bg-surface-hover text-theme-secondary transition shrink-0" title="Refresh">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* Row 2: Search + tag filters (only in graph mode) */}
      {viewMode === "graph" && (
        <div className="mb-2">
          <BrainSearch
            scope={activeBrain} onSelect={handleNodeClick}
            filterTags={filterTags} onFilterChange={setFilterTags}
            searchQuery={searchQuery} onSearchChange={setSearchQuery}
          />
        </div>
      )}

      {/* New note form */}
      {showNewNote && (
        <div className="mb-2 glass-card border border-theme p-3 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">New Note</h3>
            <button onClick={() => setShowNewNote(false)} className="text-theme-muted hover:text-theme-primary">&times;</button>
          </div>
          <input value={newNotePath} onChange={(e) => setNewNotePath(e.target.value)}
            placeholder="Path (e.g. knowledge/decisions/my-decision.md)" autoFocus
            className="w-full px-3 py-1.5 bg-surface-input border border-theme-input rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-accent-500" />
          <textarea value={newNoteContent} onChange={(e) => setNewNoteContent(e.target.value)} rows={6}
            className="w-full px-3 py-1.5 bg-surface-input border border-theme-input rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-accent-500 resize-y" />
          {newNoteError && <p className="text-red-400 text-xs">{newNoteError}</p>}
          <button onClick={handleCreateNote} disabled={newNoteBusy || !newNotePath.trim()}
            className="px-3 py-1 bg-accent-600 hover:bg-accent-700 text-white text-xs rounded transition disabled:opacity-50">
            {newNoteBusy ? "Creating..." : "Create"}
          </button>
        </div>
      )}

      {error && <div className="mb-2 p-2 bg-red-900/30 border border-red-700/50 rounded-lg text-xs text-red-300">{error}</div>}

      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Main content */}
      {!loading && graphData && (
        <>
          {viewMode === "graph" ? (
            /* Graph mode: graph left, reader right */
            <div className="flex-1 flex flex-col sm:flex-row gap-0 min-h-0 rounded-xl overflow-hidden glass-card">
              <div ref={graphContainerRef}
                className={`relative overflow-hidden transition-all duration-300 ${selectedNote ? "h-2/5 sm:h-auto sm:w-3/5" : "h-full sm:w-full"}`}
                style={{ minHeight: 0 }}>
                <BrainGraphView
                  data={graphData} selectedNode={selectedNote} onNodeClick={handleNodeClick}
                  filterTags={filterTags} searchHighlight={searchQuery}
                  width={graphDimensions.width} height={graphDimensions.height}
                />
                <div className="absolute bottom-2 left-2 flex gap-1.5 flex-wrap opacity-50 hover:opacity-100 transition pointer-events-none">
                  {[["decision","#3b82f6"],["pattern","#22c55e"],["correction","#ef4444"],["entity","#a855f7"],["project","#f97316"],["context","#eab308"]].map(([l,c]) => (
                    <div key={l} className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: c }} />
                      <span className="text-[9px] text-gray-400">{l}</span>
                    </div>
                  ))}
                </div>
              </div>
              {selectedNote && (
                <div className="h-3/5 sm:h-auto sm:w-2/5 border-t sm:border-t-0 sm:border-l border-theme overflow-hidden flex-shrink-0">
                  <BrainNoteReader
                    notePath={selectedNote} scope={activeBrain}
                    onNavigate={handleNavigate} onClose={handleClose}
                    onExpand={() => setFullScreen(true)} isExpanded={false}
                    titleToPath={graphData.titleToPath} onNoteUpdated={handleNoteUpdated}
                  />
                </div>
              )}
            </div>
          ) : (
            /* Folder mode: file list left, reader right */
            <div className="flex-1 flex flex-col sm:flex-row gap-0 min-h-0 rounded-xl overflow-hidden glass-card">
              <div className={`overflow-hidden transition-all duration-300 ${selectedNote ? "h-2/5 sm:h-auto sm:w-2/5" : "h-full sm:w-full"}`}>
                <BrainTreeView scope={activeBrain} selectedNote={selectedNote} onSelect={handleNodeClick} />
              </div>
              {selectedNote && (
                <div className="h-3/5 sm:h-auto sm:flex-1 border-t sm:border-t-0 sm:border-l border-theme overflow-hidden">
                  <BrainNoteReader
                    notePath={selectedNote} scope={activeBrain}
                    onNavigate={handleNavigate} onClose={handleClose}
                    onExpand={() => setFullScreen(true)} isExpanded={false}
                    titleToPath={graphData.titleToPath} onNoteUpdated={handleNoteUpdated}
                  />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
