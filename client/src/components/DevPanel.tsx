import { useState, useEffect, useRef } from "react";
import {
  api,
  type DevStatus,
  type GitCommit,
  type GitIssue,
  type GitPR,
  type EnvFile,
} from "../api/client";
import { useServices } from "../context/ServicesContext";

export default function DevPanel() {
  const { refresh: refreshServices } = useServices();
  const [status, setStatus] = useState<DevStatus | null>(null);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [issues, setIssues] = useState<GitIssue[]>([]);
  const [pulls, setPulls] = useState<GitPR[]>([]);
  const [envFiles, setEnvFiles] = useState<EnvFile[]>([]);
  const [repoInput, setRepoInput] = useState("");
  const [ghToken, setGhToken] = useState("");
  const [connectingGh, setConnectingGh] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);

  async function fetchStatus() {
    try {
      const s = await api.getDevStatus();
      setStatus(s);
      return s;
    } catch {
      setLoading(false);
      return null;
    }
  }

  async function fetchRepoData() {
    try {
      const [c, i, p, e] = await Promise.all([
        api.getDevCommits().catch(() => []),
        api.getDevIssues().catch(() => []),
        api.getDevPulls().catch(() => []),
        api.getDevEnvFiles().catch(() => []),
      ]);
      setCommits(c);
      setIssues(i);
      setPulls(p);
      setEnvFiles(e);
    } catch {
      // partial data is fine
    }
  }

  useEffect(() => {
    (async () => {
      const s = await fetchStatus();
      if (s?.cloneStatus === "cloned") await fetchRepoData();
      setLoading(false);
    })();
    return () => clearInterval(pollRef.current);
  }, []);

  // Poll while cloning or analyzing
  useEffect(() => {
    if (
      status?.cloneStatus === "cloning" ||
      status?.analysisStatus === "running"
    ) {
      pollRef.current = setInterval(async () => {
        const s = await fetchStatus();
        if (s?.cloneStatus === "cloned" && s?.analysisStatus !== "running") {
          clearInterval(pollRef.current);
          await fetchRepoData();
        }
      }, 3000);
      return () => clearInterval(pollRef.current);
    }
  }, [status?.cloneStatus, status?.analysisStatus]);

  async function handleSetRepo() {
    if (!repoInput.trim()) return;
    setError("");
    try {
      await api.setDevRepo(repoInput.trim());
      await fetchStatus();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleClone() {
    setError("");
    try {
      await api.startClone();
      await fetchStatus();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleRemove() {
    setError("");
    try {
      await api.removeDevRepo();
      setCommits([]);
      setIssues([]);
      setPulls([]);
      setEnvFiles([]);
      await fetchStatus();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleAnalyze() {
    setError("");
    try {
      await api.startAnalysis();
      await fetchStatus();
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-5 h-5 border-2 border-gray-600 border-t-gray-200 rounded-full animate-spin" />
      </div>
    );
  }

  // State: GitHub not connected — prompt for token inline
  if (!status?.githubConnected) {
    async function handleConnectGitHub(e?: React.FormEvent) {
      e?.preventDefault();
      if (!ghToken.trim()) return;
      setError("");
      setConnectingGh(true);
      try {
        await api.connectService("github", ghToken.trim());
        setGhToken("");
        await refreshServices();
        await fetchStatus();
      } catch (err: any) {
        setError(err.message);
      } finally {
        setConnectingGh(false);
      }
    }

    return (
      <div className="bg-surface-card rounded-xl p-6 space-y-4">
        <h3 className="font-medium">Connect GitHub</h3>
        <p className="text-sm text-theme-secondary">
          The Development tab needs a GitHub Personal Access Token to clone
          repos, read issues, and pull requests.
        </p>

        <div className="bg-surface-input border border-theme-input rounded-lg p-4 space-y-2 text-xs text-theme-secondary">
          <p className="font-medium text-theme-primary text-sm">Required token permissions:</p>
          <ul className="list-disc list-inside space-y-1">
            <li><span className="font-mono">repo</span> — full access to private repositories (clone, read, push)</li>
            <li><span className="font-mono">read:org</span> — read org membership (for org repos)</li>
            <li><span className="font-mono">read:project</span> — read project boards (optional)</li>
          </ul>
          <p className="pt-1">
            Create a token at{" "}
            <a
              href="https://github.com/settings/tokens/new?scopes=repo,read:org"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-400 hover:underline"
            >
              github.com/settings/tokens
            </a>{" "}
            — select <span className="font-mono">repo</span> and <span className="font-mono">read:org</span> scopes.
          </p>
        </div>

        {error && (
          <div className="bg-red-900/50 border border-red-700 rounded-lg p-2 text-red-300 text-xs">
            {error}
          </div>
        )}

        <form onSubmit={handleConnectGitHub} className="flex gap-2">
          <input
            type="password"
            value={ghToken}
            onChange={(e) => setGhToken(e.target.value)}
            placeholder="ghp_..."
            className="flex-1 bg-surface-input border border-theme-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 font-mono"
          />
          <button
            type="submit"
            disabled={!ghToken.trim() || connectingGh}
            className="bg-accent-600 hover:bg-accent-700 disabled:opacity-50 text-white text-sm font-medium py-2 px-4 rounded-lg transition"
          >
            {connectingGh ? "Connecting..." : "Connect"}
          </button>
        </form>
      </div>
    );
  }

  // State: No repo configured
  if (!status.repoUrl) {
    return (
      <div className="bg-surface-card rounded-xl p-6 space-y-4">
        <h3 className="font-medium">Set up a development project</h3>
        <p className="text-sm text-theme-secondary">
          Enter a GitHub repository URL to clone and work on.
        </p>
        {error && (
          <div className="bg-red-900/50 border border-red-700 rounded-lg p-2 text-red-300 text-xs">
            {error}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSetRepo();
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            placeholder="https://github.com/owner/repo"
            className="flex-1 bg-surface-input border border-theme-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 font-mono"
          />
          <button
            type="submit"
            disabled={!repoInput.trim()}
            className="bg-accent-600 hover:bg-accent-700 disabled:opacity-50 text-white text-sm font-medium py-2 px-4 rounded-lg transition"
          >
            Set Repository
          </button>
        </form>
      </div>
    );
  }

  // State: Repo set but not cloned / cloning / error
  if (status.cloneStatus !== "cloned") {
    return (
      <div className="bg-surface-card rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium">
              {status.owner}/{status.repo}
            </h3>
            <p className="text-xs text-theme-secondary font-mono">
              {status.repoUrl}
            </p>
          </div>
          <button
            onClick={handleRemove}
            className="text-xs text-theme-secondary hover:text-red-400 transition"
          >
            Remove
          </button>
        </div>

        {error && (
          <div className="bg-red-900/50 border border-red-700 rounded-lg p-2 text-red-300 text-xs">
            {error}
          </div>
        )}

        {status.cloneStatus === "cloning" && (
          <div className="flex items-center gap-3 text-sm text-theme-secondary">
            <div className="w-4 h-4 border-2 border-gray-600 border-t-gray-200 rounded-full animate-spin" />
            Cloning repository...
          </div>
        )}

        {status.cloneStatus === "error" && (
          <div className="space-y-2">
            <div className="bg-red-900/50 border border-red-700 rounded-lg p-2 text-red-300 text-xs">
              {status.cloneError}
            </div>
            <button
              onClick={handleClone}
              className="bg-accent-600 hover:bg-accent-700 text-white text-sm font-medium py-2 px-4 rounded-lg transition"
            >
              Retry Clone
            </button>
          </div>
        )}

        {status.cloneStatus === "idle" && (
          <button
            onClick={handleClone}
            className="bg-accent-600 hover:bg-accent-700 text-white text-sm font-medium py-2 px-4 rounded-lg transition"
          >
            Clone Repository
          </button>
        )}
      </div>
    );
  }

  // State: Active — repo cloned
  return (
    <div className="space-y-4">
      {/* Header card */}
      <div className="bg-surface-card rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium">
              {status.owner}/{status.repo}
            </h3>
            {status.lastClonedAt && (
              <p className="text-xs text-theme-secondary">
                Last updated: {new Date(status.lastClonedAt).toLocaleString()}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleClone}
              className="text-xs bg-surface-input hover:bg-surface-hover border border-theme-input rounded-lg px-3 py-1.5 transition"
            >
              Pull Latest
            </button>
            <button
              onClick={handleRemove}
              className="text-xs text-theme-secondary hover:text-red-400 transition"
            >
              Remove
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/50 border border-red-700 rounded-lg p-2 text-red-300 text-xs">
          {error}
        </div>
      )}

      {/* Repo overview: commits, issues, PRs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <CommitsList commits={commits} owner={status.owner!} repo={status.repo!} />
        <IssuesList issues={issues} owner={status.owner!} repo={status.repo!} />
        <PullsList pulls={pulls} owner={status.owner!} repo={status.repo!} />
      </div>

      {/* Env manager */}
      <EnvManager envFiles={envFiles} onRefresh={fetchRepoData} />

      {/* Analysis card */}
      <div className="bg-surface-card rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-medium">Brain Assimilation</h4>
            <p className="text-xs text-theme-secondary">
              Analyze this codebase and index findings into the workbot brain
            </p>
          </div>
          <div className="flex items-center gap-3">
            {status.analysisStatus === "running" && (
              <span className="flex items-center gap-2 text-xs text-theme-secondary">
                <span className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
                Analyzing...
              </span>
            )}
            {status.analysisStatus === "done" && (
              <span className="text-xs text-green-400">Complete</span>
            )}
            {status.analysisStatus === "error" && (
              <span className="text-xs text-red-400" title={status.analysisError ?? ""}>
                Failed
              </span>
            )}
            <button
              onClick={handleAnalyze}
              disabled={status.analysisStatus === "running"}
              className="bg-accent-600 hover:bg-accent-700 disabled:opacity-50 text-white text-xs font-medium py-1.5 px-3 rounded-lg transition"
            >
              {status.analysisStatus === "running" ? "Running..." : "Analyze"}
            </button>
          </div>
        </div>
        {status.analysisStatus === "error" && status.analysisError && (
          <div className="bg-red-900/50 border border-red-700 rounded-lg p-2 text-red-300 text-xs">
            {status.analysisError}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Sub-components ---

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function CommitsList({
  commits,
  owner,
  repo,
}: {
  commits: GitCommit[];
  owner: string;
  repo: string;
}) {
  return (
    <div className="bg-surface-card rounded-xl p-4 space-y-2">
      <h4 className="text-xs text-theme-secondary uppercase tracking-wider">
        Recent Commits ({commits.length})
      </h4>
      {commits.length === 0 ? (
        <p className="text-xs text-theme-muted">No commits found</p>
      ) : (
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {commits.map((c) => (
            <a
              key={c.sha}
              href={`https://github.com/${owner}/${repo}/commit/${c.sha}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-xs hover:bg-surface-input rounded p-1.5 transition"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-accent-400 shrink-0">
                  {c.sha}
                </span>
                <span className="text-theme-secondary truncate">
                  {c.author}
                </span>
                <span className="text-theme-muted ml-auto shrink-0">
                  {timeAgo(c.date)}
                </span>
              </div>
              <p className="text-theme-primary truncate mt-0.5">{c.message}</p>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function IssuesList({
  issues,
  owner,
  repo,
}: {
  issues: GitIssue[];
  owner: string;
  repo: string;
}) {
  return (
    <div className="bg-surface-card rounded-xl p-4 space-y-2">
      <h4 className="text-xs text-theme-secondary uppercase tracking-wider">
        Open Issues ({issues.length})
      </h4>
      {issues.length === 0 ? (
        <p className="text-xs text-theme-muted">No open issues</p>
      ) : (
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {issues.map((i) => (
            <a
              key={i.number}
              href={`https://github.com/${owner}/${repo}/issues/${i.number}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-xs hover:bg-surface-input rounded p-1.5 transition"
            >
              <div className="flex items-center gap-2">
                <span className="text-theme-muted">#{i.number}</span>
                <span className="truncate text-theme-primary">{i.title}</span>
              </div>
              {i.labels.length > 0 && (
                <div className="flex gap-1 mt-1 flex-wrap">
                  {i.labels.slice(0, 3).map((l) => (
                    <span
                      key={l}
                      className="px-1.5 py-0.5 bg-surface-input rounded text-[10px] text-theme-secondary"
                    >
                      {l}
                    </span>
                  ))}
                </div>
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function PullsList({
  pulls,
  owner,
  repo,
}: {
  pulls: GitPR[];
  owner: string;
  repo: string;
}) {
  return (
    <div className="bg-surface-card rounded-xl p-4 space-y-2">
      <h4 className="text-xs text-theme-secondary uppercase tracking-wider">
        Open PRs ({pulls.length})
      </h4>
      {pulls.length === 0 ? (
        <p className="text-xs text-theme-muted">No open pull requests</p>
      ) : (
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {pulls.map((p) => (
            <a
              key={p.number}
              href={`https://github.com/${owner}/${repo}/pull/${p.number}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-xs hover:bg-surface-input rounded p-1.5 transition"
            >
              <div className="flex items-center gap-2">
                <span className="text-theme-muted">#{p.number}</span>
                <span className="truncate text-theme-primary">{p.title}</span>
              </div>
              <div className="flex items-center gap-1 mt-1 text-[10px] text-theme-muted">
                <span className="font-mono">{p.head}</span>
                <span>→</span>
                <span className="font-mono">{p.base}</span>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function EnvManager({
  envFiles,
  onRefresh,
}: {
  envFiles: EnvFile[];
  onRefresh: () => Promise<void>;
}) {
  const [activeFile, setActiveFile] = useState(0);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<{
    file: string;
    entries: { key: string; value: string }[];
  } | null>(null);
  const [saving, setSaving] = useState(false);

  if (envFiles.length === 0) {
    return (
      <div className="bg-surface-card rounded-xl p-4">
        <h4 className="text-xs text-theme-secondary uppercase tracking-wider">
          Environment Files
        </h4>
        <p className="text-xs text-theme-muted mt-2">
          No .env files found in the project
        </p>
      </div>
    );
  }

  const current = envFiles[activeFile];

  async function handleReveal(filename: string) {
    if (revealed[filename]) {
      setRevealed((r) => ({ ...r, [filename]: false }));
      return;
    }
    try {
      const files = await api.getDevEnvFiles(true);
      const file = files.find((f) => f.filename === filename);
      if (file) {
        setEditing({ file: filename, entries: [...file.entries] });
        setRevealed((r) => ({ ...r, [filename]: true }));
      }
    } catch {
      // ignore
    }
  }

  async function handleSave() {
    if (!editing) return;
    setSaving(true);
    try {
      await api.updateDevEnvFile(editing.file, editing.entries);
      await onRefresh();
      setEditing(null);
      setRevealed({});
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  const displayEntries =
    editing && editing.file === current.filename
      ? editing.entries
      : current.entries;

  return (
    <div className="bg-surface-card rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs text-theme-secondary uppercase tracking-wider">
          Environment Files
        </h4>
        <div className="flex items-center gap-2">
          {envFiles.map((f, idx) => (
            <button
              key={f.filename}
              onClick={() => setActiveFile(idx)}
              className={`text-xs px-2 py-1 rounded transition ${
                idx === activeFile
                  ? "bg-accent-600 text-white"
                  : "bg-surface-input text-theme-secondary hover:text-theme-primary"
              }`}
            >
              {f.filename}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        {displayEntries.map((entry, idx) => (
          <div key={idx} className="flex items-center gap-2 text-xs font-mono">
            <span className="text-theme-secondary w-40 shrink-0 truncate">
              {entry.key}
            </span>
            <span className="text-theme-muted">=</span>
            {editing && editing.file === current.filename ? (
              <input
                type="text"
                value={entry.value}
                onChange={(e) => {
                  const newEntries = [...editing.entries];
                  newEntries[idx] = { ...newEntries[idx], value: e.target.value };
                  setEditing({ ...editing, entries: newEntries });
                }}
                className="flex-1 bg-surface-input border border-theme-input rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-accent-500"
              />
            ) : (
              <span className="text-theme-muted truncate">{entry.value}</span>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => handleReveal(current.filename)}
          className="text-xs text-theme-secondary hover:text-theme-primary transition"
        >
          {revealed[current.filename] ? "Hide values" : "Reveal & Edit"}
        </button>
        {editing && editing.file === current.filename && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-xs bg-accent-600 hover:bg-accent-700 disabled:opacity-50 text-white px-3 py-1 rounded-lg transition"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        )}
      </div>
    </div>
  );
}
