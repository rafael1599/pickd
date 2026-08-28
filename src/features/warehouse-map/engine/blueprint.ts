// The building. Every coordinate derives from the `M` table — measurements
// taken on the floor, in feet and inches — and the ten cross-checks say where
// two measurements that ought to agree do not. Nothing here is a magic
// number: to correct the plan, correct `M`.
//
// Ported from public/warehouse/warehouse_blueprint.html + warehouse_map.html
// on 2026-08-28 (idea-170). The HTML drew at 10 px = 1 ft; this module is in
// INCHES, with the same anchors (west wall at x = 10 ft, south wall at
// y = 125 ft) so that a coordinate here is the HTML's × 1.2. The anchors
// cancel in every check and every area.

import type { ZoneId } from './types';

/** Feet and inches to inches. `ft(14, 11.5)` is fourteen feet eleven and a half. */
export const ft = (feet: number, inches = 0): number => feet * 12 + inches;

/** Taping a 362-foot building accumulates error; a foot between figures that should agree is accepted. */
export const TOLERANCE = ft(1);

export const M = {
  // ---- CONFIRMED (physically measured on site) ----
  hallwayWidth: ft(10),

  // Bay 1 north–south chain, all of it measured off the SAME north wall. The
  // 52' 5" reach the SHOWROOM (south edge of the hall), not the north edge.
  bay1NorthToHall: ft(42, 3), // → north edge of the hall
  bay1NorthToShowroom: ft(52, 5), // → showroom = south edge of the hall
  bay1NorthToOffices: ft(67, 6), // → north wall of the Bay 1 offices

  // The hall is NOT a straight line: in Bay 1 it runs 1' 2" further north than
  // in Bay 2/3. Only a check: each stretch is anchored to the south wall by its
  // own direct measurement.
  hallOffsetBay1: ft(1, 2),
  bay2SouthBand: ft(44, 3), // south wall → hall, in Bay 2
  bathCreditDepth: ft(44, 3), // same depth: the block fills the whole band

  bay2NorthEmpty: ft(43, 9),
  officeGap: ft(14, 11.5), // hall → north wall of the Bay 1 offices (replaces the wrong 13' 6")
  shippingWidth: ft(41),
  shippingDepth: ft(46),
  cageWidth: ft(20),
  cageDepth: ft(56), // = 46' + 10' of hall
  showroomWidth: ft(38.2),
  showroomDepth: ft(45, 4),
  bathCreditWidth: ft(34, 5), // 413" = restroom #1 + credit dept
  bay3OfficeDepth: ft(38, 7),
  bay3NorthToOffice: ft(77), // no longer drives anything: now a cross-check

  // Bay 3 north–south chain, measured 11 Aug 2026 off the SAME north wall. A
  // chain off one wall beats a sum of rooms.
  bay3Depth: ft(116), // north wall → south wall
  bay3NorthClear: ft(12, 2), // north wall → where the rows start
  bay3RowsEnd: ft(62, 1.5), // north wall → where they end = north edge of the hall
  bay3EmptyEast: ft(52, 4), // measured 11 Aug 2026: east face of the offices → east wall
  // DERIVED, not measured: bay width (113' 10") minus the measured east gap.
  // Rests on the office block touching the Bay 2/3 divider. If it does not, this
  // width shrinks and a strip of free floor appears against the divider.
  bay3OfficeWidth: ft(61, 6),

  // Bay 3 SOUTH/EAST chain, measured 12 Aug 2026 off the SOUTH wall — independent
  // of the north chain, so the two together check the 116' depth.
  bay3SEDepth: ft(44, 2), // south wall → south edge of the main hall
  bay3SERackDepth: ft(0, 55), // rack against the south wall, N–S
  bay3SERackWidth: ft(0, 202), // that same rack, E–W along the wall
  bay3SERackHall: ft(0, 54), // the hall it needs before usable floor starts

  bay3KitchenWidth: ft(14), // given as 13' 12"
  bay3KitchenRecess: ft(6, 1), // the kitchen is RECESSED 6' 1" → more free space
  bay1OfficeBlock: ft(63, 10), // showroom → restroom #1 (Mrs Z + Sales + CAFYT)

  // E–W envelope, measured bay by bay + the thickness of the dividing walls
  bay1Width: ft(162, 4),
  divider12: ft(0, 8),
  bay2Width: ft(84, 8),
  divider23: ft(1),
  bay3Width: ft(113, 10),
  totalWidth: ft(362), // total length of the warehouse (re-measured)
} as const;

/** Drawing anchors: the south wall is straight across all three bays; the west wall is x = 0 + margin. */
export const SOUTH_Y = ft(125);
export const WEST_X = ft(10);

/* ---------- derived geometry ---------- */
// The hall runs at TWO heights: in Bay 1 it sits 1' 2" north of Bay 2/3.
const hall1Bot = SOUTH_Y - M.shippingDepth; // shipping: 46' from the south
const hall1Top = hall1Bot - M.hallwayWidth;
const hall23Bot = SOUTH_Y - M.bay2SouthBand; // 44' 3" from the south
const hall23Top = hall23Bot - M.hallwayWidth;

const cageTop = SOUTH_Y - M.cageDepth; // = hall1Top: the cage crosses the hall
const showroomTop = SOUTH_Y - M.showroomDepth;

// The whole Bay 1 chain hangs off its north wall
const bay1North = hall1Bot - M.bay1NorthToShowroom;
const officeTop = hall1Bot + M.officeGap; // top of the Bay 1 offices
const bay2North = hall23Top - M.bay2NorthEmpty;

// X axis, west to east. Each bay is anchored to its measured width and to the
// real dividing walls (8" and 1'); the Bay 1 office block absorbs the gap
// between the sum of rooms (163' 0") and the measured width (162' 4").
const cageR = WEST_X + M.cageWidth;
const shippingR = cageR + M.shippingWidth;
const showroomR = shippingR + M.showroomWidth;
const bay1East = WEST_X + M.bay1Width; // west face of the 1/2 divider
const bay2West = bay1East + M.divider12; // Bay 2 starts at restroom #1
const bathCreditR = bay2West + M.bathCreditWidth;
const bay2East = bay2West + M.bay2Width;
const bay3West = bay2East + M.divider23;
const bay3East = bay3West + M.bay3Width;
const bay3OfficeR = bay3West + M.bay3OfficeWidth;

// Bay 3: the block is anchored to the south wall; its north face is the
// restroom face, and the kitchen is recessed 6' 1" from it.
const bay3BathTop = SOUTH_Y - M.bay3OfficeDepth;
const bay3KitchenTop = bay3BathTop + M.bay3KitchenRecess;
const bay3North = SOUTH_Y - M.bay3Depth; // measured, not derived from the 77'
const kitchenR = bay3West + M.bay3KitchenWidth;

// The Bay 3 hall hangs off its north-wall chain: the rows end 62' 1.5" from
// the north wall and that is where it starts — 4.5" south of the Bay 2 stretch.
const hall3Top = bay3North + M.bay3RowsEnd;
const hall3Bot = hall3Top + M.hallwayWidth;

/** Every derived coordinate, inches, for whoever draws the building. */
export const G = {
  hall1Top,
  hall1Bot,
  hall23Top,
  hall23Bot,
  hall3Top,
  hall3Bot,
  cageTop,
  showroomTop,
  bay1North,
  bay2North,
  bay3North,
  officeTop,
  cageR,
  shippingR,
  showroomR,
  bay1East,
  bay2West,
  bathCreditR,
  bay2East,
  bay3West,
  bay3East,
  bay3OfficeR,
  bay3BathTop,
  bay3KitchenTop,
  kitchenR,
} as const;

/* ---------- areas ---------- */
export const sqft = (w: number, h: number): number => (w / 12) * (h / 12);

/** `14' 11.5"` — rounds to the half inch, which is the precision some measurements come at. */
export function toFtIn(inches: number): string {
  const halves = Math.round(inches * 2);
  const f = Math.floor(halves / 24);
  const i = (halves % 24) / 2;
  return i === 0 ? `${f}'` : `${f}' ${i}"`;
}

export type BayId = 'bay1' | 'bay2' | 'bay3';

export interface FloorRect {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FreeZone extends FloorRect {
  bay: BayId;
  /** The engine zone that lays this floor out, when one has been modelled. */
  zoneId?: ZoneId;
}

/**
 * Floor with no assigned use: no hall, no offices, no cage, no shipping (that
 * one is counted apart, being operational). The blueprint's FREE table and
 * the map's per-bay zones, which were two copies of these eight rectangles.
 */
export const FREE_ZONES: FreeZone[] = [
  {
    name: 'BAY 1 NORTH',
    bay: 'bay1',
    zoneId: 'bay1_north',
    x: WEST_X,
    y: bay1North,
    w: bay1East - WEST_X,
    h: hall1Top - bay1North,
  },
  {
    name: 'OFFICE GAP',
    bay: 'bay1',
    zoneId: 'bay1_office_gap',
    x: showroomR,
    y: hall1Bot,
    w: bay1East - showroomR,
    h: officeTop - hall1Bot,
  },
  {
    name: 'BAY 2 NORTH',
    bay: 'bay2',
    zoneId: 'bay2_north',
    x: bay2West,
    y: bay2North,
    w: bay2East - bay2West,
    h: hall23Top - bay2North,
  },
  {
    name: 'BAY 3 NORTH',
    bay: 'bay3',
    zoneId: 'bay3_north',
    x: bay3West,
    y: bay3North,
    w: bay3East - bay3West,
    h: hall3Top - bay3North,
  },
  {
    name: 'BAY 2 SOUTH',
    bay: 'bay2',
    zoneId: 'bay2_south',
    x: bathCreditR,
    y: hall23Bot,
    w: bay2East - bathCreditR,
    h: SOUTH_Y - hall23Bot,
  },
  {
    name: 'BAY 3 SOUTH/EAST',
    bay: 'bay3',
    zoneId: 'bay3_se',
    x: bay3OfficeR,
    y: hall3Bot,
    w: bay3East - bay3OfficeR,
    h: SOUTH_Y - hall3Bot,
  },
  {
    name: 'PRE-KITCHEN',
    bay: 'bay3',
    x: bay3West,
    y: hall3Bot,
    w: kitchenR - bay3West,
    h: bay3KitchenTop - hall3Bot,
  },
  {
    name: 'PRE-RESTROOM #2',
    bay: 'bay3',
    x: kitchenR,
    y: hall3Bot,
    w: bay3OfficeR - kitchenR,
    h: bay3BathTop - hall3Bot,
  },
];

export interface Bay {
  id: BayId;
  name: string;
  sub: string;
  color: string;
  x0: number;
  x1: number;
  north: number;
  hallTop: number;
  hallBot: number;
  /** Occupied blocks: rooms, cage, shipping. */
  used: FloorRect[];
  /** The Bay 3 office block is not a rectangle: the kitchen is recessed. */
  usedPolygon?: { name: string; points: [number, number][] };
}

export const BAYS: Bay[] = [
  {
    id: 'bay1',
    name: 'BAY 1',
    sub: 'AREA #1 · FAST MOVING · WHITE ROOF',
    color: '#f59e0b',
    x0: WEST_X,
    x1: bay1East,
    north: bay1North,
    hallTop: hall1Top,
    hallBot: hall1Bot,
    used: [
      { name: 'CAGE', x: WEST_X, y: cageTop, w: M.cageWidth, h: M.cageDepth },
      { name: 'SHIPPING', x: cageR, y: hall1Bot, w: M.shippingWidth, h: M.shippingDepth },
      { name: 'SHOWROOM', x: shippingR, y: showroomTop, w: M.showroomWidth, h: M.showroomDepth },
      {
        name: 'OFFICES',
        x: showroomR,
        y: officeTop,
        w: bay1East - showroomR,
        h: SOUTH_Y - officeTop,
      },
    ],
  },
  {
    id: 'bay2',
    name: 'BAY 2',
    sub: 'MOVERS · WHITE ROOF',
    color: '#22d3ee',
    x0: bay2West,
    x1: bay2East,
    north: bay2North,
    hallTop: hall23Top,
    hallBot: hall23Bot,
    used: [
      {
        name: 'RESTROOM + CREDIT',
        x: bay2West,
        y: hall23Bot,
        w: M.bathCreditWidth,
        h: M.bathCreditDepth,
      },
    ],
  },
  {
    id: 'bay3',
    name: 'BAY 3',
    sub: 'AREA #2 · NON-MOVERS · BLACK ROOF',
    color: '#a78bfa',
    x0: bay3West,
    x1: bay3East,
    north: bay3North,
    hallTop: hall3Top,
    hallBot: hall3Bot,
    used: [],
    usedPolygon: {
      name: 'OFFICES',
      points: [
        [bay3West, bay3KitchenTop],
        [kitchenR, bay3KitchenTop],
        [kitchenR, bay3BathTop],
        [bay3OfficeR, bay3BathTop],
        [bay3OfficeR, SOUTH_Y],
        [bay3West, SOUTH_Y],
      ],
    },
  },
];

export function freeZonesOf(bay: BayId): FreeZone[] {
  return FREE_ZONES.filter((z) => z.bay === bay);
}

export interface BayAreas {
  /** Sum of the bay's free zones, sq ft. */
  freeArea: number;
  /** The bay's footprint, north wall to south wall, sq ft. */
  totalArea: number;
  /** Free as a percentage of the footprint. */
  pctFree: number;
}

export function bayAreas(bay: Bay): BayAreas {
  const freeArea = freeZonesOf(bay.id).reduce((s, z) => s + sqft(z.w, z.h), 0);
  const totalArea = sqft(bay.x1 - bay.x0, SOUTH_Y - bay.north);
  return { freeArea, totalArea, pctFree: (freeArea / totalArea) * 100 };
}

export function warehouseAreas(): BayAreas {
  let freeArea = 0;
  let totalArea = 0;
  for (const bay of BAYS) {
    const a = bayAreas(bay);
    freeArea += a.freeArea;
    totalArea += a.totalArea;
  }
  return { freeArea, totalArea, pctFree: (freeArea / totalArea) * 100 };
}

/** Floor that is neither free nor a room: counted apart on the blueprint. */
export const OPERATIONAL_AREAS = {
  shipping: () => sqft(M.shippingWidth, M.shippingDepth),
  cage: () => sqft(M.cageWidth, M.cageDepth),
  mainHall: () => sqft(bay3East - cageR, M.hallwayWidth),
};

/** Where the trucks and people come in, along the south wall. */
export const DOORS: { name: string; x: number }[] = [
  { name: 'BAY #5', x: WEST_X + M.cageWidth / 2 },
  { name: 'BAY #4', x: cageR + M.shippingWidth / 2 },
  { name: 'SHOWROOM ENTRANCE', x: shippingR + M.showroomWidth / 2 },
  { name: 'SALES ENTRANCE', x: (showroomR + bay1East) / 2 },
  { name: 'EXIT #2', x: (bathCreditR + bay2East) / 2 },
];

/* ---------- cross-checks ---------- */
export interface CrossCheck {
  label: string;
  /** The two figures that ought to agree, inches. */
  a: number;
  b: number;
  diff: number;
  ok: boolean;
}

const check = (label: string, a: number, b: number): CrossCheck => {
  const diff = Math.abs(a - b);
  return { label, a, b, diff, ok: diff <= TOLERANCE };
};

/**
 * Sums of measurements that ought to agree. A wrong measurement surfaces as a
 * failing check instead of a drawing that looks fine and is quietly wrong —
 * this is how Bay 3 turned out 133 sq ft smaller on 11 Aug 2026.
 */
export function crossChecks(): CrossCheck[] {
  const sumBays = M.bay1Width + M.divider12 + M.bay2Width + M.divider23 + M.bay3Width;
  const sumRooms = M.cageWidth + M.shippingWidth + M.showroomWidth + M.bay1OfficeBlock;
  return [
    check('Bays + dividers sum vs total length', sumBays, M.totalWidth),
    check('Bay 1: rooms sum vs bay width', sumRooms, M.bay1Width),
    check(
      'Bay 1: hall width per the chain',
      M.bay1NorthToShowroom - M.bay1NorthToHall,
      M.hallwayWidth
    ),
    check(
      'Bay 1: depth via shipping vs via showroom',
      M.bay1NorthToShowroom + M.shippingDepth,
      M.bay1NorthToShowroom + M.showroomDepth + ft(0, 8)
    ),
    check('Bay 1: office wall via gap vs via chain', officeTop - bay1North, M.bay1NorthToOffices),
    check('North wall Bay 1 vs Bay 2 (alignment)', bay1North, bay2North),
    check('Hall step: derived vs measured', hall23Bot - hall1Bot, M.hallOffsetBay1),
    check(
      'Bay 3: depth via offices vs measured',
      M.bay3NorthToOffice + M.bay3OfficeDepth,
      M.bay3Depth
    ),
    check(
      'Bay 3: hall from the south, Bay 2 stretch vs Bay 3 stretch',
      SOUTH_Y - hall23Top,
      SOUTH_Y - hall3Top
    ),
    // The south-east band was measured off the SOUTH wall on 12 Aug 2026 while
    // everything else in Bay 3 hangs off the NORTH wall. The two chains meet at
    // the main hall, so this is the one check that closes the 116' from both ends.
    check(
      'Bay 3 SE: band south of the hall, measured vs the north chain',
      M.bay3SEDepth,
      SOUTH_Y - hall3Bot
    ),
  ];
}

/**
 * Not a check but a warning: the Bay 3 office width is the one figure in that
 * bay nobody measured. It is whatever is left after the measured east gap, so
 * it cannot disagree with anything and no check would ever catch it.
 */
export const BAY3_OFFICE_WIDTH_WARNING =
  `Bay 3 offices ${toFtIn(M.bay3OfficeWidth)} = bay width − measured east gap, NOT measured. ` +
  'Assumes the block touches the Bay 2/3 divider.';

/** Describes a check the way the blueprint printed it. */
export function formatCheck(c: CrossCheck): string {
  return (
    `${c.ok ? '✓' : '✗'} ${c.label}: ${toFtIn(c.a)} vs ${toFtIn(c.b)} → ${toFtIn(c.diff)}` +
    (c.ok ? '  (within tolerance)' : '  ⚠ OUT OF TOLERANCE — RE-MEASURE')
  );
}
