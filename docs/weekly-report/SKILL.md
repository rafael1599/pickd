---
name: weekly-report
description: >-
  Produce a Roman-facing weekly (or sprint) warehouse-operations report for PickD.
  Investigate what shipped across the pickd + watchdog-pickd repos, translate each
  change into an operator win (the "why", before/after, "what you gain"), draft it
  in plain language, then render a branded PDF in the PickD Activity-Report style
  with figures. Use whenever the user asks for a weekly/progress report for Roman
  or the warehouse team, or to summarize "what changed" for a non-technical operator.
---

# Weekly Report — PickD (operator-facing)

Turn a week (or two) of engineering work into a short, high-impact report that
**Roman, the warehouse operations lead**, can read in two minutes — no jargon,
every item tied to the floor. Output is a branded **PDF** (1–2 pages) plus the
**Markdown** it was written from.

This skill is run by the **main agent** (not a subagent) because Step 1 fans out
**parallel investigator subagents**, and only the main agent can spawn them.

> Before writing any copy, read **`voice-and-style.md`** (how to talk to Roman)
> and **`LESSONS.md`** (preferences learned from past reports). Before touching
> the PDF, read **`pdf-pipeline.md`** (how it renders + the glyph/quote gotchas).

---

## 0 · Calibrate (ask, don't assume)

Read `LESSONS.md` first — it holds standing preferences, so only ask what's still
open. Then confirm with the user via **AskUserQuestion** (one compact round):

- **Date range** — since when? (e.g. "since last Monday", a date, or a git tag).
- **Repos** — pickd only, or pickd + watchdog-pickd? (default: both.)
- **Audience & language** — Roman / floor team; English or Spanish? (default: EN.)
- **Length** — 1 page (scoreboard-only), or ~2 pages with a figure per win?
- **Emphasis** — anything the user personally wants highlighted (their own work).

If the user already answered something this session or it's pinned in `LESSONS.md`,
skip it. Don't interrogate — propose sensible defaults and move.

---

## 1 · Gather (fan out — be exhaustive)

Launch **several `general-purpose` subagents in parallel** (one message, multiple
Agent calls). Split the work by repo and by area so each returns a tight digest:

- "List every merged PR and notable commit in `<repo>` since `<date>`. For each:
  number, title, the user-facing behavior change, and the files touched. Read the
  diffs — don't trust titles. Return a table ordered by operator impact."
- For the heavy hitters, a follow-up agent: "Explain the root cause and the fix in
  PR #N — what was breaking for the operator, and how does it behave now?"

Cross-check both repos (`pickd` = the app, `watchdog-pickd` = the PDF→order
capture daemon). Many wins span both. Keep a raw technical inventory first (this
is the source of truth); the narrative comes later.

GitHub MCP tools (`mcp__github__*`) and local `git log`/diffs are both fair game.
If a repo isn't in session scope, say so rather than guessing.

---

## 2 · Understand each change

For every candidate item, nail down three things — you can't write the "why"
without them:

1. **What it does** now (the new behavior), in one sentence.
2. **The operator pain it removes** — what went wrong on the floor before, and why
   it mattered (wrong labels, lost time, manual re-entry, lost trust…).
3. **Before → After** — the crisp contrast that becomes the figure and scoreboard.

When unsure how something actually works, read the code/tests — don't infer.

---

## 3 · Filter to the meat

Keep **only what an operator feels**. Drop refactors, CI, types, infra, and
anything invisible on the floor. Order by impact. 5–7 wins is the sweet spot;
fold small related fixes into a parent win. The goal (the user's words):
_"quedarnos solo con la carnecita."_

---

## 4 · Draft the Markdown (Roman's voice)

Write the report in Markdown FIRST and get the user's sign-off before any PDF.
Apply `voice-and-style.md` in full. The non-negotiables:

- **First-person singular** for the work the user did ("I tracked it down, I
  rebuilt…"). Use "we / on the floor" only for things _noticed_ during operations.
- **No tech jargon.** Call things by their warehouse names (it's a **SKU**, not a
  "code"; a **label**, a **pallet**). Explain the **why**, not the implementation.
- Each win = short headline → 2–4 sentences → a **"What you gain:"** payoff.
- Be honest about scope and uncertainty; never inflate time saved or severity.

Save it (e.g. `/tmp/weekly-report.md`) and show it. Iterate until the user is happy
with the _words_ — cheap to change now, expensive after the PDF.

---

## 5 · Render the PDF

Copy `report-template.jsx` and replace the marked `===== EDIT: =====` blocks
(SECTIONS, SCORE, META) with the approved content; reuse/clone the figure library
for each win (or embed a real screenshot with `<ImageFig src=... />` if the user
provides one). Then:

```bash
# from this skill folder (resolves pickd deps automatically)
node build.cjs /tmp/this-week.jsx /tmp/weekly-report.pdf
```

**Always preview every page as PNG before sending** (PyMuPDF or pdftoppm — see
`pdf-pipeline.md`) and visually check: glyphs render (no tofu/`'`/dropped ✓),
pages are balanced, nothing clipped. Fix, rebuild, re-preview. Then deliver the
PDF with `SendUserFile`.

---

## 6 · Learn (improve every time)

After delivery, ask the user one short reflection: _"What landed well, and what
should the next report do differently?"_ Then **append durable preferences to
`LESSONS.md`** (tone tweaks, words Roman likes/dislikes, length, recurring wins to
watch, figure ideas). This file is the skill's memory — future runs start smarter.
Keep entries short and dated; prune contradictions.

---

## Files in this skill

| File                  | Purpose                                                           |
| --------------------- | ----------------------------------------------------------------- |
| `SKILL.md`            | This workflow.                                                    |
| `voice-and-style.md`  | How to write for Roman (voice rules + every correction learned).  |
| `pdf-pipeline.md`     | How the PDF renders, the figure library, and the gotchas.         |
| `report-template.jsx` | The framework + figure library + last report as a worked example. |
| `build.cjs`           | Portable build/preview runner (`node build.cjs in.jsx out.pdf`).  |
| `LESSONS.md`          | Running memory: preferences + lessons from each report.           |

## Setup (one-time, to make it auto-load as a skill)

`.claude/skills/` in the pickd repo is gitignored (skills live in the central
`rafael1599/skills` repo and are symlinked by `.claude/hooks/link-skills.sh`).
To activate this as a real skill, copy this folder into the central repo and
enable it in the hook:

```bash
cp -r docs/weekly-report  <skills-repo>/project-skills/pickd/weekly-report
# then add this line to the SKILLS list in .claude/hooks/link-skills.sh:
#   project-skills/pickd/weekly-report
```

Until then it still works as a committed playbook: open this file and follow it,
and the `build.cjs` / template run as-is from `docs/weekly-report/`.
