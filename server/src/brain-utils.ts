import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, relative, dirname, basename, extname } from "path";
import { PROJECT_ROOT } from "./services.js";

export const BRAIN_ROOT = join(PROJECT_ROOT, "workbot-brain");

// ── File discovery ──────────────────────────────────────────────────────

/** Recursively find all .md files in the brain vault */
export function getAllNotes(): string[] {
  const results: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "subagents" && entry.name !== "common") {
        walk(full);
      } else if (entry.isFile() && extname(entry.name) === ".md") {
        results.push(relative(BRAIN_ROOT, full).replace(/\\/g, "/"));
      }
    }
  }
  if (existsSync(BRAIN_ROOT)) walk(BRAIN_ROOT);
  return results;
}

// ── Frontmatter parsing ─────────────────────────────────────────────────

export interface NoteMeta {
  path: string;
  title: string;
  tags: string[];
  aliases: string[];
  created?: string;
  frontmatter: Record<string, unknown>;
  content: string;
  mtime: Date;
}

/** Parse YAML frontmatter from markdown content (simple parser, no deps) */
function parseFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };

  const meta: Record<string, unknown> = {};
  const lines = match[1].split(/\r?\n/);
  let currentKey = "";
  let inArray = false;

  for (const line of lines) {
    const kvMatch = line.match(/^(\w[\w_-]*):\s*(.*)/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const val = kvMatch[2].trim();
      if (val === "" || val === "[]") {
        meta[currentKey] = [];
        inArray = true;
      } else if (val === "null") {
        meta[currentKey] = null;
        inArray = false;
      } else {
        // Strip quotes
        meta[currentKey] = val.replace(/^["']|["']$/g, "");
        inArray = false;
      }
    } else if (inArray && line.match(/^\s+-\s+/)) {
      const val = line.replace(/^\s+-\s+/, "").replace(/^["']|["']$/g, "").trim();
      if (!Array.isArray(meta[currentKey])) meta[currentKey] = [];
      (meta[currentKey] as string[]).push(val);
    }
  }

  return { meta, body: match[2] };
}

/** Load metadata for a single note */
export function loadNote(notePath: string): NoteMeta | null {
  const fullPath = join(BRAIN_ROOT, notePath);
  if (!existsSync(fullPath)) return null;

  const raw = readFileSync(fullPath, "utf-8");
  const stat = statSync(fullPath);
  const { meta, body } = parseFrontmatter(raw);

  const tags: string[] = [];
  if (Array.isArray(meta.tags)) {
    tags.push(...(meta.tags as string[]));
  } else if (typeof meta.tags === "string") {
    tags.push(meta.tags);
  }

  const aliases: string[] = [];
  if (Array.isArray(meta.aliases)) {
    aliases.push(...(meta.aliases as string[]));
  }

  const title = basename(notePath, ".md").replace(/-/g, " ");

  return {
    path: notePath,
    title,
    tags,
    aliases,
    created: typeof meta.created === "string" ? meta.created : undefined,
    frontmatter: meta,
    content: body,
    mtime: stat.mtime,
  };
}

// ── Wikilink parsing ────────────────────────────────────────────────────

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

/** Extract all wikilink targets from markdown content */
export function extractWikilinks(content: string): string[] {
  const links: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(content)) !== null) {
    links.push(m[1].trim());
  }
  return [...new Set(links)];
}

/** Build a map of notePath -> { outgoing wikilinks, incoming wikilinks } */
export function buildLinkGraph(): Map<string, { outgoing: string[]; incoming: string[] }> {
  const notes = getAllNotes();
  const graph = new Map<string, { outgoing: string[]; incoming: string[] }>();

  // Initialize all notes
  for (const n of notes) {
    graph.set(n, { outgoing: [], incoming: [] });
  }

  // Build a title -> path lookup (case-insensitive)
  const titleToPath = new Map<string, string>();
  for (const n of notes) {
    const title = basename(n, ".md").toLowerCase();
    titleToPath.set(title, n);

    // Also index aliases
    const note = loadNote(n);
    if (note) {
      for (const alias of note.aliases) {
        titleToPath.set(alias.toLowerCase(), n);
      }
    }
  }

  // Parse links
  for (const n of notes) {
    const fullPath = join(BRAIN_ROOT, n);
    const raw = readFileSync(fullPath, "utf-8");
    const links = extractWikilinks(raw);

    const entry = graph.get(n)!;
    for (const link of links) {
      // Resolve wikilink to a note path (like Obsidian: match by title or alias)
      const resolved = titleToPath.get(link.toLowerCase());
      if (resolved && graph.has(resolved)) {
        entry.outgoing.push(resolved);
        graph.get(resolved)!.incoming.push(n);
      } else {
        // Unresolved link — keep raw text for display but won't create graph edge
        entry.outgoing.push(link);
      }
    }
  }

  return graph;
}

// ── Write utilities ─────────────────────────────────────────────────────

export interface WriteValidation {
  valid: boolean;
  warnings: string[];
}

/** Validate a brain note before writing */
export function validateNote(content: string): WriteValidation {
  const warnings: string[] = [];
  const { meta, body } = parseFrontmatter(content);

  // Check frontmatter exists
  if (!content.startsWith("---")) {
    warnings.push("Missing YAML frontmatter (required: tags with type + status)");
  }

  // Check tags
  const tags = Array.isArray(meta.tags) ? meta.tags as string[] : [];
  const typeTagPrefixes = ["decision", "pattern", "correction", "entity", "project", "context", "retrospective"];
  const hasTypeTag = tags.some((t) => typeTagPrefixes.includes(t as string));
  if (!hasTypeTag) {
    warnings.push(`Missing type tag. Expected one of: ${typeTagPrefixes.join(", ")}`);
  }

  const hasStatusTag = tags.some((t) => (t as string).startsWith("status/"));
  if (!hasStatusTag) {
    warnings.push("Missing status tag (e.g., status/active, status/superseded, status/archived)");
  }

  // Check wikilinks
  const links = extractWikilinks(body);
  if (links.length === 0) {
    warnings.push("No wikilinks found. Every note must have ≥1 outgoing [[wikilink]]");
  }

  return { valid: warnings.length === 0, warnings };
}

/** Write a note to the brain vault */
export function writeNote(notePath: string, content: string): void {
  const fullPath = join(BRAIN_ROOT, notePath);
  const dir = dirname(fullPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, content, "utf-8");
}
