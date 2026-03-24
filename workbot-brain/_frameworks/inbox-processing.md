# Inbox Processing Framework

## Purpose

The inbox is a quick-capture zone. Things land here during sessions when
there's no time to properly categorize them. This framework defines how
to process inbox items into proper brain notes.

## Processing Workflow

```
┌─────────┐
│  INBOX  │
│  ITEM   │
└────┬────┘
     │
     v
┌─────────────┐     ┌──────────┐
│ Is it still  │─NO─>│ DISCARD  │
│ relevant?    │     └──────────┘
└──────┬──────┘
       │ YES
       v
┌─────────────┐     ┌──────────────┐
│ Does a note  │─YES>│ MERGE into   │
│ already exist│     │ existing note│
│ for this?    │     └──────────────┘
└──────┬──────┘
       │ NO
       v
┌─────────────┐
│ What type    │
│ is it?       │
└──────┬──────┘
       │
  ┌────┼────┬────────┬─────────┐
  v    v    v        v         v
 DEC  PAT  COR     ENT       CTX
  │    │    │        │         │
  v    v    v        v         v
 Use template, create note, file in knowledge/
```

## Type Classification Guide

Ask these questions about each inbox item:

1. **"We chose X over Y because..."** -> Decision
2. **"This keeps happening..."** or **"This always works..."** -> Pattern
3. **"I was wrong about..."** or **"User said not to..."** -> Correction
4. **"[Person/System] does/is..."** -> Entity
5. **"Today we..."** or **"Current state is..."** -> Context
6. **"The [project] needs..."** -> Project note update

## Processing Checklist

For each inbox item:
- [ ] Read the raw capture
- [ ] Determine if still relevant
- [ ] Check for existing duplicate/related notes
- [ ] Classify the type
- [ ] Create/update note using appropriate template
- [ ] Add at least one `[[wikilink]]` to connect it
- [ ] Add appropriate tags
- [ ] Delete the inbox item

## SLA

- Items should not sit in inbox longer than **3 days**
- Process inbox at the start of each session if items exist
- If inbox has 10+ items, prioritize processing over new work
