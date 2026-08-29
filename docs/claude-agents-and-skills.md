# Claude Agents and Skills — where they live

> **Status:** Changed 2026-08-29 — global skills come from the `rafael-skills` plugin marketplace; only the four project skills stay in this repo
> **Applies to:** `.claude/agents/`, `.claude/skills/`, `.claude/settings.json`

## 2026-08-29 — global skills are a plugin now

`.claude/settings.json` declares the marketplace `rafael1599/skills` (`extraKnownMarketplaces`) and enables
`globals@rafael-skills` + `external@rafael-skills` (`enabledPlugins`). Claude Code installs them when the
project opens — locally, on the web, on any machine — so a fresh clone still works, which was the whole
point of vendoring. The vendored copies of the nine global skills and `supabase-postgres-best-practices`
were removed (they had two homes and drifted, e.g. `project-setup` still carried `~/Documents/Projects`
paths); `.claude/hooks/link-skills.sh` is gone. Project skills (`catalog-images`, `daily-report`,
`supabase`, `ui-rules`) stay here, versioned — their only home. Global skills are invoked as
`/globals:<name>`; after pushing the skills repo: `claude plugin marketplace update rafael-skills && claude plugin update globals@rafael-skills`.

Everything below this line is the 2026-08-11 state, kept as history.

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

| From                                                                                  | Skills                                                                                                                                                                 |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| _(de proyecto — nativas de este repo desde 29 ago 2026; ya no existen en el central)_ | `catalog-images`, `daily-report`, `supabase`, `ui-rules`                                                                                                               |
| `global-skills/`                                                                      | `commit-craft`, `compact-backlog`, `fabrica-de-skills`, `image-cors-cache-bust`, `layout-lab` (28 ago 2026), `prod-data`, `project-setup`, `report-gen`, `web-scraper` |
| `external-skills/`                                                                    | `supabase-postgres-best-practices`                                                                                                                                     |

### The trade-off, stated

A **global** skill has two homes: the central `skills` repo and a copy here. The four
**project** skills have one home only — this repo — since 29 Aug 2026, when `project-skills/`
was retired from the central repo (a project skill changes with the code, so it versions with it). They can
drift. The fix when a global skill is improved centrally is to copy it in again — there
is no automation for that, on purpose, because automation is what broke last time.

Worth pruning at some point: `.claude/hooks/link-skills.sh` carries a curated list of
six skills with the note that _every skill description costs context in every session_.
The vendored set is fourteen: thirteen inherited from whatever had been symlinked locally
over time, plus `layout-lab` (28 Aug 2026). Global copies were last re-synced from the central
repo on 28 Aug 2026 (`project-setup`, `report-gen`: path fixes; `ui-rules`, `daily-report`: the
27 Aug edits made here were ported back to central). If a skill here is not being used, delete it.

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
