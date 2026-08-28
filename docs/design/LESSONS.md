# Design lessons — Rafael's corrections as rules

The `pickd-product-designer` agent reads this before every study and appends to it after every
correction. Written as _wrong → right_, dated, quoting him when the quote is the rule. One rule,
one place: a rule that contradicts an older one replaces it.

---

## Standing rules (2026-08-28, from the Ship card, the alerts pill, the map)

- **Study before code.** "Has un estudio antes de implementar." A PRD with numbered
  requirements, verification cases with exact numbers, phases, and every open question as ❓
  with a default answer — he closes them with "ok todo". Prose proposals ("dame propuestas") cost
  three rounds of corrections; the study costs one "ok".
- **Minimal, intuitive.** "Quiero minimalism, intuitivo." One gesture, one switch, one button.
  Select a thing, then select where it goes — that is the whole interaction he liked in the old
  map and the reason it was worth replacing.
- **Figures, not sentences.** "El operario no quiere un texto largo, solo cosas puntuales — 1
  cartón, 1 Hudson E1, 78.6 libras." Big number, short label; a missing value is `?`.
- **No redundancy.** "Solo me estás recomendando redundancia" — a strip that repeats what a
  button already does is a mistake, not a convenience. Reuse the existing modal, list, mutation.
- **No scaffolding by default.** "No quiero marking ni padding ni espaciado de ningún tipo por
  defecto." When he arranges a screen he wants free drag and grouping, and nothing else drawn.
- **The rule is the principle, not the number.** Carrier row: "top 3" → "top 4" → "as many as
  fit on one line". When he refines a rule twice, the third form is the one that stays; write it
  as the principle (fit the screen) so it does not have to be refined again.
- **Check on the phone.** "Revisa en el teléfono apaisado (~430 px)": what breaks there is the
  next correction. Captures at 430 and 1400 before asking for the next ok.
- **Honest beats tidy.** The map lists what it cannot place ("NOT ON THIS PLAN") instead of
  hiding it or forcing it in — "divídelo de modo que tenga un poco de sentido, en el piso ya los
  iremos actualizando": a reasonable rule, audited, is accepted; a silent one is not.
- **Separate real from planned.** "Quiero herramientas de edición live separadas de herramientas
  de edición plan." Two modes, visibly different, never one tool with a hidden switch.
- **Bugs before quick wins; the request before its interpretation.** Build what was asked; put
  what might come next in a later phase, written down.
- **A view is a link.** Zone, toggles, mode in the URL; per-device conveniences in
  `localStorage`; anything shared in the database. The old zone page kept plans in one
  browser's `localStorage` — that is why nobody else could see them.
- **Words.** English on screen; "hall", never "aisle"; "the FedEx system", "Audit Source"; the
  DB's names for things (`ROW 33 · A`). Spanish with him.

## Log

- **2026-08-28 — warehouse map, editing tools.** First study written under this agent:
  `docs/prds/warehouse-map-plan-and-live.md`. Rafael: "ok todo" to all six defaults; P1 (PLAN)
  built the same day. Lesson kept: **a control for a mode that is not built yet is a dead button** —
  the study drew VIEW | PLAN | LIVE, P1 shows VIEW | PLAN and LIVE appears with P2.
