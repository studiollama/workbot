import { Router } from "express";
import { readdirSync, existsSync, unlinkSync, statSync } from "fs";
import { join, dirname, basename } from "path";
import {
  BRAIN_ROOT,
  getAllNotes,
  loadNote,
  buildLinkGraph,
  extractWikilinks,
  writeNote,
  validateNote,
} from "../brain-utils.js";
import { createScopedBrainUtils } from "../subagent-brain-utils.js";
import { COMMON_BRAIN_ROOT } from "../common-brain-utils.js";

const router = Router();

/** Resolve brain utils based on scope query param */
function resolveBrain(scope?: string) {
  if (!scope || scope === "host") {
    return { getAllNotes, loadNote, buildLinkGraph, extractWikilinks, writeNote, validateNote, root: BRAIN_ROOT };
  }
  if (scope === "common") {
    const brain = createScopedBrainUtils(COMMON_BRAIN_ROOT);
    return { ...brain, root: COMMON_BRAIN_ROOT };
  }
  if (scope.startsWith("subagent:")) {
    const id = scope.slice("subagent:".length);
    const subRoot = join(BRAIN_ROOT, "subagents", id);
    if (!existsSync(subRoot)) throw new Error(`Subagent brain not found: ${id}`);
    const brain = createScopedBrainUtils(subRoot);
    return { ...brain, root: subRoot };
  }
  throw new Error(`Invalid scope: ${scope}`);
}

// ── List available brains ──────────────────────────────────────────────

router.get("/brains", (_req, res) => {
  const brains: { id: string; label: string }[] = [
    { id: "host", label: "Host Brain" },
    { id: "common", label: "Common Knowledge" },
  ];

  const subagentsDir = join(BRAIN_ROOT, "subagents");
  if (existsSync(subagentsDir)) {
    for (const entry of readdirSync(subagentsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        brains.push({ id: `subagent:${entry.name}`, label: entry.name });
      }
    }
  }

  res.json(brains);
});

// ── List all notes (metadata only) ────────────────────────────────────

router.get("/notes", (req, res) => {
  try {
    const brain = resolveBrain(req.query.scope as string | undefined);
    const paths = brain.getAllNotes();
    const notes = paths.map((p) => {
      const note = brain.loadNote(p);
      if (!note) return { path: p, title: p, tags: [], aliases: [], mtime: null };
      return {
        path: note.path,
        title: note.title,
        tags: note.tags,
        aliases: note.aliases,
        mtime: note.mtime,
      };
    });
    res.json(notes);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ── Get single note with content ──────────────────────────────────────

router.get("/notes/*", (req, res) => {
  try {
    const brain = resolveBrain(req.query.scope as string | undefined);
    // Express puts the wildcard part after /notes/
    const notePath = (req.params as any)[0] as string;
    if (!notePath) return res.status(400).json({ error: "Note path required" });

    const note = brain.loadNote(notePath);
    if (!note) return res.status(404).json({ error: `Note not found: ${notePath}` });

    // Get links for this note
    const graph = brain.buildLinkGraph();
    const links = graph.get(notePath);

    res.json({
      path: note.path,
      title: note.title,
      tags: note.tags,
      aliases: note.aliases,
      content: note.content,
      frontmatter: (note as any).frontmatter ?? {},
      mtime: note.mtime,
      outgoing: links?.outgoing ?? [],
      incoming: links?.incoming ?? [],
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ── Graph data (nodes + links) ────────────────────────────────────────

router.get("/graph", (req, res) => {
  try {
    const brain = resolveBrain(req.query.scope as string | undefined);
    const allPaths = brain.getAllNotes();
    const linkGraph = brain.buildLinkGraph();

    // Build title-to-path map for wikilink resolution (includes cross-brain refs)
    const titleToPath: Record<string, string> = {};

    // Add cross-brain titles so wikilinks to other brains resolve
    // Format: "scope:path" — the frontend detects the colon and switches brains
    const currentScope = (req.query.scope as string) || "host";
    const crossBrainScopes = currentScope === "common" ? ["host"] : ["common"];
    for (const xScope of crossBrainScopes) {
      try {
        const xBrain = resolveBrain(xScope);
        for (const xp of xBrain.getAllNotes()) {
          const xNote = xBrain.loadNote(xp);
          if (xNote) {
            const scopedPath = `${xScope}:${xp}`;
            // Only add if not already claimed by current brain
            if (!titleToPath[xNote.title.toLowerCase()]) {
              titleToPath[xNote.title.toLowerCase()] = scopedPath;
            }
            for (const alias of xNote.aliases) {
              if (!titleToPath[alias.toLowerCase()]) {
                titleToPath[alias.toLowerCase()] = scopedPath;
              }
            }
          }
        }
      } catch { /* cross-brain not available */ }
    }

    const nodes = allPaths.map((p) => {
      const note = brain.loadNote(p);
      const entry = linkGraph.get(p);
      const connections = (entry?.outgoing.length ?? 0) + (entry?.incoming.length ?? 0);

      if (note) {
        // Current brain titles override cross-brain ones
        titleToPath[note.title.toLowerCase()] = p;
        for (const alias of note.aliases) {
          titleToPath[alias.toLowerCase()] = p;
        }
      }

      return {
        id: p,
        title: note?.title ?? p,
        tags: note?.tags ?? [],
        connections,
      };
    });

    const links: { source: string; target: string }[] = [];
    const seen = new Set<string>();
    const nodeIds = new Set(allPaths);

    for (const p of allPaths) {
      const entry = linkGraph.get(p);
      if (!entry) continue;
      for (const target of entry.outgoing) {
        // Only include links where both source and target are actual notes
        if (!nodeIds.has(target)) continue;
        const key = [p, target].sort().join("|");
        if (!seen.has(key)) {
          seen.add(key);
          links.push({ source: p, target });
        }
      }
    }

    res.json({ nodes, links, titleToPath });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ── Search notes ──────────────────────────────────────────────────────

router.get("/search", (req, res) => {
  try {
    const q = (req.query.q as string || "").toLowerCase().trim();
    if (!q) return res.json([]);

    const brain = resolveBrain(req.query.scope as string | undefined);
    const paths = brain.getAllNotes();
    const results: any[] = [];

    for (const p of paths) {
      if (results.length >= 50) break;
      const note = brain.loadNote(p);
      if (!note) continue;

      const match =
        note.title.toLowerCase().includes(q) ||
        note.tags.some((t) => t.toLowerCase().includes(q)) ||
        note.aliases.some((a) => a.toLowerCase().includes(q)) ||
        note.path.toLowerCase().includes(q) ||
        note.content.toLowerCase().includes(q);

      if (match) {
        // Extract a snippet around the match
        let snippet = "";
        const contentLower = note.content.toLowerCase();
        const idx = contentLower.indexOf(q);
        if (idx >= 0) {
          const start = Math.max(0, idx - 60);
          const end = Math.min(note.content.length, idx + q.length + 60);
          snippet = (start > 0 ? "..." : "") + note.content.slice(start, end).replace(/\n/g, " ") + (end < note.content.length ? "..." : "");
        }

        results.push({
          path: note.path,
          title: note.title,
          tags: note.tags,
          aliases: note.aliases,
          mtime: note.mtime,
          snippet,
        });
      }
    }

    res.json(results);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ── Folder tree ──────────────────────────────────────────────────────

interface TreeNode {
  name: string;
  path: string;
  type: "folder" | "file";
  tags?: string[];
  children?: TreeNode[];
}

router.get("/tree", (req, res) => {
  try {
    const brain = resolveBrain(req.query.scope as string | undefined);
    const paths = brain.getAllNotes();
    const root: TreeNode = { name: "", path: "", type: "folder", children: [] };

    for (const p of paths) {
      const parts = p.split("/");
      let current = root;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isFile = i === parts.length - 1;
        if (isFile) {
          const note = brain.loadNote(p);
          current.children!.push({
            name: part.replace(/\.md$/, ""),
            path: p,
            type: "file",
            tags: note?.tags ?? [],
          });
        } else {
          let folder = current.children!.find((c) => c.type === "folder" && c.name === part);
          if (!folder) {
            folder = { name: part, path: parts.slice(0, i + 1).join("/"), type: "folder", children: [] };
            current.children!.push(folder);
          }
          current = folder;
        }
      }
    }

    // Sort: folders first, then files, both alphabetical
    function sortTree(node: TreeNode) {
      if (node.children) {
        node.children.sort((a, b) => {
          if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        node.children.forEach(sortTree);
      }
    }
    sortTree(root);

    res.json(root.children ?? []);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ── Write/update note ────────────────────────────────────────────────

router.put("/notes/*", (req, res) => {
  try {
    const brain = resolveBrain(req.body.scope);
    const notePath = (req.params as any)[0] as string;
    if (!notePath) return res.status(400).json({ error: "Note path required" });

    const { content, force } = req.body;
    if (!content || typeof content !== "string") return res.status(400).json({ error: "Content required" });

    const validation = brain.validateNote(content);
    if (!validation.valid && !force) {
      return res.status(422).json({
        error: "Validation failed",
        warnings: validation.warnings,
      });
    }

    brain.writeNote(notePath, content);
    res.json({ ok: true, path: notePath, warnings: validation.warnings });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Create new note ──────────────────────────────────────────────────

router.post("/notes", (req, res) => {
  try {
    const brain = resolveBrain(req.body.scope);
    const { path: notePath, content, force } = req.body;
    if (!notePath || typeof notePath !== "string") return res.status(400).json({ error: "Path required" });
    if (!content || typeof content !== "string") return res.status(400).json({ error: "Content required" });

    // Check if already exists
    const existing = brain.loadNote(notePath);
    if (existing) return res.status(409).json({ error: `Note already exists: ${notePath}` });

    const validation = brain.validateNote(content);
    if (!validation.valid && !force) {
      return res.status(422).json({
        error: "Validation failed",
        warnings: validation.warnings,
      });
    }

    brain.writeNote(notePath, content);
    res.status(201).json({ ok: true, path: notePath, warnings: validation.warnings });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Delete note ──────────────────────────────────────────────────────

router.delete("/notes/*", (req, res) => {
  try {
    const brain = resolveBrain(req.query.scope as string | undefined);
    const notePath = (req.params as any)[0] as string;
    if (!notePath) return res.status(400).json({ error: "Note path required" });

    const fullPath = join(brain.root, notePath);
    if (!existsSync(fullPath)) return res.status(404).json({ error: `Note not found: ${notePath}` });

    unlinkSync(fullPath);
    res.json({ ok: true, deleted: notePath });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
