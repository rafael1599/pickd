# Warehouse Floor Plans — where the measured building lives, and how it got here

> **Status:** Rewritten 2026-08-28 (idea-170). The plans are the app's map now.
> **Lives in:** `src/features/warehouse-map/` — opens at `/warehouse-map` (menu → Map) and, with
> no session, at `/public-warehouse-map`
> **Source of truth for every figure:** `docs/warehouse-measurements.md`
> **The rules every screen of it obeys:** `docs/warehouse-ui-rules.md`
> **The decision, with its ❓ and phases:** `docs/prds/warehouse-map-measured.md`

The map models the real building to scale: where the walls are, how much floor is free,
how many pallets fit in each zone — and, since 28 Aug 2026, what the database says is in
each of those slots. It exists to plan the physical warehouse **and** to run it: the two
were separate things until that day.

## What is where

| Piece                                                                 | File                                                        |
| --------------------------------------------------------------------- | ----------------------------------------------------------- |
| The building: `M` table, geometry, bays, free zones, ten cross-checks | `engine/blueprint.ts` (+ `blueprint.test.ts`)               |
| The six zones, in inches, each figure commented with its measurement  | `engine/zones.ts`                                           |
| The layout engine: rows, blocks, halls, slots, posts                  | `engine/palletEngine.ts` (+ `palletEngine.test.ts`)         |
| The stock laid over the slots (`ROW n · letter`)                      | `stock/rowStock.ts` (+ tests), `hooks/useWarehouseStock.ts` |
| The screens: master map, zone view, the drawing                       | `components/MasterMap.tsx`, `ZoneView.tsx`, `ZoneSvg.tsx`   |
| The state in the URL (`?zone=bay3_north&west=0&pd=65`)                | `hooks/useZoneState.ts`                                     |

To correct the plan, correct `M` in `blueprint.ts` and the matching zone in `zones.ts`.
No coordinate is written by hand, and a wrong one fails a test.

## The cross-checks are the feature

The blueprint carries ten checks: sums of measurements that ought to agree, with a
one-foot tolerance. They used to print under a drawing; now they are tests, so a wrong
measurement fails the build instead of drawing a building that looks fine and is
quietly wrong.

This paid for itself twice before it was code. On 11 Aug 2026 Bay 3 was re-measured on
site and two figures moved: the storage depth is 9.5" deeper than had been derived, and
the south-east gap is 4' 2" narrower than the old measurement. Net effect, 133 sq ft
less free space than we thought.

One warning stands in place of a check: the Bay 3 office block width is not measured.
It is the bay width minus the measured east gap, so it cannot disagree with anything and
no check will ever catch it if it is wrong. Section 4 of the measurements says so out
loud, along with the single short measurement that would settle it.

**Bay 1 is a plan, not the floor.** Rafael, 28 Aug 2026: the usable space the map draws
for Bay 1 "is not the real one". Until he measures it, Bay 1 North and the office gap are
blueprint geometry: their counts are not quoted and their stock letters were not
relabelled with the rest.

## Bay 3 North, the zone being worked

138 pallets, 10 deep, in 4 blocks of 14 rows, 78" halls; 4,140 bikes at 30 per pallet;
90 of the 138 touch open floor. Reclaiming the 13 ft strip along the west wall adds a
fifth block and narrows every hall to 67": 157 pallets, 16 rows, 4,710 bikes, 109 of
them fast. That is the WEST HALL toggle on the zone.

The grid is 140 and 160; the difference is the four structural posts measured on
12 Aug 2026. All four sit on one line 23 ft north of the main hall, which puts every one
of them mid-slot in row E — too far from any slot edge for a re-cut of the grid to help.
Two land in pallet slots today, three once the west strip is reclaimed. A dead slot is a
red ✕; a post that lands in a hall is a red dot.

Rows run north–south. The east–west variant would hold more, because halls are what eat
the floor, but it buries the middle rows of a deep block — and, under this zone's rule of
two four-row blocks, the engine finds no east–west layout at all (the posts land mid-hall
with no 54" clear either side). The `E–W ROWS` toggle shows that honestly.

Bay 3 South/East: both chains measured — 628" wide, 421" of usable depth once the
south-wall rack and its hall come off. Still open: whether the north–south halls and racks
run the full depth, and where the fifth post goes.

## History

- **11 Aug 2026** — the plans are born as standalone HTML in `public/warehouse/`: no
  build, no auth, opened on a phone on the floor and edited mid-conversation with the tape
  measure out. Deliberately separate from the in-app `warehouse-management` map, which
  drew rows as a table of letters and knew nothing about walls.
- **19–21 Aug** — one generic zone page replaces six forks (each fork had frozen the
  pallet size it was born with); the word is _hall_, in data and code, never _aisle_; a
  SLOTTING VIEW fills Bay 3 with real SKUs by velocity, but against a local database only.
- **28 Aug** — Rafael: "the in-app map will be replaced entirely by the map with the
  measurements". The engine, zones and blueprint are ported to TypeScript with their
  numbers as tests (54 cases identical cell by cell to the JS); the screens follow; the
  stock is laid over the slots; Plan/Live and `public/warehouse/` are retired. Bay 3 North
  and Bay 2 sublocations move to one letter per square (`sublocation_relabels` keeps the
  old and the new).
- **Next** — F5, the proposal layer: the slotting view back in the app, with
  `get_bay3_fill_candidates` as a migration instead of a URL to `127.0.0.1`.

The hand-drawn `bay3_combined.html` schematic died with the pages. What it answered —
what the west rack costs, both halves at once — the master map answers with RACK MOVE
and the zone with its WEST HALL toggle, off the same measurements.

## Agents

- **`warehouse-space-planner`** — lays pallets out inside a free zone. Carries the layout
  rules (flush rows, hall minimums, leftover to the front, 30 bikes per pallet) and the
  conventions for adding a zone to `zones.ts`.
- **`warehouse-sku-placement`** — decides what goes in each slot. Still a draft: its open
  questions are written down rather than guessed at, and it says so when invoked.
