import { useState, useEffect } from "react";
import { api } from "../api/client";
import { randomUUID } from "../utils/uuid";
import WorkflowDagView from "./WorkflowDagView";

interface TaskNode {
  id: string;
  label: string;
  type: "mcp_tool" | "shell" | "claude_prompt" | "python" | "brain_write";
  config: any;
}

interface TaskEdge {
  from: string;
  to: string;
  condition?: "success" | "failure" | "always";
  when?: string;
}

interface WorkflowData {
  id?: string;
  name: string;
  description: string;
  schedule?: { cron?: string };
  triggers?: { type: "webhook" | "file_change"; webhookId?: string; watchPath?: string; debounceMs?: number }[];
  nodes: TaskNode[];
  edges: TaskEdge[];
  enabled?: boolean;
}

interface Props {
  workflowId?: string;
  onSave: () => void;
  onCancel: () => void;
}

const MCP_TOOLS = [
  "brain_search", "brain_vsearch", "brain_get", "brain_write", "brain_update",
  "brain_links", "brain_list", "brain_recent", "brain_orphans", "brain_context",
  "service_request", "service_status",
  "agents_read", "agents_write",
];

export default function WorkflowEditor({ workflowId, onSave, onCancel }: Props) {
  const [data, setData] = useState<WorkflowData>({
    name: "",
    description: "",
    nodes: [],
    edges: [],
  });
  const [loading, setLoading] = useState(!!workflowId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editingNode, setEditingNode] = useState<string | null>(null);
  const [showAddEdge, setShowAddEdge] = useState(false);

  useEffect(() => {
    if (!workflowId) return;
    api.getWorkflow(workflowId).then((wf) => {
      setData(wf);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [workflowId]);

  async function handleSave() {
    if (!data.name.trim()) { setError("Name is required"); return; }
    setSaving(true);
    setError("");
    try {
      if (workflowId) {
        await api.updateWorkflow(workflowId, data);
      } else {
        await api.createWorkflow(data);
      }
      onSave();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function addNode(type: TaskNode["type"]) {
    const id = type.slice(0, 4) + "-" + randomUUID().slice(0, 4);
    const defaults: Record<string, any> = {
      mcp_tool: { tool: "brain_search", args: {} },
      shell: { command: "", timeout: 30000 },
      claude_prompt: { prompt: "", useProjectContext: true },
      python: { script: "", timeout: 60000 },
      brain_write: { action: "archive_result", title: "", useNodeOutput: "" },
    };
    const node: TaskNode = { id, label: id, type, config: defaults[type] };
    setData((d) => ({ ...d, nodes: [...d.nodes, node] }));
    setEditingNode(id);
  }

  function updateNode(id: string, updates: Partial<TaskNode>) {
    setData((d) => ({
      ...d,
      nodes: d.nodes.map((n) => (n.id === id ? { ...n, ...updates } : n)),
    }));
  }

  function removeNode(id: string) {
    setData((d) => ({
      ...d,
      nodes: d.nodes.filter((n) => n.id !== id),
      edges: d.edges.filter((e) => e.from !== id && e.to !== id),
    }));
    if (editingNode === id) setEditingNode(null);
  }

  function addEdge(from: string, to: string, condition: TaskEdge["condition"] = "success") {
    if (from === to) return;
    if (data.edges.some((e) => e.from === from && e.to === to)) return;
    setData((d) => ({ ...d, edges: [...d.edges, { from, to, condition }] }));
    setShowAddEdge(false);
  }

  function removeEdge(from: string, to: string) {
    setData((d) => ({ ...d, edges: d.edges.filter((e) => !(e.from === from && e.to === to)) }));
  }

  if (loading) {
    return <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-gray-600 border-t-gray-200 rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{workflowId ? "Edit Workflow" : "New Workflow"}</h2>
        <div className="flex gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm text-theme-secondary hover:text-theme-primary transition">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-3 py-1.5 bg-accent-600 hover:bg-accent-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {error && <div className="bg-red-900/50 border border-red-700 rounded-lg p-2 text-red-300 text-xs">{error}</div>}

      {/* Basic info */}
      <div className="bg-surface-card rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-theme-secondary mb-1">Name</label>
            <input value={data.name} onChange={(e) => setData((d) => ({ ...d, name: e.target.value }))}
              className="w-full px-3 py-2 bg-surface-input border border-theme-input rounded-lg text-sm text-theme-primary focus:outline-none focus:ring-1 focus:ring-accent-500" />
          </div>
          <div>
            <label className="block text-xs text-theme-secondary mb-1">Cron Schedule</label>
            <input value={data.schedule?.cron ?? ""} onChange={(e) => setData((d) => ({ ...d, schedule: { cron: e.target.value || undefined } }))}
              placeholder="0 9 * * 1-5"
              className="w-full px-3 py-2 bg-surface-input border border-theme-input rounded-lg text-sm text-theme-primary focus:outline-none focus:ring-1 focus:ring-accent-500 font-mono" />
          </div>
        </div>
        <div>
          <label className="block text-xs text-theme-secondary mb-1">Description</label>
          <input value={data.description} onChange={(e) => setData((d) => ({ ...d, description: e.target.value }))}
            className="w-full px-3 py-2 bg-surface-input border border-theme-input rounded-lg text-sm text-theme-primary focus:outline-none focus:ring-1 focus:ring-accent-500" />
        </div>
      </div>

      {/* DAG Preview */}
      {data.nodes.length > 0 && (
        <div className="bg-surface-card rounded-xl p-4">
          <p className="text-xs text-theme-secondary mb-2">DAG Preview</p>
          <WorkflowDagView nodes={data.nodes} edges={data.edges} onNodeClick={(id) => setEditingNode(editingNode === id ? null : id)} />
        </div>
      )}

      {/* Nodes */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Nodes ({data.nodes.length})</p>
          <div className="flex gap-1">
            <button onClick={() => addNode("shell")} className="px-2 py-1 text-xs bg-surface-input hover:bg-surface-hover text-theme-secondary rounded transition">+ Shell</button>
            <button onClick={() => addNode("python")} className="px-2 py-1 text-xs bg-surface-input hover:bg-surface-hover text-theme-secondary rounded transition">+ Python</button>
            <button onClick={() => addNode("mcp_tool")} className="px-2 py-1 text-xs bg-surface-input hover:bg-surface-hover text-theme-secondary rounded transition">+ MCP Tool</button>
            <button onClick={() => addNode("claude_prompt")} className="px-2 py-1 text-xs bg-surface-input hover:bg-surface-hover text-theme-secondary rounded transition">+ Prompt</button>
            <button onClick={() => addNode("brain_write")} className="px-2 py-1 text-xs bg-surface-input hover:bg-surface-hover text-theme-secondary rounded transition">+ Brain</button>
          </div>
        </div>

        {data.nodes.map((node) => (
          <div key={node.id} className="bg-surface-card rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`px-1.5 py-0.5 text-[10px] font-mono rounded ${
                  node.type === "shell" ? "bg-green-900/50 text-green-400" :
                  node.type === "python" ? "bg-yellow-900/50 text-yellow-400" :
                  node.type === "mcp_tool" ? "bg-blue-900/50 text-blue-400" :
                  node.type === "brain_write" ? "bg-orange-900/50 text-orange-400" :
                  "bg-purple-900/50 text-purple-400"
                }`}>{
                  node.type === "mcp_tool" ? "MCP" :
                  node.type === "shell" ? "SHELL" :
                  node.type === "python" ? "PYTHON" :
                  node.type === "brain_write" ? "BRAIN" :
                  "PROMPT"
                }</span>
                <span className="text-sm font-mono">{node.label}</span>
              </div>
              <div className="flex gap-1">
                <button onClick={() => setEditingNode(editingNode === node.id ? null : node.id)}
                  className="px-2 py-0.5 text-xs text-theme-secondary hover:text-theme-primary transition">
                  {editingNode === node.id ? "Close" : "Edit"}
                </button>
                <button onClick={() => removeNode(node.id)} className="px-2 py-0.5 text-xs text-theme-secondary hover:text-red-400 transition">Remove</button>
              </div>
            </div>

            {editingNode === node.id && (
              <NodeConfigEditor node={node} onChange={(updates) => updateNode(node.id, updates)} />
            )}
          </div>
        ))}
      </div>

      {/* Edges */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Edges ({data.edges.length})</p>
          <button onClick={() => setShowAddEdge(!showAddEdge)}
            className="px-2 py-1 text-xs bg-surface-input hover:bg-surface-hover text-theme-secondary rounded transition">
            + Add Edge
          </button>
        </div>

        {showAddEdge && data.nodes.length >= 2 && (
          <AddEdgeForm nodes={data.nodes} onAdd={addEdge} onCancel={() => setShowAddEdge(false)} />
        )}

        {data.edges.map((edge) => (
          <div key={`${edge.from}-${edge.to}`} className="flex items-center gap-2 text-xs bg-surface-card rounded-lg px-3 py-2">
            <span className="font-mono text-theme-primary">{edge.from}</span>
            <span className="text-theme-muted">→</span>
            <span className="font-mono text-theme-primary">{edge.to}</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] ${
              edge.condition === "failure" ? "bg-red-900/50 text-red-400" :
              edge.condition === "always" ? "bg-yellow-900/50 text-yellow-400" :
              "bg-green-900/50 text-green-400"
            }`}>{edge.condition ?? "success"}</span>
            {edge.when && <span className="text-theme-muted font-mono">when: {edge.when}</span>}
            <button onClick={() => removeEdge(edge.from, edge.to)} className="ml-auto text-theme-secondary hover:text-red-400 transition">x</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function NodeConfigEditor({ node, onChange }: { node: TaskNode; onChange: (updates: Partial<TaskNode>) => void }) {
  return (
    <div className="space-y-2 pt-2 border-t border-theme/50">
      <div>
        <label className="block text-xs text-theme-secondary mb-1">Label</label>
        <input value={node.label} onChange={(e) => onChange({ label: e.target.value })}
          className="w-full px-2 py-1.5 bg-surface-input border border-theme-input rounded text-xs text-theme-primary focus:outline-none focus:ring-1 focus:ring-accent-500 font-mono" />
      </div>

      {node.type === "shell" && (
        <>
          <div>
            <label className="block text-xs text-theme-secondary mb-1">Command</label>
            <textarea value={node.config.command} onChange={(e) => onChange({ config: { ...node.config, command: e.target.value } })}
              rows={2} className="w-full px-2 py-1.5 bg-surface-input border border-theme-input rounded text-xs text-theme-primary focus:outline-none focus:ring-1 focus:ring-accent-500 font-mono resize-y" />
          </div>
          <p className="text-[10px] text-theme-muted">Use {"{{nodeId.output}}"} to reference output from previous nodes</p>
        </>
      )}

      {node.type === "mcp_tool" && (
        <>
          <div>
            <label className="block text-xs text-theme-secondary mb-1">Tool</label>
            <select value={node.config.tool} onChange={(e) => onChange({ config: { ...node.config, tool: e.target.value } })}
              className="w-full px-2 py-1.5 bg-surface-input border border-theme-input rounded text-xs text-theme-primary focus:outline-none">
              {MCP_TOOLS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-theme-secondary mb-1">Args (JSON)</label>
            <textarea value={JSON.stringify(node.config.args, null, 2)}
              onChange={(e) => { try { onChange({ config: { ...node.config, args: JSON.parse(e.target.value) } }); } catch { /* let user finish typing */ } }}
              rows={3} className="w-full px-2 py-1.5 bg-surface-input border border-theme-input rounded text-xs text-theme-primary focus:outline-none focus:ring-1 focus:ring-accent-500 font-mono resize-y" />
          </div>
        </>
      )}

      {node.type === "python" && (
        <>
          <div>
            <label className="block text-xs text-theme-secondary mb-1">Python Script</label>
            <textarea value={node.config.script} onChange={(e) => onChange({ config: { ...node.config, script: e.target.value } })}
              rows={6} placeholder="import json&#10;print('hello from python')"
              className="w-full px-2 py-1.5 bg-surface-input border border-theme-input rounded text-xs text-theme-primary focus:outline-none focus:ring-1 focus:ring-accent-500 font-mono resize-y" />
          </div>
          <div>
            <label className="block text-xs text-theme-secondary mb-1">Requirements (optional, one per line)</label>
            <textarea value={node.config.requirements ?? ""} onChange={(e) => onChange({ config: { ...node.config, requirements: e.target.value } })}
              rows={2} placeholder="requests&#10;pandas"
              className="w-full px-2 py-1.5 bg-surface-input border border-theme-input rounded text-xs text-theme-primary focus:outline-none focus:ring-1 focus:ring-accent-500 font-mono resize-y" />
          </div>
          <p className="text-[10px] text-theme-muted">Use {"{{nodeId.output}}"} in the script. Output is captured from stdout.</p>
        </>
      )}

      {node.type === "brain_write" && (
        <>
          <div>
            <label className="block text-xs text-theme-secondary mb-1">Action</label>
            <select value={node.config.action ?? "archive_result"} onChange={(e) => onChange({ config: { ...node.config, action: e.target.value } })}
              className="w-full px-2 py-1.5 bg-surface-input border border-theme-input rounded text-xs text-theme-primary focus:outline-none">
              <option value="archive_result">Archive Result (year/month/workflow)</option>
              <option value="note">Write Note (knowledge/notes/)</option>
              <option value="project">Write Project Note (knowledge/projects/)</option>
              <option value="update_active">Append to ACTIVE.md</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-theme-secondary mb-1">Title</label>
            <input value={node.config.title ?? ""} onChange={(e) => onChange({ config: { ...node.config, title: e.target.value } })}
              placeholder={node.config.action === "update_active" ? "(not used)" : "Note title"}
              className="w-full px-2 py-1.5 bg-surface-input border border-theme-input rounded text-xs text-theme-primary focus:outline-none focus:ring-1 focus:ring-accent-500" />
          </div>
          <div>
            <label className="block text-xs text-theme-secondary mb-1">Source Node Output</label>
            <select value={node.config.useNodeOutput ?? ""} onChange={(e) => onChange({ config: { ...node.config, useNodeOutput: e.target.value } })}
              className="w-full px-2 py-1.5 bg-surface-input border border-theme-input rounded text-xs text-theme-primary focus:outline-none">
              <option value="">None (use static content below)</option>
              {data.nodes.filter((n) => n.id !== node.id).map((n) => (
                <option key={n.id} value={n.id}>{n.label} ({n.id})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-theme-secondary mb-1">Static Content (optional)</label>
            <textarea value={node.config.content ?? ""} onChange={(e) => onChange({ config: { ...node.config, content: e.target.value } })}
              rows={3} placeholder="Content to write (ignored if source node selected)"
              className="w-full px-2 py-1.5 bg-surface-input border border-theme-input rounded text-xs text-theme-primary focus:outline-none focus:ring-1 focus:ring-accent-500 font-mono resize-y" />
          </div>
          <div>
            <label className="block text-xs text-theme-secondary mb-1">Tags (comma-separated)</label>
            <input value={node.config.tags ?? ""} onChange={(e) => onChange({ config: { ...node.config, tags: e.target.value } })}
              placeholder="domain/email, automation"
              className="w-full px-2 py-1.5 bg-surface-input border border-theme-input rounded text-xs text-theme-primary focus:outline-none focus:ring-1 focus:ring-accent-500" />
          </div>
        </>
      )}

      {node.type === "claude_prompt" && (
        <>
          <div>
            <label className="block text-xs text-theme-secondary mb-1">Prompt</label>
            <textarea value={node.config.prompt} onChange={(e) => onChange({ config: { ...node.config, prompt: e.target.value } })}
              rows={4} className="w-full px-2 py-1.5 bg-surface-input border border-theme-input rounded text-xs text-theme-primary focus:outline-none focus:ring-1 focus:ring-accent-500 resize-y" />
          </div>
          <label className="flex items-center gap-2 text-xs text-theme-secondary cursor-pointer">
            <input type="checkbox" checked={!!node.config.useProjectContext}
              onChange={(e) => onChange({ config: { ...node.config, useProjectContext: e.target.checked } })}
              className="rounded" />
            Use project context (CLAUDE.md, MCP tools, brain)
          </label>
          <label className="flex items-center gap-2 text-xs text-theme-secondary cursor-pointer">
            <input type="checkbox" checked={!!node.config.bypassPermissions}
              onChange={(e) => onChange({ config: { ...node.config, bypassPermissions: e.target.checked } })}
              className="rounded" />
            Bypass permissions (no confirmation prompts)
          </label>
        </>
      )}
    </div>
  );
}

function AddEdgeForm({ nodes, onAdd, onCancel }: { nodes: TaskNode[]; onAdd: (from: string, to: string, condition?: "success" | "failure" | "always") => void; onCancel: () => void }) {
  const [from, setFrom] = useState(nodes[0]?.id ?? "");
  const [to, setTo] = useState(nodes[1]?.id ?? "");
  const [condition, setCondition] = useState<"success" | "failure" | "always">("success");

  return (
    <div className="flex items-end gap-2 bg-surface-card rounded-lg p-3">
      <div className="flex-1">
        <label className="block text-xs text-theme-secondary mb-1">From</label>
        <select value={from} onChange={(e) => setFrom(e.target.value)}
          className="w-full px-2 py-1.5 bg-surface-input border border-theme-input rounded text-xs text-theme-primary focus:outline-none">
          {nodes.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
        </select>
      </div>
      <div className="flex-1">
        <label className="block text-xs text-theme-secondary mb-1">To</label>
        <select value={to} onChange={(e) => setTo(e.target.value)}
          className="w-full px-2 py-1.5 bg-surface-input border border-theme-input rounded text-xs text-theme-primary focus:outline-none">
          {nodes.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs text-theme-secondary mb-1">Condition</label>
        <select value={condition} onChange={(e) => setCondition(e.target.value as any)}
          className="px-2 py-1.5 bg-surface-input border border-theme-input rounded text-xs text-theme-primary focus:outline-none">
          <option value="success">On Success</option>
          <option value="failure">On Failure</option>
          <option value="always">Always</option>
        </select>
      </div>
      <button onClick={() => onAdd(from, to, condition)} className="px-2 py-1.5 bg-accent-600 hover:bg-accent-700 text-white text-xs rounded transition">Add</button>
      <button onClick={onCancel} className="px-2 py-1.5 text-xs text-theme-secondary hover:text-theme-primary transition">Cancel</button>
    </div>
  );
}
