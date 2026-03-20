# Memory Lifecycle Framework

## Purpose

This framework defines how memories age, get consolidated, and eventually
archived. It prevents brain bloat while preserving valuable knowledge.

## Lifecycle States

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  ACTIVE  │───>│  STABLE  │───>│ DECAYING │───>│ ARCHIVED │
│ (0-7d)   │    │ (7-30d)  │    │ (30-90d) │    │ (90d+)   │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
```

## Rules by Memory Type

| Type        | Active    | Stable    | Decaying  | Archive Trigger        |
|------------|-----------|-----------|-----------|------------------------|
| Decision   | Permanent | Permanent | Permanent | Only when superseded   |
| Pattern    | Permanent | Permanent | Permanent | Only when invalidated  |
| Correction | 30 days   | 60 days   | 90 days   | When fully internalized|
| Context    | 7 days    | 30 days   | N/A       | After 30 days          |
| Entity     | Permanent | Permanent | Permanent | Only when irrelevant   |
| Project    | Duration  | +30 days  | +60 days  | After project ends     |
| Inbox      | 3 days    | N/A       | N/A       | Process or discard     |

## Consolidation Rules

### Daily (Automatic)
- Process all `inbox/` items older than 24 hours
- Archive context files older than 30 days

### Weekly (During Retrospective)
- Review `context/CORRECTIONS.md` - archive internalized corrections
- Check `knowledge/decisions/ACTIVE-DECISIONS.md` for stale entries
- Consolidate duplicate or overlapping patterns

### Monthly (During Retrospective)
- Full review of all `knowledge/` directories
- Update entity profiles with new information
- Archive completed projects
- Prune tags that are no longer used

## Archival Process

1. Create summary note in `archive/summaries/YYYY-MM.md`
2. Move the original file to `archive/YYYY/MM/`
3. Update any `[[wikilinks]]` that pointed to the archived note
4. Remove from hot memory if it was there

## Resurrection Rules

Archived memories can be resurrected if:
- The topic becomes relevant again
- A new decision references the archived one
- The user explicitly asks about it

When resurrecting:
1. Move back to the appropriate `knowledge/` directory
2. Update the `updated` frontmatter date
3. Add a note about why it was resurrected
