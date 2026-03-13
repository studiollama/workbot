# Knowledge Graph Framework

## Purpose

The brain isn't just a filing cabinet - it's a connected graph. This framework
defines how notes link to each other to form a navigable knowledge network
that Obsidian can visualize.

## Node Types (Note Categories)

```
[Decision] ──references──> [Pattern]
    │                          │
    │ informs                  │ confirmed_by
    │                          │
    v                          v
[Project] <──learned_in── [Correction]
    │
    │ involves
    v
[Entity]
```

## Link Types

Use these link patterns consistently:

### Explicit Links (in note body)
- `See also: [[Note Name]]` - general relationship
- `Informed by: [[Decision Name]]` - decision dependency
- `Confirmed by: [[Pattern Name]]` - pattern validation
- `Corrected in: [[Correction Note]]` - correction reference
- `Part of: [[Project Name]]` - project membership
- `Supersedes: [[Old Decision]]` - decision evolution

### Tag-Based Connections
Tags create implicit groupings that Obsidian graph view can filter:
- `#domain/X` - all notes in a domain cluster together
- `#status/active` - all currently relevant notes
- `#priority/high` - urgent items across all categories

## Graph Health Indicators

### Healthy Graph
- Every note has at least 1 outgoing link
- Decisions link to their context (patterns, corrections, entities)
- No orphan notes (notes with zero links)
- Clusters form around domains and projects

### Unhealthy Graph
- Many orphan notes (capture without connection)
- Circular-only references (A->B->A, no broader connections)
- Stale links to archived/deleted notes
- Monolithic hubs (one note linked to everything)

## Obsidian Graph View Configuration

Recommended graph view filters for different use cases:

### Active Work View
- Filter: `tag:#status/active`
- Depth: 2
- Shows: current decisions, active projects, recent patterns

### Decision Archaeology
- Filter: `path:knowledge/decisions`
- Depth: 3
- Shows: decision chain and what informed each decision

### Domain Map
- Filter: `tag:#domain/X` (replace X with domain)
- Depth: 2
- Shows: all knowledge in a specific domain area
