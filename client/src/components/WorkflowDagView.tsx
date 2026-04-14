interface TaskNode {
  id: string;
  label: string;
  type: "mcp_tool" | "shell" | "claude_prompt" | "python" | "brain_write";
}

interface TaskEdge {
  from: string;
  to: string;
  condition?: "success" | "failure" | "always";
}

interface NodeStatus {
  status: "pending" | "running" | "completed" | "failed" | "skipped";
}

interface Props {
  nodes: TaskNode[];
  edges: TaskEdge[];
  nodeStatuses?: Record<string, NodeStatus>;
  onNodeClick?: (id: string) => void;
  selectedNode?: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "border-gray-500 bg-gray-500/10",
  running: "border-blue-500 bg-blue-500/10 animate-pulse",
  completed: "border-green-500 bg-green-500/10",
  failed: "border-red-500 bg-red-500/10",
  skipped: "border-yellow-500 bg-yellow-500/10",
};

const STATUS_DOTS: Record<string, string> = {
  pending: "bg-gray-500",
  running: "bg-blue-500",
  completed: "bg-green-500",
  failed: "bg-red-500",
  skipped: "bg-yellow-500",
};

const TYPE_BADGES: Record<string, { label: string; className: string }> = {
  shell: { label: "SH", className: "bg-green-900/50 text-green-400" },
  python: { label: "PY", className: "bg-yellow-900/50 text-yellow-400" },
  mcp_tool: { label: "MCP", className: "bg-blue-900/50 text-blue-400" },
  claude_prompt: { label: "AI", className: "bg-purple-900/50 text-purple-400" },
  brain_write: { label: "BRAIN", className: "bg-orange-900/50 text-orange-400" },
};

export default function WorkflowDagView({ nodes, edges, nodeStatuses, onNodeClick, selectedNode }: Props) {
  if (nodes.length === 0) return null;

  // Assign columns by topological depth
  const columns = computeColumns(nodes, edges);
  const maxCol = Math.max(...Object.values(columns), 0);

  // Group nodes by column
  const colGroups: string[][] = [];
  for (let c = 0; c <= maxCol; c++) {
    colGroups.push(
      nodes.filter((n) => columns[n.id] === c).map((n) => n.id)
    );
  }

  // Layout constants
  const nodeW = 140;
  const nodeH = 48;
  const colGap = 60;
  const rowGap = 16;
  const padX = 20;
  const padY = 20;

  // Compute node positions
  const positions: Record<string, { x: number; y: number }> = {};
  for (let c = 0; c <= maxCol; c++) {
    const col = colGroups[c];
    for (let r = 0; r < col.length; r++) {
      positions[col[r]] = {
        x: padX + c * (nodeW + colGap),
        y: padY + r * (nodeH + rowGap),
      };
    }
  }

  const maxRow = Math.max(...colGroups.map((c) => c.length), 1);
  const svgW = padX * 2 + (maxCol + 1) * nodeW + maxCol * colGap;
  const svgH = padY * 2 + maxRow * nodeH + (maxRow - 1) * rowGap;

  const EDGE_COLORS: Record<string, string> = {
    success: "#22c55e",
    failure: "#ef4444",
    always: "#eab308",
  };

  return (
    <div className="overflow-x-auto">
      <svg width={svgW} height={svgH} className="min-w-fit">
        {/* Edges */}
        {edges.map((edge) => {
          const from = positions[edge.from];
          const to = positions[edge.to];
          if (!from || !to) return null;
          const x1 = from.x + nodeW;
          const y1 = from.y + nodeH / 2;
          const x2 = to.x;
          const y2 = to.y + nodeH / 2;
          const mx = (x1 + x2) / 2;
          const color = EDGE_COLORS[edge.condition ?? "success"] ?? "#6b7280";
          return (
            <g key={`${edge.from}-${edge.to}`}>
              <path
                d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                fill="none"
                stroke={color}
                strokeWidth={1.5}
                strokeOpacity={0.6}
                markerEnd={`url(#arrow-${edge.condition ?? "success"})`}
              />
            </g>
          );
        })}

        {/* Arrow markers */}
        <defs>
          {Object.entries(EDGE_COLORS).map(([key, color]) => (
            <marker key={key} id={`arrow-${key}`} viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth="6" markerHeight="6" orient="auto-start-reverse" fill={color}>
              <path d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
          ))}
        </defs>

        {/* Nodes */}
        {nodes.map((node) => {
          const pos = positions[node.id];
          if (!pos) return null;
          const status = nodeStatuses?.[node.id]?.status ?? "pending";
          const isSelected = selectedNode === node.id;
          const badge = TYPE_BADGES[node.type];

          return (
            <g key={node.id} onClick={() => onNodeClick?.(node.id)} className="cursor-pointer">
              <rect
                x={pos.x} y={pos.y} width={nodeW} height={nodeH} rx={8}
                className={`${isSelected ? "stroke-accent-500 stroke-2" : ""}`}
                fill={status === "running" ? "rgba(59,130,246,0.1)" :
                      status === "completed" ? "rgba(34,197,94,0.1)" :
                      status === "failed" ? "rgba(239,68,68,0.1)" :
                      status === "skipped" ? "rgba(234,179,8,0.1)" :
                      "rgba(107,114,128,0.1)"}
                stroke={status === "running" ? "#3b82f6" :
                        status === "completed" ? "#22c55e" :
                        status === "failed" ? "#ef4444" :
                        status === "skipped" ? "#eab308" :
                        isSelected ? "" : "#374151"}
                strokeWidth={isSelected ? 2 : 1}
              />
              {/* Status dot */}
              <circle cx={pos.x + 12} cy={pos.y + nodeH / 2} r={4}
                fill={
                  status === "running" ? "#3b82f6" :
                  status === "completed" ? "#22c55e" :
                  status === "failed" ? "#ef4444" :
                  status === "skipped" ? "#eab308" : "#6b7280"
                }>
                {status === "running" && (
                  <animate attributeName="opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite" />
                )}
              </circle>
              {/* Pulse ring for running nodes */}
              {status === "running" && (
                <circle cx={pos.x + 12} cy={pos.y + nodeH / 2} r={4} fill="none" stroke="#3b82f6" strokeWidth={1.5}>
                  <animate attributeName="r" values="4;10" dur="1.2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.8;0" dur="1.2s" repeatCount="indefinite" />
                </circle>
              )}
              {/* Error icon for failed nodes */}
              {status === "failed" && (
                <text x={pos.x + nodeW - 16} y={pos.y + 16} fill="#ef4444" fontSize={12} textAnchor="middle">!</text>
              )}
              {/* Label */}
              <text x={pos.x + 22} y={pos.y + nodeH / 2 - 4} fill={isSelected ? "#fff" : "#e5e7eb"} fontSize={11} fontFamily="monospace" fontWeight={isSelected ? "bold" : "normal"}>
                {node.label.length > 14 ? node.label.slice(0, 12) + ".." : node.label}
              </text>
              {/* Type badge */}
              <text x={pos.x + 22} y={pos.y + nodeH / 2 + 12} fill="#9ca3af" fontSize={9} fontFamily="monospace">
                {badge.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function computeColumns(nodes: { id: string }[], edges: { from: string; to: string }[]): Record<string, number> {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
    adj.get(e.from)?.push(e.to);
  }

  const columns: Record<string, number> = {};
  let queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  let col = 0;

  while (queue.length > 0) {
    const next: string[] = [];
    for (const id of queue) {
      columns[id] = col;
      for (const to of adj.get(id) ?? []) {
        const newDeg = (inDegree.get(to) ?? 1) - 1;
        inDegree.set(to, newDeg);
        if (newDeg === 0) next.push(to);
      }
    }
    queue = next;
    col++;
  }

  // Nodes not in graph (disconnected) go to column 0
  for (const n of nodes) {
    if (!(n.id in columns)) columns[n.id] = 0;
  }

  return columns;
}
