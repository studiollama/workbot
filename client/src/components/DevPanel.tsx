import { useState, useEffect, useCallback } from "react";
import { api, type DevProject, type DevStatus, type GitCommit, type GitIssue, type GitPR } from "../api/client";

export default function DevPanel({ scope }: { scope?: string } = {}) {
  const [status, setStatus] = useState<DevStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [projectName, setProjectName] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [migrating, setMigrating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await api.getDevStatus(scope);
      setStatus(s);
    } catch {} finally { setLoading(false); }
  }, [scope]);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleAdd() {
    if (!repoUrl.trim()) return;
    setAddBusy(true);
    setError("");
    try {
      await api.addDevProject(repoUrl.trim(), projectName.trim() || undefined, scope);
      setRepoUrl("");
      setProjectName("");
      setShowAdd(false);
      refresh();
    } catch (err: any) { setError(err.message); }
    finally { setAddBusy(false); }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-12"><div className="w-5 h-5 border-2 border-surface-hover border-t-accent-600 rounded-full animate-spin" /></div>;
  }

  if (!status?.githubConnected) {
    return (
      <div className="glass-card p-4 sm:p-6 space-y-3">
        <h3 className="font-medium">Connect GitHub</h3>
        <p className="text-sm text-theme-secondary">Connect a GitHub service in the Services tab to use development projects.</p>
      </div>
    );
  }

  const projects = status?.projects ?? [];

  async function handleMigrate() {
    setMigrating(true);
    setError("");
    try {
      const result = await api.migrateDevFolder();
      if (result.ok) refresh();
      else setError(result.message || "Migration failed");
    } catch (err: any) { setError(err.message); }
    finally { setMigrating(false); }
  }

  // Detail view for selected project
  if (selectedProject) {
    const project = projects.find((p) => p.id === selectedProject);
    if (!project) { setSelectedProject(null); return null; }
    return (
      <ProjectDetail
        project={project}
        onBack={() => setSelectedProject(null)}
        onRefresh={refresh}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-semibold">Development Projects</h2>
          <p className="text-xs text-theme-muted">{projects.length} project{projects.length !== 1 ? "s" : ""}</p>
        </div>
        <button onClick={() => setShowAdd(!showAdd)}
          className="px-3 py-1.5 bg-accent-600 hover:bg-accent-700 text-white text-sm font-medium rounded-lg transition">
          {showAdd ? "Cancel" : "+ Add Project"}
        </button>
      </div>

      {error && <div className="bg-status-error border rounded-lg p-2 text-xs status-error">{error}</div>}

      {/* Migration banner for old single-folder setup */}
      {status?.needsMigration && projects.length === 0 && (
        <div className="glass-card p-4 space-y-2 border-yellow-500/30">
          <div className="flex items-start gap-3">
            <span className="text-yellow-500 text-lg shrink-0">&#9888;</span>
            <div className="flex-1">
              <h3 className="text-sm font-medium">Legacy Development Folder Detected</h3>
              <p className="text-xs text-theme-secondary mt-1">
                Your <code className="text-theme-primary">development/</code> folder contains a single cloned repo from the old setup.
                Convert it to the new multi-project format to continue using it.
              </p>
            </div>
            <button onClick={handleMigrate} disabled={migrating}
              className="px-3 py-1.5 bg-accent-600 hover:bg-accent-700 text-white text-sm rounded-lg transition disabled:opacity-50 shrink-0">
              {migrating ? "Migrating..." : "Convert"}
            </button>
          </div>
        </div>
      )}

      {/* Add form */}
      {showAdd && (
        <div className="glass-card p-4 space-y-3">
          <input value={projectName} onChange={(e) => setProjectName(e.target.value)}
            placeholder="Project name (optional, defaults to repo name)"
            className="w-full px-3 py-2 glass-input text-sm" />
          <input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="GitHub URL (https://github.com/owner/repo)" autoFocus
            className="w-full px-3 py-2 glass-input text-sm font-mono" />
          <button onClick={handleAdd} disabled={addBusy || !repoUrl.trim()}
            className="px-4 py-1.5 bg-accent-600 hover:bg-accent-700 text-white text-sm rounded-lg transition disabled:opacity-50">
            {addBusy ? "Adding..." : "Add Project"}
          </button>
        </div>
      )}

      {/* Cards grid */}
      {projects.length === 0 && !showAdd && (
        <div className="glass-card p-8 text-center text-theme-muted space-y-3">
          <p>No development projects yet.</p>
          <button onClick={() => setShowAdd(true)} className="text-sm text-accent-400 hover:text-accent-300 transition">
            Add your first project
          </button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {projects.map((p) => (
          <ProjectCard key={p.id} project={p} onSelect={() => setSelectedProject(p.id)} onRefresh={refresh} />
        ))}
      </div>
    </div>
  );
}

// ── Project Card ──────────────────────────────────────────────────────

function ProjectCard({ project: p, onSelect, onRefresh }: {
  project: DevProject;
  onSelect: () => void;
  onRefresh: () => void;
}) {
  const [cloning, setCloning] = useState(false);

  async function handleClone() {
    setCloning(true);
    try {
      await api.cloneDevProject(p.id);
      // Poll for completion
      const poll = setInterval(async () => {
        const s = await api.getDevStatus();
        const proj = s.projects.find((x) => x.id === p.id);
        if (proj && proj.cloneStatus !== "cloning") {
          clearInterval(poll);
          setCloning(false);
          onRefresh();
        }
      }, 2000);
      setTimeout(() => { clearInterval(poll); setCloning(false); }, 120000);
    } catch { setCloning(false); }
  }

  async function handleDelete() {
    if (!confirm(`Delete project "${p.name}"?\n\nThis will remove the cloned files.`)) return;
    try { await api.removeDevProject(p.id); onRefresh(); } catch {}
  }

  const isCloned = p.cloneStatus === "cloned";
  const isError = p.cloneStatus === "error";
  const isCloning = p.cloneStatus === "cloning" || cloning;

  return (
    <div className="glass-card p-4 space-y-3 cursor-pointer hover:border-accent-500/30 transition" onClick={onSelect}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-medium truncate">{p.name}</h3>
          <p className="text-xs text-theme-muted truncate font-mono">{p.owner}/{p.repo}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          {!isCloned && !isCloning && (
            <button onClick={handleClone} className="px-2 py-1 text-xs bg-accent-600 hover:bg-accent-700 text-white rounded transition">
              Clone
            </button>
          )}
          {isCloned && (
            <button onClick={handleClone} className="px-2 py-1 text-xs bg-surface-input hover:bg-surface-hover text-theme-secondary rounded transition">
              Pull
            </button>
          )}
          <button onClick={handleDelete} className="px-2 py-1 text-xs text-theme-muted hover:text-red-400 transition">
            Delete
          </button>
        </div>
      </div>

      {/* Status */}
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${isCloned ? "bg-green-500" : isError ? "bg-red-500" : isCloning ? "bg-yellow-500 animate-pulse" : "bg-gray-500"}`} />
        <span className="text-xs text-theme-secondary">
          {isCloning ? "Cloning..." : isCloned ? "Cloned" : isError ? "Error" : "Not cloned"}
        </span>
        {p.lastClonedAt && (
          <span className="text-[10px] text-theme-muted ml-auto">
            {new Date(p.lastClonedAt).toLocaleDateString()}
          </span>
        )}
      </div>

      {isError && p.cloneError && (
        <p className="text-xs status-error truncate">{p.cloneError}</p>
      )}
    </div>
  );
}

// ── Project Detail View ───────────────────────────────────────────────

function ProjectDetail({ project, onBack, onRefresh }: {
  project: DevProject;
  onBack: () => void;
  onRefresh: () => void;
}) {
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [issues, setIssues] = useState<GitIssue[]>([]);
  const [pulls, setPulls] = useState<GitPR[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"commits" | "issues" | "prs">("commits");

  useEffect(() => {
    Promise.all([
      api.getProjectCommits(project.id).catch(() => []),
      api.getProjectIssues(project.id).catch(() => []),
      api.getProjectPulls(project.id).catch(() => []),
    ]).then(([c, i, p]) => {
      setCommits(c); setIssues(i); setPulls(p);
    }).finally(() => setLoading(false));
  }, [project.id]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 rounded hover:bg-surface-hover text-theme-secondary transition">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="min-w-0">
          <h2 className="text-base sm:text-lg font-semibold truncate">{project.name}</h2>
          <p className="text-xs text-theme-muted font-mono">{project.owner}/{project.repo}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 border-b border-theme">
        {(["commits", "issues", "prs"] as const).map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-3 py-2 text-xs font-medium transition border-b-2 -mb-px capitalize ${
              activeTab === tab ? "border-accent-500 text-theme-primary" : "border-transparent text-theme-secondary hover:text-theme-primary"
            }`}>
            {tab === "prs" ? "Pull Requests" : tab} ({tab === "commits" ? commits.length : tab === "issues" ? issues.length : pulls.length})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><div className="w-5 h-5 border-2 border-surface-hover border-t-accent-600 rounded-full animate-spin" /></div>
      ) : (
        <div className="space-y-2">
          {activeTab === "commits" && commits.map((c) => (
            <div key={c.sha} className="glass-card p-3 flex items-start gap-3">
              <code className="text-xs text-accent-400 shrink-0 pt-0.5">{c.sha}</code>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-theme-primary truncate">{c.message}</p>
                <p className="text-[10px] text-theme-muted">{c.author} &middot; {c.date ? new Date(c.date).toLocaleDateString() : ""}</p>
              </div>
            </div>
          ))}

          {activeTab === "issues" && issues.map((i) => (
            <div key={i.number} className="glass-card p-3 flex items-start gap-3">
              <span className="text-xs text-theme-muted shrink-0">#{i.number}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-theme-primary truncate">{i.title}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-theme-muted">{i.user}</span>
                  {i.labels?.map((l) => (
                    <span key={l} className="px-1.5 py-0.5 text-[9px] rounded bg-surface-input text-theme-secondary">{l}</span>
                  ))}
                </div>
              </div>
            </div>
          ))}

          {activeTab === "prs" && pulls.map((p) => (
            <div key={p.number} className="glass-card p-3 flex items-start gap-3">
              <span className="text-xs text-theme-muted shrink-0">#{p.number}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-theme-primary truncate">{p.title}</p>
                <p className="text-[10px] text-theme-muted">{p.user} &middot; {p.head} &rarr; {p.base}</p>
              </div>
            </div>
          ))}

          {((activeTab === "commits" && commits.length === 0) ||
            (activeTab === "issues" && issues.length === 0) ||
            (activeTab === "prs" && pulls.length === 0)) && (
            <div className="text-center py-8 text-theme-muted text-sm">
              No {activeTab === "prs" ? "pull requests" : activeTab} found
            </div>
          )}
        </div>
      )}
    </div>
  );
}
