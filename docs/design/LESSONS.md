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
- **Separate real from planned — and PLAN must show the plan.** "Quiero herramientas de edición
  live separadas de herramientas de edición plan." Two modes, visibly different, never one tool
  with a hidden switch. And in PLAN every number is the planned one: "sigo viendo 209 en 3982bl"
  — a square that gives 179 units away has to read 30, or the plan is invisible and its alarms
  are lies.
- **Bugs before quick wins; the request before its interpretation.** Build what was asked; put
  what might come next in a later phase, written down.
- **A view is a link.** Zone, toggles, mode in the URL; per-device conveniences in
  `localStorage`; anything shared in the database. The old zone page kept plans in one
  browser's `localStorage` — that is why nobody else could see them.
- **Words.** English on screen; "hall", never "aisle"; "the FedEx system", "Audit Source"; the
  DB's names for things (`ROW 33 · A`). Spanish with him.

- **The floor reads stock, not inches** (28 Aug, first look at the map with stock): "no quiero ver
  medidas en modo view". Measures — sliders, halls, inches on hover, hall widths — live in a
  **LAYOUT** mode; VIEW / PLAN / LIVE show stock only. "No tiene sentido el hover en los pasillos":
  a hall is not a thing you tap.
- **One header figure and one bar.** "De todos los datos en el encabezado solo quiero ver cantidad
  de pallets… una barra de capacidad donde se ven total bikes y en stock": PALLETS in use / squares,
  and a bar of units in stock against the bikes the layout holds. The four plan counters are LAYOUT.
- **A square is one pallet: 30 the norm, 45 the hard cap.** "En cada cuadro entra un pallet double
  stacked de 30 unidades nomás, reparte" — DISTRIBUTE spreads at 30, own row first, "los que no
  caben… en el espacio disponible buried". Refined 31 Aug: "no puede haber un cuadro con 46 o más"
  — between 31 and 45 a square is heavy but legal; over 45 it alarms and PLAN spreads its lines
  automatically as ghosts ("quiero que se redistribuya automáticamente"), executed only by PLAN
  COMPLETED. The user can always set quantities by hand.
- **Two taps and a confirmation.** "Hacer click en un SKU para moverlo a otro sitio solo haciendo
  otro click y aceptando la confirmación. INTUITIVO." Tapping a square with one line picks it up —
  no chip step; the chips appear only when a square holds several SKUs.
- **The pallet is a fact, not a control** (28 Aug, evening): "no quiero que estén expuestos los
  cambiadores de tamaño de una pallet". 60 × 62 is what the floor has; a slider for it invites
  play, not work. What changes on the floor is rows, halls and posts — those stay in LAYOUT. The
  engine keeps `pd`/`pw` for the space planner's links; no screen shows them.
- **A draft is a draft** (28 Aug): "yo no confirmé nada, solo estaba probando, borrador no quiere
  decir nada". Ghosts in PLAN are not a decision; only PLAN COMPLETED is. Replace a draft without
  ceremony when he asks for another one.
- **A settled question loses its switch** (31 Aug): "son muchas opciones… ya no lo necesitamos,
  debe estar escondido para cuando lo necesitemos pero que se recupere en código". Once he answers
  a configuration question (pallet 60×62, N–S rows, west hall gone), the answer becomes the default
  and the control leaves the interface — recovery is a URL param or code, never a button. The
  pallet sliders went first; the orientation, hall and preset switches followed.
- **The resting state needs no button** (31 Aug): "compactar a 2 solamente". VIEW is just the zone;
  PLAN and LIVE are the only two buttons, and tapping the active one puts the tools away.
- **Overflow goes to the south main hall, in front of its block** (31 Aug): "no pueden haber
  cantidades en un cuadro de más de 30 unidades, lo que sobre se pone en el main hall sur, delante
  de su bloque correspondiente." Never a second SKU squeezed into an occupied square to make the
  numbers close — the floor in front of the block is the overflow's place, and the plan says so.

## Log

- **2026-08-28 — warehouse map, editing tools.** First study written under this agent:
  `docs/prds/warehouse-map-plan-and-live.md`. Rafael: "ok todo" to all six defaults; P1 (PLAN)
  built the same day. Lesson kept: **a control for a mode that is not built yet is a dead button** —
  the study drew VIEW | PLAN | LIVE, P1 shows VIEW | PLAN and LIVE appears with P2.
- **2026-08-28 — first corrections on P1** (five in one message): measures out of VIEW into a
  LAYOUT mode; header = pallets in use + capacity bar; no hover on halls; 30 a square with
  DISTRIBUTE; one-tap pick and LIVE with confirmation. All four became standing rules above.
- **2026-08-28 — block DISTRIBUTE and the pallet sliders.** Running DISTRIBUTE on ROW 30–33 alone
  showed the engine skipped lines with no square and left units homeless with fast squares free;
  fixed. Then "K es válido momentáneamente… solo para la documentación, no en la UI" and "no quiero
  que estén expuestos los cambiadores de tamaño de una pallet" — both rules above; the sliders
  left LAYOUT the same evening.
- **2026-08-31 — mode bar compacted to two.** "No me gusta que tenemos view, plan, live y layout.
  Son muchas opciones… compactar a 2 solamente." PLAN | LIVE are the buttons; VIEW is the rest
  state; LAYOUT and the orientation / WEST HALL / preset switches live only in the URL
  (`?mode=layout`, `rows=ew`, `west=1`, `preset=…`), with N–S rows and west hall off as defaults.
  Two rules above.
- **2026-08-31 — the K becomes the block's 11th square.** "Agrega la K, el cuadro 11, para que
  quepa todo lo que está legítimamente en ese bloque, en el mismo… la K se va a pasar un poco
  sobre el hall + rack del norte." Rows 30–33 draw K past J, 60" into the north strip
  (`extraSlotRows`); the `11-K` label sits only beside the rows that have it, and DISTRIBUTE
  deals it. The 28-Aug rule ("not drawn, not distributed") stays for a K anywhere else.
- **2026-08-31 — overflow to the hall, and the SKU lights up everywhere.** The 9u tail that had
  been squeezed into 33-K beside another SKU became the rule above: overflow → MAIN HALL, in front
  of its block (DISTRIBUTE now plans it there instead of listing leftovers). Same session:
  hovering or tapping a square lights every square holding that SKU, live or planned — "no solo
  el cuadro seleccionado".
- **2026-08-31 — the hand holds a square, not a line.** "Cuando intento mover por segunda vez el
  mismo sku… se vuelve a mover el que estaba en b, no el que yo quiero mover; falta un id temporal
  para que se sepa cuál clickeo y ese sea el cuadro que se deja libre." Picking a square takes that
  square's pallet (its share), a ghost re-pick carries its own move id, and a plan never collapses
  a line's moves into one — the id already existed (the move row); the bug was matching by
  inventory id. Same message: the SKU highlight must glow the background ("fosforescente"), not
  just the stroke — matching squares brighten, the rest dim while the light is on.
- **2026-08-31 — the K reaches ROW 18, and 45 becomes the cap.** "Extiende la K hasta la row 18,
  no quiero que ningún cuadro tenga más de 45 bikes… el pallet sigue en 30; que se redistribuya
  automáticamente." Every Bay 3 North row draws the 11th square; `SQUARE_MAX` (45) is the alarm
  and the auto-spread trigger, `PALLET_UNITS` (30) stays the working number. The rule above was
  refined in place.
- **2026-08-31 — a square is what it will hold.** "Sigo viendo 209 en 3982bl y otros números
  grandes más." PLAN painted live stock and drew ghosts only on empty squares, so an origin that
  had given units away still showed its old number, still alarmed over the cap, and the automatic
  spread kept seeing offenders that were already fixed. `plannedState` now subtracts what each
  move takes from each square (`remainingAt`, `unitsAt`); the drawing, the counters and the
  auto-spread all read that.
- **2026-08-31 — the cap applies to the landing too.** "Todavía tengo algunos con 69 y 90
  unidades." The squares still over 45 were the plan's own: a hand drop carries the square's whole
  pallet, so dropping 240 units planned 240 into one square. `repairOverCap` re-plans any landing
  over the cap across the squares it needs — the row it was dropped on first, then the nearest
  rows, then the MAIN HALL. A rule about squares has to hold wherever the units come from.
