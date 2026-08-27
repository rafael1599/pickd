# Warehouse Floor Plans — Architecture Decision

> **Status:** Adopted 2026-08-11
> **Lives in:** `public/warehouse/` — opens at `/warehouse/index.html`
> **Source of truth for every figure:** `public/warehouse/WAREHOUSE-MEASUREMENTS.md`
> **NOT the same thing as:** `src/features/warehouse-management/`

A set of standalone HTML pages that model the real building to scale: where the walls
are, how much floor is free, and how many pallets fit in each zone. They exist to plan
the physical warehouse, not to run it.

## Why they are plain HTML and not React

They are deliberately outside the app. No imports, no build step, no routing, no
dependency on anything in `src/`. Vite copies `public/` verbatim, so the pages open at
`/warehouse/index.html` in production and straight off the filesystem in a browser
with no server at all.

That last part is the point. These get opened on a phone on the warehouse floor, sent
to someone who does not run the app, and edited by hand mid-conversation while the
tape measure is still out. A React route would have made all three harder and bought
nothing: there is no app state here, no auth, no data — just geometry.

The trade-off is real and accepted: the numbers in these pages do not come from the
database and nothing keeps them in sync with it. They are a plan, not a live view.

## The pages

| Page                       | What it is                                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.html`               | Entry point. Totals and links to the rest                                                                                                             |
| `warehouse_blueprint.html` | **The source of truth for the geometry.** Every coordinate derives from one `M` table; the page recomputes free-space totals and cross-checks on load |
| `warehouse_map.html`       | The three bays to scale, free space per zone, click through to a layout                                                                               |
| `zone.html?id=…`           | **Every pallet layout.** One page, six zones, driven by `zones.js` + `PalletEngine.js`                                                                |
| `bay3_combined.html`       | Both halves of Bay 3 in one picture. A hand-drawn schematic — see below                                                                               |

`zone.html` renders `bay3_north`, `bay3_se`, `bay2_north`, `bay2_south`, `bay1_north`
and `bay1_office_gap`. There is no per-bay page any more: three of them
(`bay2_pallet_layout.html`, `bay3_layout_ew.html`, `warehouse_app.html`) were deleted
on 21 Aug 2026 once the generic page covered what they did, and their orientation
variants became the `N–S` / `E–W` toggle. Forks were the actual failure mode here —
each one froze the pallet size it was born with, so the east-west comparison was being
made against a 56" × 54" pallet nine days after the real one was measured.

To correct the plan, correct the `M` table in `warehouse_blueprint.html` and the
matching zone in `zones.js`. No coordinate is written by hand.

**`bay3_combined.html` is the exception, and is labelled as one on the index.** Its
bands are hand-picked pixel heights at three different scales (97.5" → 55 px, 120" →
90 px, 48" → 45 px) and its totals are string literals, not engine output — they read
5,280 / 5,880 bikes where the zone pages compute 5,010 / 5,580. It survives because it
answers a question no other page does: what the west rack costs, both halves at once,
in one image you can show somebody. Redrawing it off `PalletEngine` would settle that,
and is the obvious next piece of work here.

## The cross-checks are the feature

The blueprint recomputes ten checks on every load and prints them under the drawing:
sums of measurements that ought to agree, with the difference and a pass/fail against
a one-foot tolerance. A wrong measurement surfaces as a failing check instead of a
drawing that looks fine and is quietly wrong.

This has already paid for itself twice. On 11 Aug 2026 Bay 3 was re-measured on site
and two figures moved: the storage depth is 9.5" deeper than had been derived, and the
south-east gap is 4' 2" narrower than the old measurement. Net effect, 133 sq ft less
free space than we thought.

One warning prints in place of a check: the Bay 3 office block width is not measured.
It is the bay width minus the measured east gap, which means it cannot disagree with
anything and no check will ever catch it if it is wrong. Section 4 of the measurements
document says so out loud, along with the single short measurement that would settle
it.

## Current state of Bay 3 North

138 pallets, 10 deep, in 4 blocks of 14 rows, 78" halls; 4,140 bikes at 30 per pallet;
90 of the 138 touch open floor. Reclaiming the 13 ft strip along the west wall adds a
fifth block and narrows every hall to 67": 157 pallets, 16 rows, 4,710 bikes, 109 of
them fast. That is the WEST HALL toggle in the page.

The grid is 140 and 160; the difference is the four structural posts measured on
12 Aug 2026. All four sit on one line 23 ft north of the main hall, which puts every
one of them mid-slot in row E — too far from any slot edge for a re-cut of the grid to
help. Two land in pallet slots today, three once the west strip is reclaimed. The page
marks a dead slot with a red ✕ and a post that lands in a hall with a red dot, and
prints what it assumes about them: 8" square, centre-to-centre, neither measured.

Rows run north-south. The east-west variant holds more, because halls are what eat
the floor, but it buries the middle rows of a deep block, which changes how the
warehouse is operated rather than just where pallets go. It is parked as a long-term
improvement — but it is now the `E–W ROWS` toggle on the same page, so the comparison
is always against current measurements instead of a frozen fork.

Bay 3 South/East is next. Both chains are now measured — 628" wide, 421" of usable
depth once the south-wall rack and its hall come off. What is still open is whether
the north-south halls and racks run the full depth, and where the fifth post goes.

## Relationship to `src/features/warehouse-management/`

Different things, and they should stay that way unless someone decides otherwise:

- **`warehouse-management`** is the in-app view. It reads live locations from the
  database, knows about SKUs and zones, and is what people use day to day.
- **`public/warehouse/`** is the plan. It knows about walls and inches and nothing
  else, and it is edited when someone walks the floor with a tape measure.

If they are ever to be joined, the natural shape is a third tab in `WarehouseMapScreen`
alongside _plan_ and _live_, pointing at `/warehouse/index.html`. Nothing has been
built toward that.

## Agents

Two agent definitions ship with this, in `.claude/agents/`:

- **`warehouse-space-planner`** — lays pallets out inside a free zone. Carries the
  layout rules (flush rows, hall minimums, leftover to the front, 30 bikes per
  pallet) and the conventions for adding a zone to `zones.js`.
- **`warehouse-sku-placement`** — decides what goes in each slot. Still a draft: its
  open questions are written down rather than guessed at, and it says so when invoked.
