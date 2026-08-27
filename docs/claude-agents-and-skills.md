# Claude Agents and Skills — where they live

> **Status:** Changed 2026-08-11 — skills are now vendored into this repo
> **Applies to:** `.claude/agents/`, `.claude/skills/`, `.claude/hooks/link-skills.sh`

Both agents and skills live **inside this repo**. A fresh clone has everything it
needs; nothing depends on another directory existing on the machine.

## Agents — `.claude/agents/`

Plain markdown, tracked, always have been.

| Agent                     | What it does                                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `qa-auditor`              | QA passes over the app                                                                                      |
| `warehouse-report-writer` | Writes the daily / What's new / weekly reports; learns from corrections via `docs/weekly-report/LESSONS.md` |
| `warehouse-space-planner` | Lays pallets out inside a free zone. See `docs/warehouse-floor-plans.md`                                    |
| `warehouse-sku-placement` | Decides what goes in each slot. Draft — its rules are still open questions                                  |

## Skills — `.claude/skills/`

These used to be symlinks into a central `skills` repo living elsewhere on disk, with
`.claude/skills` in `.gitignore` and a comment saying "symlink, not tracked".

That broke. The central repo moved from `~/Documents/Projects/skills` to `~/dev/skills`
and all eleven links went dead at once — silently, because a dead symlink looks like an
absent skill, not like an error. The skills were simply gone from the project and
nothing said so.

So they are now real directories, committed. 452K of markdown, which is nothing, in
exchange for a repo that works on any machine and for anyone who clones it.

Vendored on 11 Aug 2026:

| From                    | Skills                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `project-skills/pickd/` | `catalog-images`, `daily-report`, `supabase`, `ui-rules`                                                                                   |
| `global-skills/`        | `commit-craft`, `compact-backlog`, `fabrica-de-skills`, `image-cors-cache-bust`, `prod-data`, `project-setup`, `report-gen`, `web-scraper` |
| `external-skills/`      | `supabase-postgres-best-practices`                                                                                                         |

### The trade-off, stated

A global skill now has two homes: the central `skills` repo and a copy here. They can
drift. The fix when a global skill is improved centrally is to copy it in again — there
is no automation for that, on purpose, because automation is what broke last time.

Worth pruning at some point: `.claude/hooks/link-skills.sh` carries a curated list of
six skills with the note that _every skill description costs context in every session_.
The vendored set is thirteen, inherited from whatever had been symlinked locally over
time. If a skill here is not being used, delete it.

### The hook still works

`link-skills.sh` runs on SessionStart and only does anything on Claude Code on the web,
where the `skills` repo is cloned as a sibling directory. It links a skill only when the
destination is missing or is itself a symlink:

```bash
if [ -L "$dst" ] || [ ! -e "$dst" ]; then
    ln -sfn "$src" "$dst"
fi
```

A vendored directory is neither, so the hook skips it and leaves the committed copy
alone. Nothing to change there.
