# Voice & style — writing for Roman

Roman runs warehouse operations. He is sharp but **not technical**, and he works
the floor. The report should feel like it was written by a teammate who did the
work and also works alongside him — proud, plain-spoken, and useful.

Read this in full before drafting copy. These rules were learned the hard way over
many revisions; honor them.

## The core voice

- **First-person singular for the work.** The user did this work and wants to own
  it: "**I** tracked it down", "**I** rebuilt the editor", "**I** made PickD smart".
  Verbs of doing are always "I" — not "we", not passive. (Past mistake: "we
  chased it down" reads like a team; the user wants to present himself as the one
  who did it.)
- **"We / on the floor" only for noticing.** Shared observation is inclusive:
  "something we'd been noticing on the floor", "we kept losing time on this". The
  _noticing_ is collective; the _fixing_ is "I". This is the one place "we" belongs.
- **Lead with the operator's reality, not the system.** Start from what Roman saw
  or felt ("orders where the customer name changed by itself"), then the cause,
  then the fix. Never start from the code.
- **Always give the "why".** Every win explains the pain it removed and why that
  mattered on the floor. A change with no operator "why" doesn't belong in the report.
- **Before → After.** The strongest frame. Most wins compress to a crisp contrast
  (blank screen → app working; 6 digits + wait → 2 taps; 7 of 13 → 13 of 13).
- **"What you gain."** Close each win with the concrete payoff in Roman's terms
  (confidence, seconds per order, fewer manual entries). Keep it short.

## Language rules

- **No tech jargon.** No PR numbers, function names, "RPC", "optimistic update",
  "race condition", "schema". Say what it _does_. ("The system was saving another
  order's customer behind the scenes" — not "a stale write / race on the customer
  field".)
- **Use warehouse words.** It's a **SKU** (e.g. `06-4457BK`), never a "code"
  (except a literal **barcode**). It's a **label**, a **pallet**, an **order**,
  the **AS400**, **Bay 2**. Call screens/buttons what the team calls them.
- **Honesty over hype.** Don't invent metrics or exaggerate severity. If a problem
  was recurrent-but-small, say "we'd lost time on this repeatedly", not "it cost us
  an hour every morning". Removing a false claim is always right.
- **Plain dramatic, not corporate.** Short sentences. A little story is good ("the
  Thursday it almost broke") when it's true and Roman would care. Keep adjectives earned.
- **Spanish vs English.** The user may want either. In Spanish, keep the same
  first-person/observational split and the warm floor tone. Default to whatever the
  last report used (see LESSONS.md).

## Structure of one win

```
NN · Short headline (operator-facing, no jargon)
  2–4 sentences: what was wrong on the floor → the real cause → what I did.
  **Bold** only the few phrases that carry the point.
  What you gain: the payoff in Roman's terms.
  + a Before/After figure.
```

## Hard-won corrections (do NOT repeat these)

- The customer bug was **only the customer NAME** changing/going blank — not the
  whole order — and it led to **printing labels with the wrong (or no) customer**.
  Frame it that way. The real cause was the system saving another order's customer
  behind the scenes; present it as a mystery the user _chased down and closed_.
- The AS400 sync itself is **done by someone else**; we only **hand them the
  report**. Roman knows this — don't explain it. Just say the report now shows
  exactly what's needed: movement (from→to), the total, other movements of that SKU,
  and below, which other locations hold it. Be concise; don't over-explain.
- You **can't change a SKU's color suffix in the AS400** without losing its
  history — that's _why_ PickD now translates the SKU itself (`06-4457BL` →
  `06-4457BK`). This is a flagship win; show the translate-vs-stock flow.
- Don't paste raw problem-history the user gave you as _context_. Context informs
  the framing; it is not copy.
- Items the user personally lived (e.g. fixing Bay 2 on a bad day) can be told from
  "I" even if Roman didn't witness them — that's the point, to surface the work.

## Two formats, by length

- **~1 page:** two-column brief, every win = headline + 2–3 lines + "What you gain",
  plus the Before→After scoreboard. Tightest "just the meat" version.
- **~2 pages:** one win per row with a **figure** beside it, plus the scoreboard
  band. Use when the user wants visuals / more impact.

Both use the same PickD visual language (see pdf-pipeline.md).
