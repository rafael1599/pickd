# Lessons & preferences (the skill's memory)

Append a short, dated entry after every report: what the user liked, what they
changed, words Roman responds to, recurring wins to watch. Read this at Step 0 so
you don't re-ask settled questions. Keep it tight; remove contradictions.

---

## Standing rules — every warehouse report (Rafael, 2026-08-27)

Shared by the daily update, What's new and the weekly; the `warehouse-report-writer` agent
reads this file before writing anything. Written as _wrong → right_.

- **Every improvement carries its pain story** — where, who, what it cost, what goes wrong
  downstream — then the change. "necesitamos hacer historias de dolor para cada mejora".
  An invented story is allowed only marked `<!-- pain story: invented, to confirm -->` in the
  source **and** listed in the chat for him to confirm. Never invent a process or a number.
- **Dates from the data, not from memory.** "Yesterday order 881303…" → it happened _today_
  (the group was created 2026-08-27 18:29Z). Read `created_at` / git before writing a day.
- **Ship is about four numbers.** Pallets, bikes, parts, weight are what the station copies into
  **Audit Source** or **FedEx**; that is the pain when they are wrong (calculator, by hand).
  Never a Ship story about a location: "a location looked wrong" → never happened. The SKU tap
  exists because "to know a SKU's stock, dimensions, weight or any detail you had to leave Ship;
  now one click".
- **Carrier row shows only what the order can use**, and as many as fit on **one line** — not a
  fixed top 3 (his first ask), not a top 4 (his second): "dinámico… en una sola línea sin que se
  corte… responsive". FedEx alone on FedEx orders; never FedEx on a regular one; "…" for the rest.
  Lesson under the lesson: when he refines a UI rule twice in a row, the third form is the one
  he keeps — write the rule as the _principle_ (fit the screen), not the number.
- **Ship speaks in figures, not sentences** (27 Aug, on the e-bike carton): "el operario no quiere
  un texto largo, solo cosas puntuales — 1 cartón, 1 Hudson E1, 78.6 libras". Anything in Ship
  that tells the station what to type is a row of big figures like Pallets / Bikes / Parts /
  Weight, never a paragraph; and the report describes it the same way.
- **What is declared apart is not on the pallet** (27 Aug): with the e-bike row added, the four
  numbers still counted the Hudson E2 — "estamos inflando los números, tanto en cantidad de bikes
  como en peso". A separate carton leaves Bikes and Weight; never describe or build totals that
  count a thing twice. My default for the PRD's Q2 was wrong; when a rule is about numbers the
  station copies, check it against a real order before defaulting.
- **Small things get half a line**, not a Before / Now box: "el 5 de verified solo menciónalo en
  media línea".
- **"In the FedEx system"**, not "at the FedEx station".
- **Print glyphs:** "…" renders, "⋯" does not.
- **Say what was recorded.** After a correction, answer with the rule you wrote and where.

## Standing preferences (current)

- **Audience:** Roman (warehouse operations lead) and the floor team. Non-technical.
- **Author voice:** first-person singular for work done ("I fixed / I rebuilt");
  "we / on the floor" only for things _noticed_.
- **Language:** the user asked for an English version "so it's easier for Claude";
  Spanish also works. Ask which per report; default to the last one used.
- **Length:** likes it tight — pushed 4 pages down to "1½ or max 2". A clean 1-page
  brief or a ~2-page visual version are both welcome. "Solo la carnecita."
- **Visuals:** likes figures for impact (before/after mockups + the scoreboard).
  Real screenshots weren't available in-session (app needs prod auth/data); vector
  mockups in the app palette were accepted. Offer to embed real PNGs if provided.
- **Format:** Markdown draft first for sign-off, then the branded PDF.

## Terminology Roman/the user uses

- It's a **SKU** (e.g. `06-4457BK`), not a "code". Barcode is fine.
- **AS400**, **Bay 2**, **pallet**, **label**, **Register Container**, **Double-Check**.
- The AS400 sync is done by **someone else**; we just hand them the report. Don't
  re-explain this in the report.

## Recurring wins worth watching each week

- Order/customer data integrity (the "customer changed by itself" class of bug).
- Capture speed & reliability (search, 2-digit prefill, AS400 prefetch, Bay 2 daemon).
- Order completeness + SKU resolution (parts parsing, Sub-Total check, SKU translation).
- Labels (parts, color, barcode, QR, WYSIWYG editor).
- The AS400 sync report (movement / total / other locations).
- Verification board (pallet counts, red notes, FedEx/Truck, PDF upload).

---

## Log

### 2026-06-19 — first build of this skill (two-week report)

- Built three versions the user reacted to: full narrative → 1-page compact brief →
  2-page **visual** version with figures + a Before→After scoreboard. The visual
  one is the current favorite for "impact".
- Corrections that landed (now baked into voice-and-style.md): customer bug was the
  _name only_ (→ wrong/blank labels); chase-and-close framing; AS400 sync is
  someone else's job; can't change SKU color suffix without losing history (→ why
  PickD translates SKUs); first-person-singular for work; "SKU" not "code"; don't
  paste raw context as copy; don't inflate time-cost claims.
- Technical gotchas hit & fixed (now in pdf-pipeline.md): draw `→ ✓ 🔎` as SVG;
  no registered italic; double-quote strings containing apostrophes.
- The seven wins covered this round: customer integrity · instant search/2-tap
  capture · Bay 2 daemon fix (Thu 18) · order completeness + SKU translation ·
  labels · AS400 report redesign · verification board clarity.

### 2026-08-27 — What's new (Rafael reviewing)

- First What's new with a pain story per item. Three rounds of corrections in one sitting —
  the reason the `warehouse-report-writer` agent and the standing rules above exist.
- Corrected: "yesterday" → today (read the DB); Ship stories reframed around the four numbers
  → Audit Source / FedEx; the SKU-tap story (never about locations); Verified → half a line;
  "at the station" → "in the FedEx system"; carrier row per order type (new rule he asked for
  and got built the same day).
- Real stories that landed: 881303 into 881301 (calculator, one pallet); 881288 Riptides
  under the other name (24 "Replaced" notes since June); names ending in "| auto-restore on
  cancel" heading for the FedEx file.
- Still invented, awaiting his word: combined order reopened from Shipped; pallet photo tiles;
  Recipient ID (address book duplicates); Ship-to on the watcher card; Maintenance backfill.

### 2026-08-27 — Audit Source defined (Rafael)

- "Audit Source es el sistema donde se hace la cotización, y luego se elige un carrier y se
  genera un número de seguimiento para una orden." Regular orders only. It asks for: store /
  customer, ship-to street number and name, zip, pallet count, total weight. E-bikes must be
  declared, as a carton outside the pallet even when they ride inside it. → written into
  `docs/warehouse-user-flows.md`, Flow 3. Say "pallets and total weight go to Audit Source",
  not "the four numbers".
