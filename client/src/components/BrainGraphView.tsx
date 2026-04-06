import { useRef, useCallback, useEffect, useMemo } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import type { BrainGraphData } from "../api/client";

const TAG_COLORS: Record<string, string> = {
  decision: "#3b82f6",
  pattern: "#22c55e",
  correction: "#ef4444",
  entity: "#a855f7",
  project: "#f97316",
  context: "#eab308",
  retrospective: "#6b7280",
  note: "#64748b",
};

function getNodeColor(tags: string[]): string {
  for (const t of tags) {
    if (TAG_COLORS[t]) return TAG_COLORS[t];
  }
  // Darker gray for light mode, lighter for dark
  return document.documentElement.classList.contains("dark") ? "#6b7280" : "#475569";
}

interface Props {
  data: BrainGraphData;
  selectedNode: string | null;
  onNodeClick: (nodeId: string) => void;
  filterTags: string[];
  searchHighlight: string;
  width: number;
  height: number;
}

export default function BrainGraphView({
  data,
  selectedNode,
  onNodeClick,
  filterTags,
  searchHighlight,
  width,
  height,
}: Props) {
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined);

  // Transform data for the graph
  const graphData = useMemo(() => {
    const filteredNodeIds = new Set<string>();
    const nodes = data.nodes.map((n) => {
      const passesFilter =
        filterTags.length === 0 || n.tags.some((t) => filterTags.includes(t));
      const matchesSearch =
        !searchHighlight ||
        n.title.toLowerCase().includes(searchHighlight.toLowerCase()) ||
        n.id.toLowerCase().includes(searchHighlight.toLowerCase());

      if (passesFilter) filteredNodeIds.add(n.id);

      return {
        ...n,
        _dimmed: !passesFilter,
        _highlighted: searchHighlight ? matchesSearch : false,
      };
    });

    const links = data.links.filter(
      (l) => filteredNodeIds.has(l.source as string) && filteredNodeIds.has(l.target as string)
    );

    return { nodes, links };
  }, [data, filterTags, searchHighlight]);

  // Zoom to fit on data change
  useEffect(() => {
    const timer = setTimeout(() => {
      fgRef.current?.zoomToFit(400, 40);
    }, 500);
    return () => clearTimeout(timer);
  }, [data]);

  // Center on selected node
  useEffect(() => {
    if (selectedNode && fgRef.current) {
      const node = graphData.nodes.find((n) => n.id === selectedNode);
      if (node && (node as any).x != null) {
        fgRef.current.centerAt((node as any).x, (node as any).y, 300);
        fgRef.current.zoom(2, 300);
      }
    }
  }, [selectedNode]);

  const handleNodeClick = useCallback(
    (node: any) => {
      onNodeClick(node.id);
    },
    [onNodeClick]
  );

  const nodeCanvasObject = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const isSelected = node.id === selectedNode;
      const isDimmed = node._dimmed;
      const isHighlighted = node._highlighted;

      const baseRadius = Math.max(3, Math.sqrt(node.connections + 1) * 2.5);
      const radius = isSelected ? baseRadius * 1.4 : baseRadius;
      const color = getNodeColor(node.tags);
      const alpha = isDimmed ? 0.1 : 1;

      // Glow for selected
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 3, 0, 2 * Math.PI);
        ctx.fillStyle = `rgba(255, 255, 255, 0.3)`;
        ctx.fill();
      }

      // Search highlight ring
      if (isHighlighted && !isSelected) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 2, 0, 2 * Math.PI);
        ctx.strokeStyle = "rgba(234, 179, 8, 0.8)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Node circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Label (only when zoomed in enough or selected)
      if (globalScale > 1.5 || isSelected || isHighlighted) {
        const fontSize = Math.max(10, 12 / globalScale);
        ctx.font = `${fontSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.globalAlpha = isDimmed ? 0.15 : 0.9;
        ctx.fillStyle = document.documentElement.classList.contains("dark") ? "#e2e8f0" : "#1e293b";
        ctx.fillText(node.title, node.x, node.y + radius + 2);
        ctx.globalAlpha = 1;
      }
    },
    [selectedNode]
  );

  return (
    <ForceGraph2D
      ref={fgRef}
      graphData={graphData}
      width={width}
      height={height}
      backgroundColor="rgba(0,0,0,0)"
      nodeCanvasObject={nodeCanvasObject}
      nodeCanvasObjectMode={() => "replace" as any}
      linkCanvasObject={(link: any, ctx: CanvasRenderingContext2D) => {
        const src = link.source;
        const tgt = link.target;
        if (!src?.x || !tgt?.x) return;
        const isConnected = selectedNode && (src.id === selectedNode || tgt.id === selectedNode);
        const isDark = document.documentElement.classList.contains("dark");
        const lineColor = isDark ? "148, 163, 184" : "71, 85, 105";
        ctx.beginPath();
        ctx.moveTo(src.x, src.y);
        ctx.lineTo(tgt.x, tgt.y);
        ctx.strokeStyle = !selectedNode
          ? `rgba(${lineColor}, ${isDark ? 0.35 : 0.4})`
          : isConnected
            ? `rgba(${lineColor}, 0.8)`
            : `rgba(${lineColor}, ${isDark ? 0.1 : 0.15})`;
        ctx.lineWidth = !selectedNode ? 1 : isConnected ? 2 : 0.5;
        ctx.stroke();
      }}
      linkCanvasObjectMode={() => "replace" as any}
      nodePointerAreaPaint={(node: any, color, ctx) => {
        const radius = Math.max(3, Math.sqrt(node.connections + 1) * 2.5) + 4;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
      }}
      onNodeClick={handleNodeClick}
      linkColor={(link: any) => {
        if (!selectedNode) return "rgba(148, 163, 184, 0.35)";
        const src = typeof link.source === "object" ? link.source.id : link.source;
        const tgt = typeof link.target === "object" ? link.target.id : link.target;
        if (src === selectedNode || tgt === selectedNode) return "rgba(148, 163, 184, 0.8)";
        return "rgba(148, 163, 184, 0.12)";
      }}
      linkWidth={(link: any) => {
        if (!selectedNode) return 1;
        const src = typeof link.source === "object" ? link.source.id : link.source;
        const tgt = typeof link.target === "object" ? link.target.id : link.target;
        return (src === selectedNode || tgt === selectedNode) ? 2 : 0.5;
      }}
      warmupTicks={80}
      cooldownTime={3000}
      d3AlphaDecay={0.03}
      d3VelocityDecay={0.3}
      enableNodeDrag={true}
      enableZoomInteraction={true}
      enablePanInteraction={true}
    />
  );
}
