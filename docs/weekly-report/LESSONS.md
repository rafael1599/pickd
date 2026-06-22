# Lessons & preferences (the skill's memory)

Append a short, dated entry after every report: what the user liked, what they
changed, words Roman responds to, recurring wins to watch. Read this at Step 0 so
you don't re-ask settled questions. Keep it tight; remove contradictions.

---

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
