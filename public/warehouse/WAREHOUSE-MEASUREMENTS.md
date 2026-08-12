# Warehouse Measurements — JAMIS Bikes

Complete record of what was measured on site, what was derived from it, and the
assumptions taken as good in order to draw the plan.

- **Blueprint:** `warehouse_blueprint.html`
- **Scale:** 10 px = 1 ft
- **Every measurement is INTERIOR.** Not one was taken from outside the building.
- **Accepted tolerance:** 1' 0". Two measurements that ought to agree and differ by
  less than a foot are considered correct; beyond that, go back and re-measure.
- **Last updated:** 11 August 2026

The `M` table inside `warehouse_blueprint.html` is the source of truth for the
drawing. No coordinate in the plan is written by hand: they all derive from it.
To correct the plan, correct that table.

---

## 1. Anchor points

The whole drawing hangs off two references, picked for being the most reliable:

| Anchor         | Why                                                |
| -------------- | -------------------------------------------------- |
| **South wall** | Confirmed straight across all three bays, no steps |
| **West wall**  | The Cage touches it, confirmed                     |

The north walls are **not** usable as anchors: each bay has its own, at a different height.

---

## 2. East-west envelope

Measured bay by bay, plus the thickness of the dividing walls.

| Measurement           | Value       | What it measures exactly                       |
| --------------------- | ----------- | ---------------------------------------------- |
| Bay 1                 | 162' 4"     | West wall → end of Bay 1                       |
| Bay 1 / Bay 2 divider | 0' 8"       | Bay 1 ends at 162' 4", Bay 2 starts at 163' 0" |
| Bay 2                 | 84' 8"      | Clear width of Bay 2                           |
| Bay 2 / Bay 3 divider | 1' 0"       | Thickness                                      |
| Bay 3                 | 113' 10"    | Clear width of Bay 3                           |
| **Total length**      | **362' 0"** | Direct end-to-end measurement                  |

Sum of the pieces: 362' 6". Against the total: **6" of difference**, within tolerance.

---

## 3. North-south axis

### Bay 1 — chain off its north wall

All three measurements were taken from the same north wall, which makes them far more
reliable than adding up room by room.

| Measurement           | Value     | Up to where                                             |
| --------------------- | --------- | ------------------------------------------------------- |
| North wall → aisle    | 42' 3"    | **North** edge of the aisle                             |
| North wall → showroom | 52' 5"    | **South** edge of the aisle (where the showroom starts) |
| North wall → offices  | 67' 6"    | North wall of the Mrs Z / Sales / CAFYT block           |
| Aisle → offices (gap) | 14' 11.5" | Direct measurement of the gap                           |

> **The 52' 5" reach the showroom, not the north edge of the aisle.**
> This was misread for a good part of the process. See §7.

### Bay 1 — off the south wall

| Measurement      | Value  | What it measures                                 |
| ---------------- | ------ | ------------------------------------------------ |
| Shipping (depth) | 46' 0" | South wall → aisle                               |
| Showroom (depth) | 45' 4" | South wall → north wall of the showroom          |
| Cage (depth)     | 56' 0" | South wall → north edge of the aisle (46' + 10') |

### Bay 2

| Measurement                       | Value  | What it measures               |
| --------------------------------- | ------ | ------------------------------ |
| South wall → aisle                | 44' 3" | Width of the south band        |
| North wall → aisle                | 43' 9" | Width of the north band        |
| Restroom #1 + Credit Dept (depth) | 44' 3" | They fill the whole south band |

### Bay 3

| Measurement          | Value  | What it measures                             |
| -------------------- | ------ | -------------------------------------------- |
| Offices → north wall | 77' 0" | Includes the aisle (see §6)                  |
| Office block (depth) | 38' 7" | North face of the restrooms → south wall     |
| Kitchen recess       | 6' 1"  | The kitchen sits 6' 1" back from restroom #2 |

### Bay 3 North — chain off the north wall (11 Aug 2026)

Three direct measurements off the same wall, taken to close out the depth of the
storage zone, which until then was only derived from the 77' chain.

| Measurement                    | Value    | Up to where                               |
| ------------------------------ | -------- | ----------------------------------------- |
| North wall → start of the rows | 12' 2"   | Clearance against the north wall          |
| North wall → end of the rows   | 62' 1.5" | Where the blocks end and the aisle starts |
| North wall → south wall        | 116' 0"  | Total depth of Bay 3                      |

> The **12' 2" (146") clearance matches exactly** what the model already assumed. The
> storage depth does **not**: it was derived at 61' 4" and measures 62' 1.5",
> **9.5" more**. See §7. The 116' total against the 115' 7" derived comes to 5",
> within tolerance (§8).

### Bay 3 South/East — east-west chain (11 Aug 2026)

Measured east to west across the whole zone, from the east wall to the east face of
the office block. Total **52' 4" (628")**, of which only 33' 1" is open floor.

| Segment                                | Width                  | What it is                                             |
| -------------------------------------- | ---------------------- | ------------------------------------------------------ |
| East wall → end of the existing rack   | 4' 3" – 4' 5" (51–53") | Rack already in place. Draw it in red                  |
| N-S aisle                              | ≈ 6' 0" (71–73")       | Connects to the main aisle. Derived: 10' 4" − the rack |
| _(cumulative to the end of the aisle)_ | _10' 4" (124")_        | Measured                                               |
| **Usable open floor**                  | **33' 1" (397")**      | What has to be filled with pallets                     |
| N-S aisle, west end                    | 4' 0" (48")            | Runs north-south like the one opposite                 |
| Rack against the west end              | 4' 11" (59")           | Already in place, eats space                           |

Still to measure: the north-south depth of the zone, whether the two aisles and the
two racks run the full depth, and whether the existing racks stay and hold pallets
that should be counted.

### The aisle is not straight

The aisle has a **1' 2" step** at the Bay 1 / Bay 2 divider: in Bay 1 it runs further
north. Each stretch is anchored separately to the south wall (46' in Bay 1, 44' 3" in
Bay 2/3), and the resulting step works out to 1' 9" — 7" off the 1' 2" measured,
within tolerance.

With the 11 Aug 2026 measurements a **second step appears, of 4.5", at the Bay 2 /
Bay 3 divider**: the Bay 3 stretch hangs off its north-wall chain (rows end at
62' 1.5" and the aisle starts there), while the Bay 2 one is anchored to the 44' 3"
south band. That is under half an inch per foot of accepted tolerance — tape noise —
but the plan draws it as it is instead of hiding it.

Aisle width: **10' 0" constant** along its whole run, confirmed.

---

## 4. East-west widths inside each bay

### Bay 1, west to east

| Space                                | Width                     |
| ------------------------------------ | ------------------------- |
| Cage                                 | 20' 0"                    |
| Shipping Area                        | 41' 0"                    |
| Showroom                             | 38' 2.4" (given as 38.2') |
| Office block (Mrs Z + Sales + CAFYT) | 63' 10"                   |

Sum: 163' 0.5". Against the 162' 4" of Bay 1: **8.5" of difference**, within tolerance.

### Bay 2

| Space                     | Width               |
| ------------------------- | ------------------- |
| Restroom #1 + Credit Dept | 34' 5" (413 inches) |

It starts flush against the Bay 1 divider. To the east, 50' 3" remain free.

### Bay 3

| Space                       | Width  | Source                                                         |
| --------------------------- | ------ | -------------------------------------------------------------- |
| Office block                | 61' 6" | **Derived**, 11 Aug 2026 — see below                           |
| Kitchen (inside the block)  | 14' 0" | Measured (given as 13' 12")                                    |
| East gap (Bay 3 South/East) | 52' 4" | **Measured** 11 Aug 2026, east face of the offices → east wall |

61' 6" + 52' 4" = 113' 10" exactly, the measured width of the bay.

> **The office width is the one figure in this bay nobody measured.** It is whatever is
> left after the measured east gap, and it rests on the block touching the Bay 2/3
> divider (§5). Being a remainder, it cannot disagree with anything: no cross-check
> will ever catch it if it is wrong. What would catch it is one short measurement —
> **divider → west face of the offices**. If there is a gap there instead of a joint,
> the block is narrower by that much and those square feet are free floor, not office.
> Worst case it is 4' 8" × 38' 7" ≈ 180 sq ft drawn as office that is really free.

The old figures were office block 56' 10" and east gap 56' 6", which summed to 113' 4"
— 6" short of the bay — and the plan papered over it by drawing the east gap at 57' 0".
The 52' 4" measured on site is 4' 2" less than that old 56' 6"; see §7.

---

## 5. Assumptions taken as good

### Explicitly confirmed

- The aisle is 10' wide along its whole run
- The Cage touches the west wall
- The south wall is straight across all three bays, no steps

### Assumed, never contradicted

These were not confirmed one by one, but the drawing squares with them and no
measurement contradicts them:

- The Cage runs up from the south wall and **crosses the aisle**: its 56' = 46' of the
  south band + 10' of aisle, so its north face lines up with the north edge of the aisle
- The aisle **starts at the east face of the Cage** and reaches the outer east wall,
  crossing all three bays
- The Bay 3 office block **touches the divider** with Bay 2. This used to be verified
  indirectly (56' 10" + 56' 6" = 113' 4" against the bay's 113' 10", 6"). That
  verification collapsed on 11 Aug 2026: the east gap measures 52' 4", not 56' 6". The
  assumption now carries the office width on its own — see §4
- The kitchen sits at the **west end** of the Bay 3 block
- The 77' of Bay 3 are measured from the **north face of the restrooms**, which is the
  north face of the block (the kitchen is recessed and does not reach as far north)
- The 43' 9" of Bay 2 are measured to the **north edge** of the aisle
- The Showroom touches the south wall
- The Bay 3 office block reaches the south wall
- Every dividing wall has an opening where the aisle passes through

### Deliberately excluded

- **Structural columns and pillars.** An explicit decision, to keep the plan simple.
  Consequence: the free square footage is **gross area**. If there is a column grid,
  what is really rackable is less.

---

## 6. Derived values

Calculated, not measured.

| Value                             | Result                                           |
| --------------------------------- | ------------------------------------------------ |
| Bay 1 depth                       | 98' 5"                                           |
| Bay 2 depth                       | 98' 0"                                           |
| Bay 3 depth                       | 116' 0" — no longer derived, **measured** (§3)   |
| Bay 3 north overhang over Bay 1/2 | 17' 7"                                           |
| North walls Bay 1 vs Bay 2        | Aligned, 5" of difference                        |
| Bay 1 offices: width × depth      | 63' 1.5" × 31' 0.5"                              |
| Bay 3: east gap                   | 57' 0"                                           |
| Bay 3: aisle → kitchen            | 11' 4.5"                                         |
| Bay 3: aisle → restroom #2        | 5' 3.5"                                          |
| Bay 3: offices → north wall       | 77' 5" — derived from the measured 116'          |
| Bay 3: office block width         | 61' 6" — derived from the measured east gap (§4) |

> **The north-south split of Bay 3, with the 11 Aug 2026 measurements.** From the north
> wall: 12' 2" of clearance, rows up to 62' 1.5", 10' of aisle up to 72' 1.5",
> 5' 3.5" of pre-restroom band, and the offices out to 116'. The 77' measured back then
> up to the offices stay on as a cross-check: the chain puts them at 77' 5", 5" of
> difference (§8).

> The **11' 9"** figure from aisle to kitchen matched exactly a measurement that was
> given and then withdrawn for not squaring. With the corrected aisle position it did
> square. It was right from the start. (It now reads 11' 4.5" after the Bay 3 re-measure.)

---

## 7. Measurements corrected or replaced

Documented so they do not creep back in.

| Old figure                                               | Replaced by                 | Reason                                                                                                                                                              |
| -------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 52' 5" to the north edge of the aisle                    | 52' 5" to the **showroom**  | The three-measurement Bay 1 chain settled it. It moved the north wall 10 feet                                                                                       |
| Office gap 13' 6"                                        | **14' 11.5"**               | Direct measurement. The old one was off by 1' 7", out of tolerance                                                                                                  |
| Bay 2 = 70' (satellite)                                  | **84' 8"**                  | Never measured; it was an estimate off an aerial photo                                                                                                              |
| Bay 3 = 80' (satellite)                                  | **113' 10"**                | Same. The largest error of all: 33' 10"                                                                                                                             |
| Bay 2 = 84' 10"                                          | **84' 8"**                  | Corrected on re-measure                                                                                                                                             |
| Total length = 361' 10"                                  | **362' 0"**                 | User's re-measure                                                                                                                                                   |
| Bay 3 has 3 restrooms                                    | **Only 1 restroom**         | Corrected                                                                                                                                                           |
| The kitchen juts 6' 1" north                             | It is **recessed** 6' 1"    | Inverted reading. It leaves more free space, not less                                                                                                               |
| Widths Mrs Z 12' / Sales 14' / CAFYT 12'                 | Single block of **63' 10"** | They were filler estimates                                                                                                                                          |
| Restroom #1 + Credit depth = 46' (assumed)               | **44' 3"**                  | Measured                                                                                                                                                            |
| Bay 3 east gap 56' 6"                                    | **52' 4"**                  | Measured on site 11 Aug 2026 from the east face of the offices to the east wall. 4' 2" less. The old figure never squared: with it the bay's pieces summed 6" short |
| Bay 3 office block 56' 10"                               | **61' 6"**                  | No longer a figure of its own: it is the bay width minus the measured east gap. It grows 4' 8" and the pieces now sum exactly (§4)                                  |
| Bay 3 North, storage depth 61' 4" (derived from the 77') | **62' 1.5"**                | Measured directly off the north wall on 11 Aug 2026. That is 9.5" more depth: the zone reaches further south than calculated and the aisle starts 9.5" later        |

---

## 8. Cross-checks

Recalculated live in the plan. All pass.

| Check                                                | A         | B         | Δ       |
| ---------------------------------------------------- | --------- | --------- | ------- |
| Bays + dividers sum vs total length                  | 362' 6"   | 362' 0"   | 0' 6"   |
| Bay 1: rooms sum vs bay width                        | 163' 0.5" | 162' 4"   | 0' 8.5" |
| Bay 1: aisle width per the chain                     | 10' 2"    | 10' 0"    | 0' 2"   |
| Bay 1: depth via shipping vs via showroom            | 98' 5"    | 98' 5"    | 0' 0"   |
| Bay 1: office wall via gap vs via chain              | 67' 4.5"  | 67' 6"    | 0' 1.5" |
| North wall Bay 1 vs Bay 2 (alignment)                | 26' 7"    | 27' 0"    | 0' 5"   |
| Aisle step: derived vs measured                      | 1' 9"     | 1' 2"     | 0' 7"   |
| Bay 3: depth via offices (77' + 38' 7") vs measured  | 115' 7"   | 116' 0"   | 0' 5"   |
| Bay 3: north clearance assumed vs measured           | 12' 2"    | 12' 2"    | 0' 0"   |
| Aisle from the south: Bay 2 stretch vs Bay 3 stretch | 54' 3"    | 53' 10.5" | 0' 4.5" |

None exceeds 8.5", well under the foot of tolerance.

The east-gap check that used to sit here is gone: the office width is now derived from
that very gap, so the two can no longer disagree. The plan prints a warning in its
place instead of a green tick it has not earned.

---

## 9. Resulting free space

Recalculated with the 11 Aug 2026 geometry (§3). It comes out of the plan itself,
which sums the zones on its own; not one figure here is written by hand.

| Zone                    | Dimensions           | Area             |
| ----------------------- | -------------------- | ---------------- |
| Bay 3 North             | 113' 10" × 62' 1.5"  | 7,072 sq ft      |
| Bay 1 North             | 162' 4" × 42' 5"     | 6,886 sq ft      |
| Bay 2 North             | 84' 8" × 43' 9"      | 3,704 sq ft      |
| Bay 3 South / East      | 52' 4" × 43' 10.5"   | 2,296 sq ft      |
| Bay 2 South             | 50' 3" × 44' 3"      | 2,224 sq ft      |
| Office gap (Bay 1)      | 63' 1.5" × 14' 11.5" | 944 sq ft        |
| Pre-restroom #2 (Bay 3) | 47' 6" × 5' 3.5"     | 251 sq ft        |
| Pre-kitchen (Bay 3)     | 14' 0" × 11' 4.5"    | 159 sq ft        |
| **TOTAL FREE**          |                      | **23,536 sq ft** |

Occupied spaces that do not count as free:

| Space                       | Area        |
| --------------------------- | ----------- |
| Main aisle (not usable)     | 3,425 sq ft |
| Shipping Area (operational) | 1,886 sq ft |
| Cage (enclosed)             | 1,120 sq ft |

Total building area: **37,478 sq ft**, **63% free**.

> **Bay 3 South / East is counted gross, and there it hurts.** Of its 52' 4" of width,
> 4' 3" and 4' 11" are existing racks and 6' 0" and 4' 0" are the two north-south
> aisles: **19' 2" of the 52' 4", 37% of the zone, is not open floor.** The 2,296 sq ft
> above is the whole zone; what can actually take pallets is the 33' 1" strip in the
> middle. The same caveat applies in kind to every other zone, but nowhere else is it
> this large.

The three strips north of the aisle add up to **17,662 sq ft, 75% of everything
available**. That is where the warehouse really is.

> **What the Bay 3 re-measures moved.** Two separate corrections landed on 11 Aug 2026.
> The depth one pushed total free space up 47 sq ft (23,669 → 23,716) and the building
> area by the same amount (37,431 → 37,478), since Bay 3 is 5" deeper than calculated;
> inside it, Bay 3 North gained 90 sq ft and the strips south of the aisle lost 42,
> because the Bay 3 aisle drops 4.5". Then the east-gap one took 180 sq ft back out
> (23,716 → 23,536): Bay 3 South/East loses 205 as it shrinks from 57' 0" to 52' 4",
> and pre-restroom #2 gains 24 as the office block widens past it. Net across both:
> **23,669 → 23,536, 133 sq ft less free space than we thought.**

---

## 10. Not measured

Nothing missing moves the free area. The envelope is closed.

- **Internal split of the office blocks.** Not of interest: they are drawn as opaque
  blocks. Applies to Mrs Z / Sales / CAFYT in Bay 1, to restroom #1 + Credit Dept in
  Bay 2, and to kitchen / restroom #2 / offices in Bay 3.
- **N-S depth of the Bay 3 kitchen** inside its block.
- **Bay 3 South / East, north-south depth.** The east-west chain is closed (§3); the
  depth is not. Blocks the pallet layout for that zone.
- **Bay 3 offices: divider → west face of the block.** One short measurement that would
  turn the derived 61' 6" width into a measured one, or find free floor there (§4).
- **Columns.** Deliberately excluded (§5).

---

## 11. Pallet layout in Bay 3 North

### Orientation: north-south now, east-west long term

| Option               | File                      | Status                                                                     |
| -------------------- | ------------------------- | -------------------------------------------------------------------------- |
| **North-south** rows | `bay3_pallet_layout.html` | **In progress.** The one being worked, and the only one linked from the UI |
| **East-west** rows   | `bay3_layout_ew.html`     | **Long-term improvement.** Frozen and unlinked from `index.html`           |

The east-west version holds quite a bit more: aisles are what eat the floor, and there
it is two blocks with a single aisle instead of five blocks with four. The price is
that the north block ends up five rows deep and its middle rows cannot be reached
without moving what is in front of them. That is not a change of plan, it is a change
in how the warehouse is operated — hence parked as a long-term improvement.

**For now the whole effort goes to north-south.** The east-west file is kept exactly as
it was, modelled with the old 56" × 54" pallet; if it is ever picked up again, it has
to be re-run on the current measurements before anything is compared.

### Depth re-measured, 11 Aug 2026

The hunch was right: there was space left over. The storage depth went from 61' 4"
derived to **62' 1.5" measured**, 9.5" more (§3, §7). The model already uses it —
`const NS = (62*12) + 1.5` in `bay3_pallet_layout.html` and in `warehouse_app.html`.

With that the usable depth came to 599.5" and the tenth pallet fell **half an inch**
short. That half inch **comes out of the north wall clearance**, which goes from 146"
to **145.5"**: `MARGIN_NORTH` in both files. The main aisle is not touched — eating
into the aisle was discarded, and the UI no longer has that button.

Resulting usable depth: **exactly 600", 10 pallets deep with nothing left over.**

### Reference pallet

**62" × 60"** (east-west × north-south). It is the UI default and what the Bay 3 model
inside `warehouse_app.html` uses. In `bay3_pallet_layout.html` the field stays
editable: the whole layout recalculates on the fly and the reset button goes back to
62 × 60.

### Rules of the north-south layout

- Rows sit flush inside each block, no gap between them
- Pallets sit flush too, inside the row
- **All the leftover depth is pulled to the front of the row**, the south end against
  the main aisle, as **one green block per row**. Its capacity is counted in lines of
  10" at 5 bikes each, but it is drawn and counted as a block
- With the 60"-deep pallet **the leftover is zero**, so right now there is no green
  block at all. The rule is still live: it comes back as soon as the size changes
- Leftover across the bay widens the aisles
- Fast picking = every pallet whose edge touches open floor

### Bikes

**30 bikes per pallet.** That is the large figure in the stats bar. The front blocks,
when there are any, count separately at 5 bikes per 10" line.

### Figures with the default pallet

| Scenario                                   | Rows             | Depth | Pallets | Bikes | Fast picking | Aisles        |
| ------------------------------------------ | ---------------- | ----- | ------- | ----- | ------------ | ------------- |
| **CURRENT** — 13 ft kept clear at the west | 14 (4·4·2·2·2)   | 10    | 140     | 4,200 | 108          | 68.5" / 55.5" |
| **WEST FREED** — strip reclaimed           | 15 (4·4·2·2·2·1) | 10    | 150     | 4,500 | 118          | 76.2" / 63.2" |

They change on their own as soon as the pallet size is touched in the UI.

### Why the aisle is not eaten into

Taking a strip off the main aisle to gain that tenth pallet was modelled at one point.
With the old measurements it needed 30", with the pallet turned 10", and with the
re-measured depth only 0.5" — at that scale it stopped being a decision about the plan
and became one about the tape measure. It was settled by taking the half inch out of
the north clearance, and **the aisle keeps its full 120"**. The aisle-eating feature
was removed from the UI.
