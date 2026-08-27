---
name: daily-report
description: >
  Generates a DAILY progress report for the PickD project based on the day's git commits.
  NOT for academic reports or documents — that's report-gen.
  Triggers: "daily report", "reporte del dia", "resumen del dia", "que hicimos hoy",
  "update para mi jefe", "progress update", "reporte diario". This skill analyzes
  today's commits, BACKLOG.md, and migrations to produce a non-technical plain-text
  summary ready to send by email.
---

# /daily-report — Daily progress report

> Before Step 1, read `docs/weekly-report/LESSONS.md` (standing rules for every warehouse
> report) and `docs/warehouse-user-flows.md`. Shared with the `warehouse-report-writer` agent;
> a correction Rafael made there applies here.

## Step 1: Gather today's data

Run in parallel:

1. `git log --since="$(date +%Y-%m-%d)" --format="%ai %s" --all` — today's commits
2. `git log --since="$(date -v-1d +%Y-%m-%d) 20:00" --until="$(date +%Y-%m-%d) 04:00" --format="%ai %s" --all` — previous night's closing commits (8pm–4am) that may belong to today's session
3. Read `BACKLOG.md` — items completed today and updated pending items
4. Check `supabase/migrations/` — migrations created today (by file date)
5. `git diff --stat HEAD~$(git log --since="$(date +%Y-%m-%d)" --oneline | wc -l)..HEAD` — files changed with relative weight
6. `TZ='America/New_York' date +"%I:%M %p"` — current time in New York for the report header
7. `git status --short` — uncommitted changes (tracked and untracked)
8. `git log origin/main..HEAD --oneline 2>/dev/null` — commits not yet pushed to production
9. Read the previous day's report from `reports/daily/` (most recent .txt) — to detect repeated items in COMING UP NEXT

### Sibling repos (if they exist on the filesystem)

Look for today's commits in related repos that share the same DB:
- `../watchdog-pickd/` — `git log --since="$(date +%Y-%m-%d)" --format="%ai %s"` (if the directory exists)

Include these changes in the report if relevant. Do not fail if the directories don't exist.

## Step 2: Pre-writing analysis

Before writing the report, analyze internally (DO NOT include in the output):

1. **Change weight:** Use `git diff --stat` to distinguish substantial changes (features, migrations) from cosmetic ones (CSS, typos). Prioritize the substantial ones in the report.
2. **Deploy status:** If there are unpushed commits (`origin/main..HEAD` is not empty), add at the end of the report: "Note: today's changes are ready but not yet live." If everything is pushed, don't mention it.
3. **Uncommitted changes:** If `git status` shows relevant modified or new files (not .DS_Store, not lockfiles), briefly mention to the user (NOT in the report, only as a note when showing the result).
4. **Stale items:** Compare COMING UP NEXT from the previous report with today's. If an item has been appearing in "coming up" for 3+ days without progress, add a line: "Note: [item] has been on the roadmap for [N] days — may need reprioritization or a different approach."
5. **Floor work:** Check if commits mention anything physical (labels, printing, moves, rack, shelf, pallet). If there's no evidence of floor work, DO NOT include the ON THE FLOOR section — but ask the user "Any floor work today?" when showing the result.
6. **Backlog breakdown:** Count pending items by priority: P1 (high), P2 (medium), open bugs. The final count uses the breakdown, not just the total.

## Step 2.5: WIN OF THE DAY — present options

Before writing the report, present 3 candidate "WIN OF THE DAY" lines to the user.

### Framing rule — WIN must be forward-looking only

The WIN OF THE DAY line goes to stakeholders and sets the tone of the whole report. **It MUST present achievements as advancement / upgrade / elevation — never as a fix, recovery, or repair.** Even when the underlying work resolved a real defect, the WIN describes the new capability or the improved KPI, not the prior failure.

This rule applies ONLY to the WIN. The rest of the report (especially WHAT'S BETTER NOW) keeps the problem → solution pattern defined in Step 3.

**Banned in the WIN** (these imply something was broken):
- "finally", "no more", "used to", "was losing", "stopped", "recovered", "fixed", "broken", "bug", "glitch", "issue", "problem"
- Any sentence that first describes what was wrong before stating the improvement.

**Favored phrasing in the WIN**:
- "advanced", "leveled up", "got sharper", "anchors", "introduces", "upgrades", "elevates", "tightens"
- "now [verb]s …" (present-tense capability) instead of "no longer [fails] …"
- KPI-oriented: "makes the accuracy KPI more precise", "gives the team one-tap priority", "shortens the path from X to Y"
- If the work was literally fixing a defect, reframe as "advanced how X is handled" or "made Y more reliable" without stating the prior state.

### Procedure

1. **Rank today's achievements by impact** (visible change to operations, not technical complexity).
2. **Write 3 options** — each a single sentence, each emphasizing a different angle or achievement. All three must respect the framing rule above.
3. **Show them numbered** and ask the user to pick one (or suggest their own).

Example format (all forward-looking):
```
Which one is today's WIN?
  1. The system now distinguishes bikes from parts on its own, tailoring stock views to what the user is looking at.
  2. The stock view opens snappier and shows only what matters for the selected item type.
  3. Reopening an order now captures a reason in one tap, keeping a clear paper trail for every change.
```

Wait for the user's choice before proceeding to Step 3. If the user provides a custom win, use that instead.

## Step 3: Write the report

Write the report to `reports/daily/YYYY-MM-DD.txt` following these rules:

### Writing rules

- **Format:** plain text, NO markdown (no #, no \*\*, no `, no |). Ready to copy-paste into an email.
- **Language:** English
- **Hard limit: 30 lines max** (including blank lines). If it doesn't fit, it wasn't that important. Prioritize impact over exhaustiveness.
- **Tone:** non-technical, natural language. The reader is a project manager who works in the warehouse with his hands, not in tech.
- **NEVER mention:** file names, functions, commits, migrations, or technical terms like "memoize", "re-render", "hooks", "context", "refs", "cache", "API", "query", "endpoint", "R2", "Supabase", "WebP", "blob", etc.

### Writing principles

- **Inverted pyramid:** most important first. If the reader only reads 3 lines, they should get the full picture.
- **IMPACT language, not activity language.** Use the "problem → solution" pattern: briefly describe what was wrong, then the result. The contrast gives weight to the achievement — without the "before", the "after" feels empty.
  - BAD: "Fixed a problem where undoing a stock move would erase the item's storage breakdown"
  - GOOD: "Undoing a move used to mess up inventory counts — now the numbers stay accurate"
  - BAD: "Added automated formatting and quality checks that run before every code change"
  - GOOD: "Common mistakes used to slip through unnoticed — new safeguards catch them before they reach the warehouse floor"
  - BAD: "Raised the Supabase query limit to 10,000 rows"
  - GOOD: "Warehouses with large inventories were getting cut-off data — the system now handles up to 10,000 items"
  - BAD: "Added cache-buster to photo URL after re-upload"
  - GOOD: "Replacing an item photo used to keep showing the old picture — now the new one appears right away"
  - BAD: "Lazy-load parts bins only when checkbox is enabled"
  - GOOD: "The app was slow to open because it pulled everything at once — now it only grabs what you're looking at"
- **Each bullet = 1 line, 2 max.** If it needs more explanation, simplify.
- **Group by impact, NOT by technical type.** Never create categories like "Bug Fixes", "Bugs Fixed", "Codebase Cleanup", "Realtime Sync", "Technical Improvements". The only allowed sections are those in the report structure (WIN OF THE DAY, WHAT'S BETTER NOW, ON THE FLOOR, COMING UP NEXT). User-visible bug fixes go in WHAT'S BETTER NOW; invisible ones are omitted or condensed into a single "Behind the scenes" line.

### Report structure:

```
Progress Update — [Month Day, Year] at [actual New York time from step 1.6]

WIN OF THE DAY:
[A single impact sentence — the most important achievement of the day. Should work as an email subject line.]

WHAT'S BETTER NOW:
- [Concrete result the team will notice]
- [Another concrete result]

ON THE FLOOR:
- [Physical work done today, if any]

COMING UP NEXT:
- [What's next, pulled from the backlog]

[X] done today / [Y] in the queue ([A] high priority, [B] medium)
[Deploy status line if applicable]
[Stale items line if applicable]
```

### Section rules:

- **WIN OF THE DAY:** ALWAYS present. The most important line in the report. Must work on its own as the full summary of the day.
- **WHAT'S BETTER NOW:** Things the warehouse team will notice. Max 6 bullets. If there are more than 6, condense the less impactful ones. If a bug fix doesn't change anything visible to the user, DO NOT include it or condense it into a line like "Behind the scenes: [X] technical fixes to prevent [outcome]".
- **ON THE FLOOR:** Only if there was physical warehouse work. If not, omit the entire section.
- **COMING UP NEXT:** Max 2 bullets. Only the immediate next items.
- **Backlog count:** A single line at the end, broken down: "X done today / Y in the queue (A high priority, B medium)". The "in the queue" count MUST be verified by counting the `- [ ]` pending items in BACKLOG.md (Priority 1 not completed + Priority 2 not completed + unresolved bugs). Do not make up the number.
- **Deploy status:** Only if there are unpushed commits. One line: "Note: today's changes are ready but not yet live."
- **Stale items:** Only if an item has been in COMING UP NEXT for 3+ days. "Note: [item] has been on the roadmap for [N] days."
- **DO NOT include "Ideas Under Consideration"** in the daily report. That's weekly meeting material.
- Sections can vary by day. If it was all floor work, there might only be WIN + ON THE FLOOR + COMING UP.

## Step 4: Language sweep (post-writing)

After writing the draft, do a line-by-line sweep looking for:

1. **Disguised technical jargon:** Words like "cache", "sync", "data loading", "optimize", "query", "server", "upload", "download" are technical even if they seem common. Replace:
   - "cache/sync" → describe the visible effect ("shows up right away", "stays in sync across devices")
   - "data loading" → "the app opening" or "pulling up your inventory"
   - "optimize/performance" → "faster", "snappier", "no more waiting"
   - "upload/download" → "adding a photo", "pulling the latest info"
   - "server" → omit or use "the system"
   - "query limit" → "the system can now handle..."
2. **Problem → result contrast:** Each bullet should have a "before" (what was wrong or missing) and an "after" (what changed). But the "before" must be the VISIBLE problem, not the technical cause.
   - BAD: "Photos no longer show the old version because we added cache-busting" (technical cause)
   - BAD: "Replacing a photo now shows the new one right away" (no problem context)
   - GOOD: "Replacing a photo used to keep showing the old picture — now the new one appears right away"
3. **Duplicates in different wrappers:** If two bullets say the same thing with different words, merge into one.
4. **Grandpa test:** Read each line and ask "Would my grandpa who never used a computer understand this?" If not, simplify.

Only after passing this sweep, write the final file.

## Step 5: Confirm

Show the user the generated report content and the file path.

If a report for today already exists, ask whether to replace it or append to the existing one.

Additional notes for the user (outside the report):
- If there are relevant uncommitted changes, mention them.
- If there was no evidence of floor work, ask "Any floor work today?"
- If there are stale items, mention them as an observation.

## Step 6: Backlog

Check if BACKLOG.md needs updating with items completed today that aren't marked. If there are updates, make them automatically.
