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
  session: { pid: number; startedAt: string } | null;
}

export default function SubagentsPanel() {
  const [subagents, setSubagents] = useState<SubagentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [connectedServices, setConnectedServices] = useState<string[]>([]);

  const fetchSubagents = useCallback(async () => {
    try {
      const [subs, status] = await Promise.all([
        api.getSubagents(),
        api.getServicesStatus(),
      ]);
      setSubagents(subs);
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

      {error && <div className="bg-red-900/50 border border-red-700 rounded-lg p-2 text-red-300 text-xs">{error}</div>}

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
              onToggle={async () => {
                try { await api.updateSubagent(s.id, { enabled: !s.enabled }); fetchSubagents(); }
                catch (err: any) { setError(err.message); }
              }}
              onSpawn={async () => {
                try { setError(""); await api.spawnSubagent(s.id); fetchSubagents(); }
                catch (err: any) { setError(err.message); }
              }}
              onDelete={async () => {
                if (!confirm(`Delete subagent "${s.name}"?`)) return;
                try { await api.deleteSubagent(s.id); fetchSubagents(); }
                catch (err: any) { setError(err.message); }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SubagentCard({ subagent: s, onToggle, onSpawn, onDelete }: {
  subagent: SubagentSummary;
  onToggle: () => void;
  onSpawn: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="bg-surface-card rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <a href={`/subagent/${s.id}`} className="font-medium hover:text-accent-400 transition">{s.name}</a>
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.enabled ? "bg-green-500" : "bg-gray-500"}`} />
            {s.session && (
              <span className="px-1.5 py-0.5 text-[10px] bg-blue-900/50 text-blue-400 rounded">running</span>
            )}
          </div>
          {s.description && <p className="text-xs text-theme-secondary mt-0.5 truncate">{s.description}</p>}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button onClick={onSpawn} className="px-2 py-1 text-xs bg-accent-600 hover:bg-accent-700 text-white rounded transition">
            Spawn
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
        <span>{s.allowedServices.length} service{s.allowedServices.length !== 1 ? "s" : ""}</span>
        <span>{s.claudeAuth.mode}</span>
      </div>

      {s.allowedServices.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {s.allowedServices.map((svc) => (
            <span key={svc} className="px-1.5 py-0.5 text-[10px] bg-surface-input text-theme-secondary rounded">{svc}</span>
          ))}
        </div>
      )}
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
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { onError("Name is required"); return; }
    setBusy(true);
    try {
      await api.createSubagent({ name, description, allowedServices: selectedServices });
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
    <form onSubmit={handleSubmit} className="bg-surface-card rounded-xl p-4 space-y-3">
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
