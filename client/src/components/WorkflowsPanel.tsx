import { useState, useEffect, useCallback } from "react";
import { api } from "../api/client";
import WorkflowEditor from "./WorkflowEditor";
import WorkflowRunView from "./WorkflowRunView";

interface WorkflowSummary {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  schedule?: { cron?: string };
  triggers?: { type: string; webhookId?: string }[];
  nodes: any[];
  edges: any[];
  lastRun: {
    runId: string;
    status: string;
    trigger: string;
    startedAt: string;
    completedAt?: string;
  } | null;
}

type View =
  | { type: "list" }
  | { type: "editor"; workflowId?: string }
  | { type: "run"; workflowId: string; runId: string }
  | { type: "history"; workflowId: string };

export default function WorkflowsPanel() {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>({ type: "list" });

  const fetchWorkflows = useCallback(async () => {
    try {
      const data = await api.getWorkflows();
      setWorkflows(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchWorkflows(); }, [fetchWorkflows]);

  if (view.type === "editor") {
    return (
      <WorkflowEditor
        workflowId={view.workflowId}
        onSave={() => { setView({ type: "list" }); fetchWorkflows(); }}
        onCancel={() => setView({ type: "list" })}
      />
    );
  }

  if (view.type === "history") {
    return (
      <WorkflowHistory
        workflowId={view.workflowId}
        onViewRun={(runId) => setView({ type: "run", workflowId: view.workflowId, runId })}
        onBack={() => setView({ type: "list" })}
      />
    );
  }

  if (view.type === "run") {
    return (
      <WorkflowRunView
        workflowId={view.workflowId}
        runId={view.runId}
        onBack={() => setView({ type: "list" })}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Workflows</h2>
          <p className="text-xs text-theme-muted mt-0.5">DAG-based task orchestration</p>
        </div>
        <button
          onClick={() => setView({ type: "editor" })}
          className="px-3 py-1.5 bg-accent-600 hover:bg-accent-700 text-white text-sm font-medium rounded-lg transition"
        >
          + New Workflow
        </button>
      </div>

      {error && (
        <div className="bg-red-900/50 border border-red-700 rounded-lg p-2 text-red-300 text-xs">{error}</div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-gray-600 border-t-gray-200 rounded-full animate-spin" />
        </div>
      ) : workflows.length === 0 ? (
        <div className="bg-surface-card/50 border border-theme border-dashed rounded-xl p-8 text-center text-theme-muted space-y-3">
          <p>No workflows yet.</p>
          <button
            onClick={() => setView({ type: "editor" })}
            className="text-sm text-accent-400 hover:text-accent-300 transition"
          >
            Create your first workflow
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {workflows.map((wf) => (
            <WorkflowCard
              key={wf.id}
              workflow={wf}
              onEdit={() => setView({ type: "editor", workflowId: wf.id })}
              onToggle={async () => {
                try {
                  await api.toggleWorkflow(wf.id);
                  fetchWorkflows();
                } catch (err: any) { setError(err.message); }
              }}
              onRun={async () => {
                try {
                  setError("");
                  const { runId } = await api.triggerWorkflow(wf.id);
                  setView({ type: "run", workflowId: wf.id, runId });
                } catch (err: any) { setError(err.message); }
              }}
              onDelete={async () => {
                try {
                  await api.deleteWorkflow(wf.id);
                  fetchWorkflows();
                } catch (err: any) { setError(err.message); }
              }}
              onViewRun={(runId) => setView({ type: "run", workflowId: wf.id, runId })}
              onViewHistory={() => setView({ type: "history", workflowId: wf.id })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function WorkflowCard({
  workflow: wf,
  onEdit,
  onToggle,
  onRun,
  onDelete,
  onViewRun,
  onViewHistory,
}: {
  workflow: WorkflowSummary;
  onEdit: () => void;
  onToggle: () => void;
  onRun: () => void;
  onDelete: () => void;
  onViewRun: (runId: string) => void;
  onViewHistory: () => void;
}) {
  const statusColor = {
    running: "bg-blue-500",
    completed: "bg-green-500",
    failed: "bg-red-500",
    cancelled: "bg-yellow-500",
  } as Record<string, string>;

  return (
    <div className="bg-surface-card rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium truncate">{wf.name}</h3>
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${wf.enabled ? "bg-green-500" : "bg-gray-500"}`} />
          </div>
          {wf.description && (
            <p className="text-xs text-theme-secondary mt-0.5 truncate">{wf.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button onClick={onRun} className="px-2 py-1 text-xs bg-accent-600 hover:bg-accent-700 text-white rounded transition" title="Run now">
            Run
          </button>
          <button onClick={onViewHistory} className="px-2 py-1 text-xs bg-surface-input hover:bg-surface-hover text-theme-secondary rounded transition">
            History
          </button>
          <button onClick={onEdit} className="px-2 py-1 text-xs bg-surface-input hover:bg-surface-hover text-theme-secondary rounded transition">
            Edit
          </button>
          <button onClick={onToggle} className="px-2 py-1 text-xs bg-surface-input hover:bg-surface-hover text-theme-secondary rounded transition">
            {wf.enabled ? "Disable" : "Enable"}
          </button>
          <button onClick={onDelete} className="px-2 py-1 text-xs text-theme-secondary hover:text-red-400 transition">
            Delete
          </button>
        </div>
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-4 text-xs text-theme-muted">
        <span>{wf.nodes.length} node{wf.nodes.length !== 1 ? "s" : ""}</span>
        {wf.schedule?.cron && <span>Cron: <code className="text-theme-secondary">{wf.schedule.cron}</code></span>}
        {wf.triggers?.map((t, i) => (
          <span key={i}>{t.type === "webhook" ? "Webhook" : "File watch"}</span>
        ))}
      </div>

      {/* Last run */}
      {wf.lastRun && (
        <button
          onClick={() => onViewRun(wf.lastRun!.runId)}
          className="flex items-center gap-2 text-xs text-theme-secondary hover:text-theme-primary transition"
        >
          <span className={`w-2 h-2 rounded-full ${statusColor[wf.lastRun.status] ?? "bg-gray-500"}`} />
          <span>Last run: {wf.lastRun.status}</span>
          <span className="text-theme-muted">{new Date(wf.lastRun.startedAt).toLocaleString()}</span>
        </button>
      )}
    </div>
  );
}

function WorkflowHistory({
  workflowId,
  onViewRun,
  onBack,
}: {
  workflowId: string;
  onViewRun: (runId: string) => void;
  onBack: () => void;
}) {
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");

  useEffect(() => {
    Promise.all([
      api.getWorkflowRuns(workflowId),
      api.getWorkflow(workflowId),
    ]).then(([r, wf]) => {
      setRuns(r);
      setName(wf.name);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [workflowId]);

  const statusColor: Record<string, string> = {
    running: "bg-blue-500",
    completed: "bg-green-500",
    failed: "bg-red-500",
    cancelled: "bg-yellow-500",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-sm text-theme-secondary hover:text-theme-primary transition">&larr; Back</button>
        <h2 className="text-lg font-semibold">{name || workflowId}</h2>
        <span className="text-xs text-theme-muted">Run History</span>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-gray-600 border-t-gray-200 rounded-full animate-spin" />
        </div>
      ) : runs.length === 0 ? (
        <div className="text-center py-12 text-theme-muted text-sm">No runs yet.</div>
      ) : (
        <div className="border border-theme rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-surface-card text-theme-secondary border-b border-theme">
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Trigger</th>
                <th className="text-left px-3 py-2 font-medium">Started</th>
                <th className="text-right px-3 py-2 font-medium">Duration</th>
                <th className="text-right px-3 py-2 font-medium">Nodes</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const duration = run.completedAt
                  ? Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
                  : null;
                const nodeResults = Object.values(run.nodeResults ?? {}) as any[];
                const completed = nodeResults.filter((n: any) => n.status === "completed").length;
                const failed = nodeResults.filter((n: any) => n.status === "failed").length;

                return (
                  <tr
                    key={run.runId}
                    onClick={() => onViewRun(run.runId)}
                    className="border-b border-theme/50 hover:bg-surface-hover cursor-pointer transition"
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${statusColor[run.status] ?? "bg-gray-500"}`} />
                        <span className={
                          run.status === "completed" ? "text-green-400" :
                          run.status === "failed" ? "text-red-400" :
                          run.status === "running" ? "text-blue-400" :
                          "text-yellow-400"
                        }>{run.status}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-theme-secondary">{run.trigger}</td>
                    <td className="px-3 py-2 text-theme-secondary">{new Date(run.startedAt).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right text-theme-muted">{duration !== null ? `${duration}s` : "..."}</td>
                    <td className="px-3 py-2 text-right text-theme-muted">
                      {completed > 0 && <span className="text-green-400">{completed}ok</span>}
                      {failed > 0 && <span className="text-red-400 ml-1">{failed}err</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
