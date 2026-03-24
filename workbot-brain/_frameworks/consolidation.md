# Memory Consolidation Framework

## Purpose

As the brain accumulates knowledge, it needs periodic consolidation to stay
useful. This framework defines how to merge, deduplicate, and compress
memories without losing critical information.

## Consolidation Triggers

### Automatic Triggers
- Hot memory (`context/ACTIVE.md`) exceeds 60 lines
- Corrections log exceeds 20 entries
- Inbox has items older than 3 days
- Daily context files exceed 30 days old

### Manual Triggers
- User requests a brain cleanup
- Before starting a major new project
- During weekly/monthly retrospectives

## Deduplication Rules

### Similarity Detection
When creating a new note, check for existing notes with:
1. **Same title or very similar title** - likely duplicate
2. **Same tags AND overlapping content** - likely duplicate
3. **References the same entities/decisions** - possibly related, not duplicate

### Merge Strategy
When duplicates are found:
1. Keep the note with more links and richer content
2. Merge unique information from the other note into it
3. Update the `updated` date
4. Delete the duplicate
5. Fix any broken links

## Compression Strategies

### Context Compression
Daily context files older than 7 days:
- Extract decisions made -> link to decision notes
- Extract patterns observed -> link to pattern notes
- Compress session details to 2-3 line summaries
- Archive the compressed version

### Correction Compression
When corrections are well-internalized:
- Summarize the correction in one line
- Link to any patterns it created
- Move to `knowledge/corrections/` as a brief record
- Remove from hot `CORRECTIONS.md`

### Inbox Processing
For each inbox item:
1. Does it match an existing note? -> Merge into that note
2. Is it a new decision/pattern/entity? -> Create proper note from template
3. Is it session-specific trivia? -> Discard
4. Unsure? -> Keep for one more review cycle, then decide

## Hot Memory Budget

`context/ACTIVE.md` has a strict line budget:

| Section          | Max Lines | Notes                              |
|-----------------|-----------|-------------------------------------|
| Current Focus   | 5         | What we're working on               |
| Active Tasks    | 15        | Task list with checkboxes           |
| Blockers        | 5         | Current blockers                    |
| Recent Corrections | 10     | One-liners only                     |
| Next Actions    | 5         | Prioritized next steps              |
| Session Notes   | 20        | Most recent session only            |
| **Total**       | **60**    | Consolidate if exceeded             |
