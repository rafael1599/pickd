---
name: compact-backlog
description: >
  Compacts a project's BACKLOG.md by archiving completed items with commit references and pruning stale detail.
  Works with any backlog format (checkboxes, strikethrough, priority sections, sprint-based).
  Three compaction layers: micro (strip file lists), full (archive + compress), manual with focus.
  Triggers: "compact backlog", "compactar backlog", "limpiar backlog", "backlog is too long",
  "archive completed items", "/compact-backlog". Run proactively when BACKLOG.md exceeds max_lines.
---

# /compact-backlog — Backlog compactor

Reduces BACKLOG.md size while preserving all context that matters for future work.
Inspired by Claude Code's context compaction: **compaction is transformation, not deletion.**

## Config

Override via arguments: `/compact-backlog max_lines=150 pending_warning=8 focus="orders"`

| Param | Default | Description |
|-------|---------|-------------|
| `max_lines` | 200 | Compact when BACKLOG.md exceeds this. |
| `pending_warning` | 10 | Warn when pending items exceed this (triage, not compaction). |
| `focus` | none | Keep more detail in items matching this keyword. Compact the rest more aggressively. |
| `mode` | `auto` | `micro` = strip file lists only. `full` = archive + compress. `auto` = micro first, full if still over limit. |

## Philosophy

- **Compaction is transformation, not deletion.** Every removed detail must be recoverable via commit hash or archive file.
- **Pending items are sacred.** Never touch, summarize, or reorder pending items.
- **Completed items decay.** Their value drops fast — the code has the fix, git has the history. What survives is the *what*, *when*, and *which commit*.
- **Discarded items explain boundaries.** Keep them — they prevent re-proposing rejected ideas.
- **Commit hashes are the bridge.** A 7-char hash lets anyone `git show` to reconstruct full context.
- **Three layers, escalating.** Micro-compact first (cheap, non-destructive), full-compact only when needed.

## Compaction Layers

### Layer 1: Micro-compaction (non-destructive)

**What it does:** Strips low-value detail from completed items **without archiving**. The item stays in BACKLOG.md but loses its fat.

**Strips from completed items:**
- `**Archivos:**` lines (file lists)
- `**Infraestructura:**` / `**Diseño técnico:**` blocks
- Multi-line `**Solución:**` blocks (keep first sentence only)
- `**Criterios de aceptación:**` on completed items (already met, no value)
- `**Escenario de falla:**` blocks
- Indented sub-bullets beyond the first level

**Never strips:**
- Item title/heading
- Dates (Creado, Completado)
- `**Estado:**` line
- `**Problema:**` line (1 sentence max — the "why" matters)
- `<!-- id: -->` tags

**When to use:** Always as first pass. Good for keeping items in-place when they were recently completed and someone might still reference them.

### Layer 2: Full compaction (archive + compress)

**What it does:** Moves completed items to BACKLOG-ARCHIVE.md and compresses them to one line in BACKLOG.md. This is the heavy compaction.

**Applies to:**
- Completed items older than 3 days (recently completed items stay micro-compacted)
- Resolved bugs older than 3 days
- "Verified in code" tables (always — line numbers drift)
- Completed detail tables

### Layer 3: Manual with focus

**What it does:** User-directed compaction that preserves more detail on items matching a keyword.

Example: `/compact-backlog focus="orders"` keeps order-related items at micro-compact level while fully compacting everything else.

## Workflow

### 1. Find the backlog

Locate BACKLOG.md in the project. Check common locations:
1. `BACKLOG.md` (project root)
2. `.agent/management/BACKLOG.md`
3. If root BACKLOG.md is a pointer ("el backlog autoritativo está en..."), follow the pointer.

If not found, ask the user.

### 2. Analyze structure

Read the full file and **detect** (do not assume) the format:

**Detect completed items** — any of:
- `- [x]` checkbox marked
- `~~strikethrough~~` headings
- Keywords: `COMPLETADO`, `COMPLETED`, `Done`, `✓`, `Resuelto`

**Detect pending items** — any of:
- `- [ ]` checkbox empty
- `###` headings without strikethrough/completion markers
- Items under sections like "Pendiente", "Next Up", "Future", "Por hacer"

**Detect sections to preserve as-is:**
- Discarded/Descartado/Dropped sections
- Open bugs (`- [ ] **[bug-` or similar)

**Detect sections that can be fully archived:**
- "Verified in code" / "Verificado en código" tables
- Completed detail tables (markdown tables where all rows are completed items)

### 3. Measure and report

Count and show to the user:
```
Backlog: X lines
  Pending:    N items (P1: A, P2: B, bugs: C)
  Completed:  N items (M micro-compactable, F fully archivable)
  Discarded:  N items (kept)
  Sections:   N archivable sections
```

If total lines ≤ `max_lines`, say "Backlog is already compact (X lines ≤ max_lines)" and stop.

### 4. Apply micro-compaction (Layer 1)

Strip low-value detail from ALL completed items (recent and old):
- Remove `**Archivos:**`, `**Infraestructura:**`, `**Diseño técnico:**` blocks
- Trim `**Solución:**` to first sentence
- Remove `**Criterios de aceptación:**` from completed items
- Remove `**Escenario de falla:**` blocks
- Collapse multi-paragraph descriptions to key sentence

If `mode=micro`, stop here after reporting results.

Check line count. If ≤ `max_lines`, stop here — micro was enough.

### 5. Gather commit references (for full compaction)

For each completed item being fully archived, find the relevant commit(s):

```bash
# Search by keywords, scoped to completion date range
git log --oneline --since="CREATED_DATE" --until="COMPLETED_DATE +1 day" --grep="keyword" --all
# For items mentioning migration files
git log --oneline -- "path/to/migration"
# For items with id tags
git log --oneline --grep="idea-NNN" --all
```

Pick the **most representative commit** per item (main change, not follow-ups). Up to 3 if equally important. Use `—` if no commit found.

### 6. Build the archive (Layer 2)

Create or append to `BACKLOG-ARCHIVE.md` (same directory as BACKLOG.md).

```markdown
## Archived [YYYY-MM-DD] — [N] items compacted

### Completed

| # | Item | Completed | Commits | ID |
|---|------|-----------|---------|----|
| 1 | Short description | YYYY-MM-DD | `abc1234` `def5678` | idea-NNN |

### Resolved bugs

| Bug | Fixed | Root cause | Commits |
|-----|-------|-----------|---------|
| Short description | YYYY-MM-DD | Max 10 words | `abc1234` |

### Archived sections

> **Verified in code** (snapshot YYYY-MM-DD) — [N] behaviors.

| Behavior | Originally verified |
|----------|-------------------|
| Short description | YYYY-MM-DD |
```

### 7. Compress in BACKLOG.md (Layer 2)

Apply full compression to items **older than 3 days** (unless protected by `focus`):

**Completed headings → one line:**
```markdown
### ~~6. Fotos de items~~ — COMPLETADO `[2026-03-26]` `a1b2c3d` <!-- id: idea-023 -->
```

**Resolved bugs → one line:**
```markdown
- [x] **[bug-002]** Undo borra en vez de mover — Fix: `[2026-03-23]` `a1b2c3d` — *snapshot usaba qty post-move*
```

**Completed tables → summary:**
```markdown
**[N] items** (YYYY-MM-DD → YYYY-MM-DD). Detalle en `BACKLOG-ARCHIVE.md`.
```

**Verified tables → pointer:**
```markdown
**[N] behaviors verificados.** Snapshot en `BACKLOG-ARCHIVE.md` ([YYYY-MM-DD]).
```

**Focus protection:** If `focus` is set, items matching the keyword stay at micro-compact level (not fully compressed). This preserves context for active work areas.

### 8. Validate

After compaction:
1. **Line count:** Report new count vs old. If still > `max_lines` and no more completed items to compact, the backlog needs triage not compaction.
2. **ID integrity:** If the backlog uses `<!-- id: -->` tags, verify every ID exists in either BACKLOG.md or BACKLOG-ARCHIVE.md.
3. **Pending integrity:** Count pending items before and after — must be identical.
4. **Pending warning:** If pending items > `pending_warning`:
   ```
   ⚠ [N] pending items. Consider triaging: reprioritize, discard, or split items before adding more.
   ```
5. Show summary:
   ```
   Compacted: X → Y lines (micro: -A, full: -B)
   Archived: Z items (N commits referenced)
   Pending: P items remain [⚠ warning if > pending_warning]
   ```

### 9. Finish

Do NOT commit automatically. Leave changes for the user to review.
Show both changed files: `BACKLOG.md` and `BACKLOG-ARCHIVE.md`.

## What NOT to do

- Never remove, reorder, summarize, or edit **pending items**
- Never remove **open bugs**
- Never remove **discarded/dropped** sections
- Never delete or rename BACKLOG.md
- Never change ID tags (`<!-- id: -->`) or their format
- Never assume a specific backlog format — always detect from file content
- Never commit automatically
- Never compact if the file is already under `max_lines`
- Never fully archive items completed less than 3 days ago (micro-compact only)
