import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../api/client";

interface LogEntry {
  timestamp: string;
  tool: string;
  args: Record<string, unknown>;
  duration_ms?: number;
}

export default function LogsPanel({ scope }: { scope?: string } = {}) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [toolFilter, setToolFilter] = useState("");
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const limit = 50;
  const sentinelRef = useRef<HTMLDivElement>(null);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  // Initial load + refresh (always fetches newest)
  const fetchLatest = useCallback(async () => {
    try {
      const data = await api.getMcpLogs({ limit, offset: 0, tool: toolFilter || undefined, scope });
      setEntries(data.entries);
      setTotal(data.total);
      setHasMore(data.entries.length < data.total);
    } catch {
      // Ignore fetch errors during auto-refresh
    } finally {
      setLoading(false);
    }
  }, [toolFilter]);

  // Load older entries (append)
  const fetchMore = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const offset = entriesRef.current.length;
      const data = await api.getMcpLogs({ limit, offset, tool: toolFilter || undefined, scope });
      setEntries((prev) => [...prev, ...data.entries]);
      setTotal(data.total);
      setHasMore(offset + data.entries.length < data.total);
    } catch {
      // Ignore
    } finally {
      setLoadingMore(false);
    }
  }, [toolFilter, loadingMore]);

  // Reset on filter change
  useEffect(() => {
    setLoading(true);
    setEntries([]);
    setExpandedIdx(null);
    fetchLatest();
  }, [fetchLatest]);

  // Auto-refresh (newest only, don't reset scroll)
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(fetchLatest, 5000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchLatest]);

  // Intersection observer for infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (observed) => {
        if (observed[0].isIntersecting && hasMore && !loadingMore) {
          fetchMore();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, fetchMore]);

  // Collect unique tool names for filter
  const toolNames = [...new Set(entries.map((e) => e.tool))].sort();

  function formatTime(ts: string) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function formatDate(ts: string) {
    const d = new Date(ts);
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  function formatArgs(args: Record<string, unknown>): string {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(args)) {
      if (typeof v === "string") {
        parts.push(`${k}="${v.length > 40 ? v.slice(0, 40) + "..." : v}"`);
      } else if (v !== undefined && v !== null) {
        parts.push(`${k}=${JSON.stringify(v)}`);
      }
    }
    return parts.join(", ") || "(none)";
  }

  return (
    <div className="space-y-4">
      {/* Header controls */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">MCP Tool Logs</h2>
          <span className="text-xs text-theme-muted">{total} total</span>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={toolFilter}
            onChange={(e) => setToolFilter(e.target.value)}
            className="px-2 py-1 bg-surface-input border border-theme-input rounded text-xs text-theme-primary focus:outline-none"
          >
            <option value="">All tools</option>
            {toolNames.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-theme-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            Auto-refresh
          </label>
        </div>
      </div>

      {/* Log table */}
      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-5 h-5 border-2 border-gray-600 border-t-gray-200 rounded-full animate-spin" />
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 text-theme-muted text-sm">
          No MCP tool calls logged yet. Use MCP tools to see activity here.
        </div>
      ) : (
        <div className="border border-theme rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-surface-card text-theme-secondary border-b border-theme">
                <th className="text-left px-3 py-2 font-medium">Time</th>
                <th className="text-left px-3 py-2 font-medium">Tool</th>
                <th className="text-left px-3 py-2 font-medium">Args</th>
                <th className="text-right px-3 py-2 font-medium">Duration</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, i) => (
                <tr
                  key={`${entry.timestamp}-${i}`}
                  className="border-b border-theme/50 hover:bg-surface-hover cursor-pointer transition"
                  onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                >
                  <td className="px-3 py-2 text-theme-muted whitespace-nowrap">
                    <span className="text-theme-secondary">{formatTime(entry.timestamp)}</span>
                    <span className="ml-1 text-theme-muted">{formatDate(entry.timestamp)}</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-accent-500 whitespace-nowrap">{entry.tool}</td>
                  <td className="px-3 py-2 text-theme-secondary truncate max-w-[300px]">
                    {expandedIdx === i ? (
                      <pre className="whitespace-pre-wrap text-theme-primary font-mono">
                        {JSON.stringify(entry.args, null, 2)}
                      </pre>
                    ) : (
                      formatArgs(entry.args)
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-theme-muted whitespace-nowrap">
                    {entry.duration_ms !== undefined ? `${entry.duration_ms}ms` : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} className="h-1" />
      {loadingMore && (
        <div className="flex justify-center py-4">
          <div className="w-4 h-4 border-2 border-gray-600 border-t-gray-200 rounded-full animate-spin" />
        </div>
      )}
      {!hasMore && entries.length > 0 && entries.length >= limit && (
        <p className="text-center text-xs text-theme-muted py-2">All logs loaded</p>
      )}
    </div>
  );
}
