import { useState, useCallback, useRef, useEffect } from "react";
import { api, type BrainSearchResult } from "../api/client";

const TYPE_TAGS = ["decision", "pattern", "correction", "entity", "project", "context"];

const TAG_COLORS: Record<string, string> = {
  decision: "bg-blue-900/60 text-blue-300 border-blue-700/50",
  pattern: "bg-green-900/60 text-green-300 border-green-700/50",
  correction: "bg-red-900/60 text-red-300 border-red-700/50",
  entity: "bg-purple-900/60 text-purple-300 border-purple-700/50",
  project: "bg-orange-900/60 text-orange-300 border-orange-700/50",
  context: "bg-yellow-900/60 text-yellow-300 border-yellow-700/50",
};

interface Props {
  scope?: string;
  onSelect: (path: string) => void;
  filterTags: string[];
  onFilterChange: (tags: string[]) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}

export default function BrainSearch({
  scope,
  onSelect,
  filterTags,
  onFilterChange,
  searchQuery,
  onSearchChange,
}: Props) {
  const [results, setResults] = useState<BrainSearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  const doSearch = useCallback(
    (q: string) => {
      if (!q.trim()) {
        setResults([]);
        setShowResults(false);
        return;
      }
      setSearching(true);
      api.searchBrain(q, scope)
        .then((r) => {
          setResults(r);
          setShowResults(true);
        })
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    },
    [scope]
  );

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const q = e.target.value;
      onSearchChange(q);
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => doSearch(q), 300);
    },
    [doSearch, onSearchChange]
  );

  const toggleTag = useCallback(
    (tag: string) => {
      if (filterTags.includes(tag)) {
        onFilterChange(filterTags.filter((t) => t !== tag));
      } else {
        onFilterChange([...filterTags, tag]);
      }
    },
    [filterTags, onFilterChange]
  );

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Search input */}
      <div className="relative flex-1 min-w-[200px]" ref={containerRef}>
        <input
          type="text"
          value={searchQuery}
          onChange={handleInput}
          onFocus={() => results.length > 0 && setShowResults(true)}
          placeholder="Search brain..."
          className="w-full px-3 py-1.5 bg-surface-input border border-theme rounded-lg text-sm text-theme-primary placeholder-theme-secondary focus:outline-none focus:border-accent-500 transition"
        />
        {searching && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Results dropdown */}
        {showResults && results.length > 0 && (
          <div className="absolute z-50 top-full mt-1 left-0 right-0 max-h-72 overflow-y-auto bg-surface-card border border-theme rounded-lg shadow-xl">
            {results.map((r) => (
              <button
                key={r.path}
                onClick={() => {
                  onSelect(r.path);
                  setShowResults(false);
                }}
                className="w-full text-left px-3 py-2 hover:bg-surface-hover transition border-b border-theme/50 last:border-0"
              >
                <div className="text-sm font-medium text-theme-primary">{r.title}</div>
                <div className="text-xs text-theme-secondary truncate">{r.path}</div>
                {r.snippet && (
                  <div className="text-xs text-theme-secondary mt-0.5 truncate opacity-70">
                    {r.snippet}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tag filters */}
      <div className="flex gap-1.5 flex-wrap">
        {TYPE_TAGS.map((tag) => {
          const active = filterTags.includes(tag);
          const colors = TAG_COLORS[tag] || "bg-gray-800/60 text-gray-300 border-gray-700/50";
          return (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              className={`px-2 py-0.5 rounded-full text-xs font-medium border transition ${
                active ? colors : "bg-transparent text-theme-secondary border-theme/50 opacity-50 hover:opacity-80"
              }`}
            >
              {tag}
            </button>
          );
        })}
      </div>
    </div>
  );
}
