import { useState, useEffect, useCallback } from "react";
import { api } from "../api/client";

interface SubagentSummary {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  allowedServices: string[];
  brainPath: string;
  claudeAuth: { mode: string };
  autoSpawn?: boolean;
  commonReadOnly?: boolean;
  session: { pid: number; startedAt: string } | null;
}

interface SubagentUserInfo {
  username: string;
  subagentId: string;
  keyHolder: boolean;
}

export default function SubagentsPanel() {
  const [subagents, setSubagents] = useState<SubagentSummary[]>([]);
  const [users, setUsers] = useState<SubagentUserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [connectedServices, setConnectedServices] = useState<string[]>([]);

  const fetchSubagents = useCallback(async () => {
    try {
      const [subs, status, userList] = await Promise.all([
        api.getSubagents(),
        api.getServicesStatus(),
        api.listUsers().catch(() => [] as SubagentUserInfo[]),
      ]);
      setSubagents(subs);
      setUsers(userList);
      setConnectedServices(
        Object.entries(status)
          .filter(([, v]) => v.connected)
          .map(([k]) => k)
      );
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchSubagents(); }, [fetchSubagents]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Subagents</h2>
          <p className="text-xs text-theme-muted mt-0.5">Isolated agents with scoped brains and services</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-3 py-1.5 bg-accent-600 hover:bg-accent-700 text-white text-sm font-medium rounded-lg transition"
        >
          + New Subagent
        </button>
      </div>

      {error && <div className="bg-status-error border rounded-lg p-2 text-red-300 text-xs">{error}</div>}

      {showCreate && (
        <CreateSubagentForm
          connectedServices={connectedServices}
          onCreate={() => { setShowCreate(false); fetchSubagents(); }}
          onCancel={() => setShowCreate(false)}
          onError={setError}
        />
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-gray-600 border-t-gray-200 rounded-full animate-spin" />
        </div>
      ) : subagents.length === 0 && !showCreate ? (
        <div className="bg-surface-card/50 border border-theme border-dashed rounded-xl p-8 text-center text-theme-muted space-y-3">
          <p>No subagents yet.</p>
          <button onClick={() => setShowCreate(true)} className="text-sm text-accent-400 hover:text-accent-300 transition">
            Create your first subagent
          </button>
        </div>
      ) : (
        <div className="grid gap-3">
          {subagents.map((s) => (
            <SubagentCard
              key={s.id}
              subagent={s}
              connectedServices={connectedServices}
              assignedUser={users.find((u) => u.subagentId === s.id) ?? null}
              onToggle={async () => {
                try { await api.updateSubagent(s.id, { enabled: !s.enabled }); fetchSubagents(); }
                catch (err: any) { setError(err.message); }
              }}
              onSpawn={async () => {
                try { setError(""); await api.spawnSubagent(s.id); fetchSubagents(); }
                catch (err: any) { setError(err.message); }
              }}
              onDelete={async () => {
                if (!confirm(
                  `Delete subagent "${s.name}"?\n\n` +
                  `This will:\n` +
                  `  - Kill all running sessions and terminals\n` +
                  `  - Remove the Linux user (sa-${s.id})\n` +
                  `  - Remove Claude credentials\n` +
                  `  - Archive the brain to workbot-brain/archive/subagents/\n\n` +
                  `The brain data will NOT be permanently deleted — it can be recovered from the archive.`
                )) return;
                try {
                  const result = await api.deleteSubagent(s.id) as any;
                  if (result.archivePath) {
                    setError(`Subagent deleted. Brain archived to: ${result.archivePath}`);
                  }
                  fetchSubagents();
                } catch (err: any) { setError(err.message); }
              }}
              onRefresh={fetchSubagents}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SubagentCard({ subagent: s, onToggle, onSpawn, onDelete, onRefresh, connectedServices, assignedUser }: {
  subagent: SubagentSummary;
  onToggle: () => void;
  onSpawn: () => void;
  onDelete: () => void;
  onRefresh: () => void;
  connectedServices: string[];
  assignedUser: SubagentUserInfo | null;
}) {
  const [authStatus, setAuthStatus] = useState<{ mode: string; authenticated: boolean } | null>(null);
  const [terminalLoading, setTerminalLoading] = useState(false);
  const [showServices, setShowServices] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(s.name);
  const [showUserForm, setShowUserForm] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newKeyHolder, setNewKeyHolder] = useState(false);
  const [userBusy, setUserBusy] = useState(false);
  const [userError, setUserError] = useState("");

  useEffect(() => {
    if (s.claudeAuth.mode === "oauth") {
      api.getSubagentAuthStatus(s.id).then(setAuthStatus).catch(() => {});
    }
  }, [s.id, s.claudeAuth.mode]);

  async function handleTerminal() {
    setTerminalLoading(true);
    try {
      const result = await api.startTerminal(s.id);
      if (result.url) {
        window.open(result.url, `terminal-${s.id}`);
      }
    } catch (err: any) {
      console.error("Terminal failed:", err);
    } finally {
      setTerminalLoading(false);
    }
  }

  async function toggleService(svc: string) {
    const current = s.allowedServices;
    const updated = current.includes(svc)
      ? current.filter((k) => k !== svc)
      : [...current, svc];
    try {
      await api.updateSubagent(s.id, { allowedServices: updated });
      onRefresh();
    } catch { /* ignore */ }
  }

  return (
    <div className="glass-card p-3 sm:p-4 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 sm:gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {editingName ? (
              <form
                className="flex items-center gap-1"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const trimmed = nameValue.trim();
                  if (!trimmed || trimmed === s.name) { setEditingName(false); setNameValue(s.name); return; }
                  try {
                    await api.updateSubagent(s.id, { name: trimmed });
                    setEditingName(false);
                    onRefresh();
                  } catch { setNameValue(s.name); setEditingName(false); }
                }}
              >
                <input
                  value={nameValue}
                  onChange={(e) => setNameValue(e.target.value)}
                  onBlur={() => { setEditingName(false); setNameValue(s.name); }}
                  onKeyDown={(e) => { if (e.key === "Escape") { setEditingName(false); setNameValue(s.name); } }}
                  autoFocus
                  className="w-40 px-2 py-0.5 text-sm font-medium bg-surface-input border border-accent-500 rounded text-theme-primary focus:outline-none"
                />
              </form>
            ) : (
              <a
                href={`/subagent/${s.id}`}
                className="font-medium hover:text-accent-400 transition"
                onDoubleClick={(e) => { e.preventDefault(); setEditingName(true); }}
                title="Double-click to rename"
              >
                {s.name}
              </a>
            )}
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.enabled ? "bg-green-500" : "bg-gray-500"}`} />
            {s.session && (
              <span className="px-1.5 py-0.5 text-[10px] bg-blue-500/15 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400 rounded font-medium">running</span>
            )}
          </div>
          {s.description && <p className="text-xs text-theme-secondary mt-0.5 truncate">{s.description}</p>}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap">
          {s.session ? (
            <button onClick={async () => {
              try { await api.stopSubagent(s.id); onRefresh(); } catch {}
            }} className="px-2 py-1 text-xs bg-red-700 hover:bg-red-600 text-white rounded transition">
              Stop
            </button>
          ) : (
            <button onClick={onSpawn} disabled={!s.enabled} className="px-2 py-1 text-xs bg-accent-600 hover:bg-accent-700 text-white rounded transition disabled:opacity-50">
              Spawn
            </button>
          )}
          <button onClick={handleTerminal} disabled={!s.enabled || terminalLoading}
            className="px-2 py-1 text-xs bg-teal-700 hover:bg-teal-600 text-white rounded transition disabled:opacity-50">
            {terminalLoading ? "..." : "Terminal"}
          </button>
          <a href={`/subagent/${s.id}`} className="px-2 py-1 text-xs bg-surface-input hover:bg-surface-hover text-theme-secondary rounded transition">
            Dashboard
          </a>
          <button onClick={onToggle} className="px-2 py-1 text-xs bg-surface-input hover:bg-surface-hover text-theme-secondary rounded transition">
            {s.enabled ? "Disable" : "Enable"}
          </button>
          <button onClick={onDelete} className="px-2 py-1 text-xs text-theme-secondary hover:text-red-400 transition">
            Delete
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-theme-muted">
        <span>Brain: <code className="text-theme-secondary">{s.brainPath}</code></span>
        <button onClick={() => setShowServices(!showServices)} className="text-accent-400 hover:text-accent-300 transition">
          {s.allowedServices.length} service{s.allowedServices.length !== 1 ? "s" : ""} {showServices ? "^" : "v"}
        </button>
        <span className="flex items-center gap-1">
          {s.claudeAuth.mode}
          {s.claudeAuth.mode === "oauth" && authStatus && (
            <span className={`w-1.5 h-1.5 rounded-full ${authStatus.authenticated ? "bg-green-500" : "bg-red-500"}`} />
          )}
        </span>
        <label className="flex items-center gap-1 cursor-pointer" title="Auto-spawn on container restart">
          <input type="checkbox" checked={!!s.autoSpawn}
            onChange={async () => {
              try { await api.updateSubagent(s.id, { autoSpawn: !s.autoSpawn }); onRefresh(); } catch {}
            }}
            className="rounded w-3 h-3" />
          <span className="text-[10px]">auto</span>
        </label>
        <label className="flex items-center gap-1 cursor-pointer" title="Common knowledge: read-only (no write/commit)">
          <input type="checkbox" checked={!!s.commonReadOnly}
            onChange={async () => {
              try { await api.updateSubagent(s.id, { commonReadOnly: !s.commonReadOnly }); onRefresh(); } catch {}
            }}
            className="rounded w-3 h-3" />
          <span className="text-[10px]">common RO</span>
        </label>
      </div>

      {/* Inline service editor */}
      {showServices && (
        <div className="bg-surface-input/50 rounded-lg p-3 space-y-2">
          <p className="text-[10px] text-theme-muted">Click to toggle. Only connected host services are shown.</p>
          <div className="flex flex-wrap gap-1.5">
            {connectedServices.map((svc) => {
              const assigned = s.allowedServices.includes(svc);
              return (
                <button key={svc} onClick={() => toggleService(svc)}
                  className={`px-2 py-1 text-[11px] rounded transition ${
                    assigned
                      ? "bg-accent-600/30 text-accent-300 border border-accent-500/40"
                      : "bg-surface-input text-theme-muted border border-transparent hover:border-theme-input"
                  }`}>
                  {assigned ? "+" : ""} {svc}
                </button>
              );
            })}
            {connectedServices.length === 0 && (
              <p className="text-xs text-theme-muted">No services connected on host.</p>
            )}
          </div>
        </div>
      )}

      {/* Service badges */}
      {!showServices && s.allowedServices.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {s.allowedServices.map((svc) => (
            <span key={svc} className="px-1.5 py-0.5 text-[10px] bg-surface-input text-theme-secondary rounded">{svc}</span>
          ))}
        </div>
      )}

      {/* User access */}
      <div className="border-t border-theme/50 pt-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-theme-muted uppercase tracking-wider">Dashboard Login</span>
          {assignedUser ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-theme-secondary">
                <span className="text-accent-400">{assignedUser.username}</span>
              </span>
              {assignedUser.keyHolder && (
                <span className="px-1.5 py-0.5 text-[10px] bg-yellow-900/50 text-yellow-400 rounded">key holder</span>
              )}
              <button
                onClick={async () => {
                  if (!confirm(`Remove login access for "${assignedUser.username}"?`)) return;
                  try {
                    await api.deleteUser(assignedUser.username);
                    onRefresh();
                  } catch (err: any) { setUserError(err.message); }
                }}
                className="text-[10px] text-theme-secondary hover:text-red-400 transition"
              >
                Remove
              </button>
            </div>
          ) : showUserForm ? (
            <div className="flex items-center gap-2 flex-wrap">
              <input
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="Username"
                className="w-24 px-2 py-1 text-xs bg-surface-input border border-theme-input rounded text-theme-primary focus:outline-none"
              />
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Password"
                className="w-24 px-2 py-1 text-xs bg-surface-input border border-theme-input rounded text-theme-primary focus:outline-none"
              />
              <label className="flex items-center gap-1 text-[10px] text-theme-secondary cursor-pointer" title="Key holders can unlock services for all agents on login">
                <input type="checkbox" checked={newKeyHolder} onChange={(e) => setNewKeyHolder(e.target.checked)} className="rounded w-3 h-3" />
                Key Holder
              </label>
              <button
                disabled={userBusy || !newUsername || !newPassword}
                onClick={async () => {
                  setUserBusy(true);
                  setUserError("");
                  try {
                    await api.createUser(newUsername, newPassword, s.id, newKeyHolder);
                    setShowUserForm(false);
                    setNewUsername("");
                    setNewPassword("");
                    setNewKeyHolder(false);
                    onRefresh();
                  } catch (err: any) { setUserError(err.message); }
                  finally { setUserBusy(false); }
                }}
                className="px-2 py-1 text-[10px] bg-accent-600 hover:bg-accent-700 text-white rounded transition disabled:opacity-50"
              >
                {userBusy ? "..." : "Save"}
              </button>
              <button
                onClick={() => { setShowUserForm(false); setUserError(""); }}
                className="text-[10px] text-theme-secondary hover:text-theme-primary transition"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowUserForm(true)}
              className="text-[10px] text-accent-400 hover:text-accent-300 transition"
            >
              + Assign Login
            </button>
          )}
        </div>
        {userError && <p className="text-[10px] text-red-400 mt-1">{userError}</p>}
      </div>
    </div>
  );
}

function CreateSubagentForm({ connectedServices, onCreate, onCancel, onError }: {
  connectedServices: string[];
  onCreate: () => void;
  onCancel: () => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [authMode, setAuthMode] = useState<"host-spawned" | "oauth">("host-spawned");
  const [bypassPerms, setBypassPerms] = useState(true);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { onError("Name is required"); return; }
    setBusy(true);
    try {
      await api.createSubagent({ name, description, allowedServices: selectedServices, claudeAuth: { mode: authMode }, bypassPermissions: bypassPerms });
      onCreate();
    } catch (err: any) {
      onError(err.message);
    } finally { setBusy(false); }
  }

  function toggleService(svc: string) {
    setSelectedServices((prev) =>
      prev.includes(svc) ? prev.filter((s) => s !== svc) : [...prev, svc]
    );
  }

  return (
    <form onSubmit={handleSubmit} className="glass-card p-4 space-y-3">
      <h3 className="text-sm font-medium">Create Subagent</h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-theme-secondary mb-1">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus required
            className="w-full px-3 py-2 bg-surface-input border border-theme-input rounded-lg text-sm text-theme-primary focus:outline-none focus:ring-1 focus:ring-accent-500" />
        </div>
        <div>
          <label className="block text-xs text-theme-secondary mb-1">Description</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 bg-surface-input border border-theme-input rounded-lg text-sm text-theme-primary focus:outline-none focus:ring-1 focus:ring-accent-500" />
        </div>
      </div>

      <div>
        <label className="block text-xs text-theme-secondary mb-1">Claude Auth Mode</label>
        <select value={authMode} onChange={(e) => setAuthMode(e.target.value as any)}
          className="w-full px-3 py-2 bg-surface-input border border-theme-input rounded-lg text-sm text-theme-primary focus:outline-none">
          <option value="host-spawned">Host Spawned (uses host's Claude account)</option>
          <option value="oauth">OAuth (separate Claude account)</option>
        </select>
        {authMode === "oauth" && (
          <p className="text-[10px] text-theme-muted mt-1">Configure OAuth login after creating the subagent.</p>
        )}
      </div>

      <label className="flex items-center gap-2 text-xs text-theme-secondary cursor-pointer">
        <input type="checkbox" checked={bypassPerms} onChange={(e) => setBypassPerms(e.target.checked)} className="rounded" />
        Bypass permissions (no confirmation prompts)
      </label>

      <div>
        <label className="block text-xs text-theme-secondary mb-2">Allowed Services</label>
        {connectedServices.length === 0 ? (
          <p className="text-xs text-theme-muted">No services connected on host. Connect services first.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {connectedServices.map((svc) => (
              <label key={svc} className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="checkbox" checked={selectedServices.includes(svc)}
                  onChange={() => toggleService(svc)} className="rounded" />
                <span className="text-theme-secondary">{svc}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm text-theme-secondary hover:text-theme-primary transition">
          Cancel
        </button>
        <button type="submit" disabled={busy}
          className="px-3 py-1.5 bg-accent-600 hover:bg-accent-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
          {busy ? "Creating..." : "Create"}
        </button>
      </div>
    </form>
  );
}
