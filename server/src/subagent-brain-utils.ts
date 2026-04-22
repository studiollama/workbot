/**
 * Scoped brain utilities for subagents.
 * Identical to brain-utils.ts but with BRAIN_ROOT rebased to subagent directory.
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from "fs";
import { join, relative } from "path";

export function createScopedBrainUtils(brainRoot: string) {
  function getAllNotes(): string[] {
    const results: string[] = [];
    function walk(dir: string) {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith(".md")) {
          results.push(relative(brainRoot, full).replace(/\\/g, "/"));
        }
      }
    }
    walk(brainRoot);
    return results;
  }

  function loadNote(notePath: string) {
    const full = join(brainRoot, notePath);
    if (!existsSync(full)) return null;
    const content = readFileSync(full, "utf-8");
    const stat = statSync(full);

    // Parse frontmatter
    let title = notePath.replace(/\.md$/, "").split("/").pop() ?? notePath;
    let tags: string[] = [];
    let aliases: string[] = [];

    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
      const fm = fmMatch[1];
      const titleMatch = fm.match(/^title:\s*(.+)$/m);
      if (titleMatch) title = titleMatch[1].trim();

      // Parse tags
      const tagsMatch = fm.match(/^tags:\s*\n((?:\s+-\s+.+\n?)*)/m);
      if (tagsMatch) {
        tags = tagsMatch[1]
          .split("\n")
          .map((l) => l.replace(/^\s+-\s+/, "").trim())
          .filter(Boolean);
      }

      // Parse aliases
      const aliasMatch = fm.match(/^aliases:\s*\[([^\]]*)\]/m);
      if (aliasMatch) {
        aliases = aliasMatch[1].split(",").map((a) => a.trim()).filter(Boolean);
      }
    }

    return {
      path: notePath,
      title,
      tags,
      aliases,
      mtime: stat.mtime,
      content,
    };
  }

  function writeNote(notePath: string, content: string): void {
    const full = join(brainRoot, notePath);
    const dir = full.replace(/\/[^/]+$/, "");
    mkdirSync(dir, { recursive: true });
    writeFileSync(full, content, "utf-8");
  }

  function extractWikilinks(content: string): string[] {
    const matches = content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g);
    return [...new Set([...matches].map((m) => m[1]))];
  }

  function buildLinkGraph(): Map<string, { outgoing: string[]; incoming: string[] }> {
    const graph = new Map<string, { outgoing: string[]; incoming: string[] }>();
    const allPaths = getAllNotes();
    const titleToPath = new Map<string, string>();

    for (const p of allPaths) {
      graph.set(p, { outgoing: [], incoming: [] });
      const note = loadNote(p);
      if (note) {
        titleToPath.set(note.title.toLowerCase(), p);
        for (const alias of note.aliases) {
          titleToPath.set(alias.toLowerCase(), p);
        }
      }
    }

    for (const p of allPaths) {
      const note = loadNote(p);
      if (!note) continue;
      const links = extractWikilinks(note.content);
      for (const link of links) {
        const target = titleToPath.get(link.toLowerCase());
        if (target && target !== p) {
          graph.get(p)!.outgoing.push(target);
          graph.get(target)!.incoming.push(p);
        }
      }
    }

    return graph;
  }

  function validateNote(content: string) {
    const warnings: string[] = [];
    let valid = true;

    if (!content.startsWith("---\n")) {
      warnings.push("Missing YAML frontmatter (must start with ---)");
      valid = false;
    }

    const typeTagPattern = /^\s+-\s+(decision|pattern|correction|entity|project|context|retrospective|note)\s*$/m;
    if (!typeTagPattern.test(content)) {
      warnings.push("Missing type tag in frontmatter");
    }

    const statusPattern = /^\s+-\s+status\/(active|superseded|archived)\s*$/m;
    if (!statusPattern.test(content)) {
      warnings.push("Missing status tag in frontmatter");
    }

    const wikilinks = extractWikilinks(content);
    if (wikilinks.length === 0) {
      warnings.push("No outgoing wikilinks found (every note needs at least 1)");
    }

    return { valid: warnings.length === 0, warnings };
  }

  return {
    BRAIN_ROOT: brainRoot,
    getAllNotes,
    loadNote,
    writeNote,
    buildLinkGraph,
    validateNote,
    extractWikilinks,
  };
}
