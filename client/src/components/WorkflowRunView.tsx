import { useState, useEffect, useCallback } from "react";
import { api } from "../api/client";
import WorkflowDagView from "./WorkflowDagView";

interface NodeResult {
  nodeId: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt?: string;
  completedAt?: string;
  output?: unknown;
  error?: string;
  durationMs?: number;
}

interface WorkflowRun {
  runId: string;
  workflowId: string;
  status: "running" | "completed" | "failed" | "cancelled";
  trigger: string;
  startedAt: string;
  completedAt?: string;
  nodeResults: Record<string, NodeResult>;
}

interface Props {
  workflowId: string;
  runId: string;
  onBack: () => void;
}

export default function WorkflowRunView({ workflowId, runId, onBack }: Props) {
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [workflow, setWorkflow] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const fetchRun = useCallback(async () => {
    try {
      const [r, wf] = await Promise.all([
        api.getWorkflowRun(workflowId, runId),
        workflow ? Promise.resolve(workflow) : api.getWorkflow(workflowId),
      ]);
      setRun(r);
      if (!workflow) setWorkflow(wf);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [workflowId, runId, workflow]);

  useEffect(() => { fetchRun(); }, [fetchRun]);

  // Auto-refresh while running (1s for responsive live view)
  useEffect(() => {
    if (!run || run.status !== "running") return;
    const id = setInterval(fetchRun, 1000);
    return () => clearInterval(id);
  }, [run?.status, fetchRun]);

  if (loading) {
    return <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-gray-600 border-t-gray-200 rounded-full animate-spin" /></div>;
  }

  if (!run || !workflow) {
    return <div className="text-center py-12 text-theme-muted">Run not found</div>;
  }

  const statusColor = {
    running: "text-blue-400",
    completed: "text-green-400",
    failed: "text-red-400",
    cancelled: "text-yellow-400",
  }[run.status] ?? "text-gray-400";

  const selectedResult = selectedNode ? run.nodeResults[selectedNode] : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-sm text-theme-secondary hover:text-theme-primary transition">&larr; Back</button>
          <h2 className="text-lg font-semibold">{workflow.name}</h2>
          <span className={`text-sm font-medium ${statusColor}`}>{run.status}</span>
        </div>
        {run.status === "running" && (
          <button
            onClick={async () => { await api.cancelWorkflowRun(workflowId, runId); fetchRun(); }}
            className="px-3 py-1 text-xs bg-red-900/50 hover:bg-red-900 text-red-300 rounded transition"
          >
            Cancel
          </button>
        )}
      </div>

      {/* Run meta */}
      <div className="flex gap-4 text-xs text-theme-muted">
        <span>Trigger: {run.trigger}</span>
        <span>Started: {new Date(run.startedAt).toLocaleString()}</span>
        {run.completedAt && <span>Duration: {Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)}s</span>}
      </div>

      {/* DAG */}
      <div className="bg-surface-card rounded-xl p-4">
        <WorkflowDagView
          nodes={workflow.nodes}
          edges={workflow.edges}
          nodeStatuses={run.nodeResults}
          onNodeClick={(id) => setSelectedNode(selectedNode === id ? null : id)}
          selectedNode={selectedNode}
        />
      </div>

      {/* Selected node detail */}
      {selectedResult && (
        <div className="bg-surface-card rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium font-mono">{selectedResult.nodeId}</h3>
              <span className={`text-xs ${
                selectedResult.status === "completed" ? "text-green-400" :
                selectedResult.status === "failed" ? "text-red-400" :
                selectedResult.status === "running" ? "text-blue-400" :
                selectedResult.status === "skipped" ? "text-yellow-400" :
                "text-gray-400"
              }`}>{selectedResult.status}</span>
            </div>
            {selectedResult.durationMs !== undefined && (
              <span className="text-xs text-theme-muted">{selectedResult.durationMs}ms</span>
            )}
          </div>

          {selectedResult.error && (
            <div className="bg-red-900/30 border border-red-800 rounded p-2 text-xs text-red-300 font-mono whitespace-pre-wrap">
              {selectedResult.error}
            </div>
          )}

          {selectedResult.output !== undefined && (
            <ClaudeOutputView output={selectedResult.output} />
          )}
        </div>
      )}

      {/* All node results table */}
      <div className="border border-theme rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-surface-card text-theme-secondary border-b border-theme">
              <th className="text-left px-3 py-2 font-medium">Node</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="text-right px-3 py-2 font-medium">Duration</th>
            </tr>
          </thead>
          <tbody>
            {Object.values(run.nodeResults).map((nr) => (
              <tr
                key={nr.nodeId}
                onClick={() => setSelectedNode(selectedNode === nr.nodeId ? null : nr.nodeId)}
                className="border-b border-theme/50 hover:bg-surface-hover cursor-pointer transition"
              >
                <td className="px-3 py-2 font-mono text-theme-primary">{nr.nodeId}</td>
                <td className="px-3 py-2">
                  <span className={`${
                    nr.status === "completed" ? "text-green-400" :
                    nr.status === "failed" ? "text-red-400" :
                    nr.status === "running" ? "text-blue-400" :
                    nr.status === "skipped" ? "text-yellow-400" :
                    "text-gray-400"
                  }`}>{nr.status}</span>
                </td>
                <td className="px-3 py-2 text-right text-theme-muted">
                  {nr.durationMs !== undefined ? `${nr.durationMs}ms` : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Renders Claude JSON output as a chat-like conversation, or falls back to raw display */
function ClaudeOutputView({ output }: { output: unknown }) {
  // Check if this is Claude JSON output (array of messages or object with result/messages)
  const messages = extractMessages(output);

  if (!messages) {
    // Plain text or non-Claude JSON — show raw
    return (
      <div>
        <p className="text-xs text-theme-secondary mb-1">Output</p>
        <pre className="bg-surface-input rounded p-2 text-xs text-theme-primary font-mono whitespace-pre-wrap max-h-80 overflow-y-auto">
          {typeof output === "string" ? output : JSON.stringify(output, null, 2)}
        </pre>
      </div>
    );
  }

  // Render as chat messages
  return (
    <div>
      <p className="text-xs text-theme-secondary mb-1">Claude Conversation</p>
      <div className="space-y-2 max-h-[500px] overflow-y-auto">
        {messages.map((msg, i) => (
          <div key={i} className={`rounded-lg p-2 text-xs ${
            msg.role === "assistant"
              ? "bg-blue-900/20 border border-blue-800/50"
              : msg.role === "user"
              ? "bg-surface-input border border-theme-input"
              : "bg-purple-900/20 border border-purple-800/50"
          }`}>
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[10px] font-medium uppercase ${
                msg.role === "assistant" ? "text-blue-400" :
                msg.role === "user" ? "text-theme-secondary" :
                "text-purple-400"
              }`}>{msg.role}</span>
              {msg.type && msg.type !== "text" && (
                <span className="text-[10px] text-theme-muted px-1 py-0.5 bg-surface-hover rounded">{msg.type}</span>
              )}
            </div>
            <div className="text-theme-primary whitespace-pre-wrap font-mono">
              {msg.content}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface ChatMessage {
  role: string;
  content: string;
  type?: string;
}

function extractMessages(output: unknown): ChatMessage[] | null {
  if (!output || typeof output !== "object") return null;

  // Claude --output-format json returns an array of message objects
  if (Array.isArray(output)) {
    const msgs: ChatMessage[] = [];
    for (const item of output) {
      if (item.type === "result") {
        // Final result message
        const text = typeof item.result === "string" ? item.result :
          Array.isArray(item.result) ? item.result.map((b: any) => b.text ?? JSON.stringify(b)).join("\n") :
          JSON.stringify(item.result, null, 2);
        msgs.push({ role: "assistant", content: text, type: "result" });
      } else if (item.type === "assistant") {
        const text = typeof item.message === "string" ? item.message :
          Array.isArray(item.message?.content) ? item.message.content.map((b: any) =>
            b.type === "text" ? b.text :
            b.type === "tool_use" ? `[Tool: ${b.name}]\n${JSON.stringify(b.input, null, 2)}` :
            JSON.stringify(b)
          ).join("\n\n") :
          JSON.stringify(item.message, null, 2);
        msgs.push({ role: "assistant", content: text });
      } else if (item.type === "tool_result" || item.type === "tool") {
        const text = typeof item.content === "string" ? item.content :
          Array.isArray(item.content) ? item.content.map((b: any) => b.text ?? JSON.stringify(b)).join("\n") :
          JSON.stringify(item, null, 2);
        msgs.push({ role: "tool", content: text, type: item.name ?? "tool_result" });
      } else if (item.role) {
        const text = typeof item.content === "string" ? item.content :
          Array.isArray(item.content) ? item.content.map((b: any) => b.text ?? JSON.stringify(b)).join("\n") :
          JSON.stringify(item.content ?? item, null, 2);
        msgs.push({ role: item.role, content: text });
      }
    }
    return msgs.length > 0 ? msgs : null;
  }

  // Single result object
  const obj = output as any;
  if (obj.result || obj.content || obj.message) {
    const text = typeof (obj.result ?? obj.content ?? obj.message) === "string"
      ? (obj.result ?? obj.content ?? obj.message)
      : JSON.stringify(obj.result ?? obj.content ?? obj.message, null, 2);
    return [{ role: "assistant", content: text, type: "result" }];
  }

  return null;
}
