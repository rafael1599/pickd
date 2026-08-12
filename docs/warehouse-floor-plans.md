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
| `warehouse_app.html`       | Console view — overview plus Bay 2 and Bay 3 in tabs                                                                                                  |
| `bay3_pallet_layout.html`  | Bay 3 North pallet layout. The one in progress                                                                                                        |
| `bay3_layout_ew.html`      | Bay 3 North with east-west rows. Parked, see below                                                                                                    |
| `bay2_pallet_layout.html`  | Bay 2 North, modelled before the real pallet size was known                                                                                           |

To correct the plan, correct the `M` table in `warehouse_blueprint.html` and the
matching constants in the layout pages. No coordinate is written by hand.

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

140 pallets, 10 deep, in 5 blocks of 14 rows; 4,200 bikes at 30 per pallet; 108 of the
140 touch open floor. Reclaiming the 13 ft strip along the west wall would take it to
150 pallets — that is the CURRENT / WEST FREED toggle in the page.

Rows run north-south. The east-west variant holds more, because aisles are what eat
the floor, but it buries the middle rows of a five-deep block, which changes how the
warehouse is operated rather than just where pallets go. It is parked as a long-term
improvement and its page is frozen on the old pallet size — re-run it before comparing
anything.

Bay 3 South/East is next. Its east-west chain is measured; the depth is not.

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
  layout rules (flush rows, aisle minimums, leftover to the front, 30 bikes per
  pallet) and the conventions for producing a new `bayN_pallet_layout.html`.
- **`warehouse-sku-placement`** — decides what goes in each slot. Still a draft: its
  open questions are written down rather than guessed at, and it says so when invoked.
