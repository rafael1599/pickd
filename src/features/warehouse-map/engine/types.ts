// The measured warehouse as data. Every number here is INCHES, measured on the
// floor (see docs/prds/warehouse-map-measured.md and, until F4 retires them,
// public/warehouse/WAREHOUSE-MEASUREMENTS.md). Nothing in this folder knows
// about pixels, React or the database: the engine turns a zone and a state
// into slots, and a slot is named `ROW n · letter` — the same name as
// `inventory.location` + `sublocation`, which is what lets the stock be laid
// over the drawing.

export type ZoneId =
  | 'bay3_north'
  | 'bay3_se'
  | 'bay2_north'
  | 'bay2_south'
  | 'bay1_north'
  | 'bay1_office_gap';

/** Which wall the zone's main hall runs along. */
export type MainAccess = 'north' | 'south' | 'east' | 'west';

/**
 * `hall` and `rack` are what the floor plans model; the other three come from
 * the floor-plan editor (things people draw on top of a zone).
 */
export type ObstacleType = 'hall' | 'rack' | 'non_bike_rack' | 'restricted' | 'staging';

export interface Obstacle {
  id: string;
  /** Top-left corner, inches from the zone's north-west corner. */
  x: number;
  y: number;
  w: number;
  h: number;
  type: ObstacleType;
  label?: string;
  /** Name of the toggle that removes this obstacle (e.g. `west` for a wall hall). */
  toggleable?: string;
  /** Rendering hints carried over from the plans. */
  showLabel?: boolean;
  labelDy?: number;
}

export interface Post {
  id: string | number;
  /** Centre, inches from the zone's north-west corner. */
  x: number;
  y: number;
  /** Side of the (assumed square) post. `0` disables it. */
  size: number;
  note?: string;
}

export interface ZoneLabel {
  text: string;
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  rotate?: number;
}

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface BlockConstraints {
  /** Minimum number of blocks of a given size, e.g. `{ 4: 2 }`. */
  minCount?: Record<number, number>;
  maxCount?: Record<number, number>;
  /** Once a block of this size appears, every block after it must be the same size. */
  requireAtEast?: number[];
  /** Largest block allowed against a wall (a block on a wall has no hall on that side). */
  maxAtWall?: number;
}

export interface RowRange {
  /** Row number of the first row from `origin`. Labels keep counting past `end`. */
  start: number;
  end: number;
  origin?: 'east' | 'west';
  /**
   * The labels are only labels: the DB has no `ROW n` by these numbers, so
   * no stock is laid over this zone. The Bay 1 office gap reuses 41–48.
   */
  unnamed?: boolean;
}

export interface ZoneConfig {
  id: ZoneId;
  name: string;
  /** East–west, inches. */
  width: number;
  /** North–south, inches. */
  height: number;
  /** Floor that is never storage: halls, racks, clearances. */
  margins: Margins;
  rowRange?: RowRange;
  mainAccess?: MainAccess;
  /** Block sizes (rows per block) the search may use. Default `[2, 3]`. */
  allowedBlocks?: number[];
  blockConstraints?: BlockConstraints;
  /** A side whose margin is open floor (no wall) needs no wall hall. */
  openBoundaries?: Partial<Record<'top' | 'bottom' | 'left' | 'right', boolean>>;
  /** Shrink halls so blocks sit right against the posts (Bay 3 North). */
  pushBlocksEastToPosts?: boolean;
  obstacles?: Obstacle[];
  posts?: Post[];
  labels?: ZoneLabel[];
}

export type LayoutPreset = 'standard' | 'center_hall' | 'solid';

/** What the user can change without touching the measurements. */
export interface EngineState {
  /** Pallet width along the hall, inches (the "W" slider). */
  pw: number;
  /** Pallet depth into the row, inches (the "D" slider). */
  pd: number;
  /** Rows run east–west instead of north–south. */
  isEW: boolean;
  layoutPreset: LayoutPreset;
  /** `west: false` removes the obstacle whose `toggleable` is `west`. */
  toggles: Record<string, boolean>;
  /** Hall index → forced width, inches. */
  hallOverrides: Record<number, number>;
  /** Things drawn on the zone in the floor-plan editor. */
  customObstacles?: Obstacle[];
  centerHallWidth?: number;
  /** Overrides `blockConstraints.maxAtWall`. */
  maxAtWall?: number;
}

export interface Row {
  /** Position inside its block. */
  idx: number;
  /** Rows in the block. */
  of: number;
  /** Offset along the row axis, inches from the usable area's start. */
  x: number;
  /** Row label — the DB's `ROW n` number, or `?` past the label sequence. */
  num: string;
}

export type StripSegment =
  | {
      type: 'hall';
      w: number;
      x: number;
      /** Index among the internal halls (wall halls have none). */
      idx?: number;
      /** Inches beyond `HALL_MIN` in this hall. */
      extra?: number;
      isWall?: boolean;
      /** Not a hall someone walks: the shift that pushes block 0 up to a post. */
      isExtraOnly?: boolean;
    }
  | { type: 'block'; size: number; x0: number; x1: number; rows: Row[] };

export interface Cell {
  row: Row;
  /** Depth index: 0 is slot A. */
  d: number;
  /** `A`, `B`, … — the sublocation letter. */
  letter: string;
  /** Top-left corner, inches from the zone's north-west corner. */
  cx: number;
  cy: number;
  cw: number;
  ch: number;
  /** Touches a hall or open floor: a picker reaches it without moving anything. */
  isFast: boolean;
  /** Manhattan distance to the main hall + the west wall, inches. */
  distance: number;
}

export interface Hit {
  /** The post, or the drawn obstacle, that lands on the cells. */
  source: { id: string | number; note: string };
  cells: Cell[];
}

export interface LayoutModel {
  strip: StripSegment[];
  /** Rows per block, in strip order. */
  blocks: number[];
  nRows: number;
  nHalls: number;
  /** Width of the internal halls when they share the leftover evenly, inches. */
  hall: number;
  /** Inches left over along the row axis after rows and minimum halls. */
  extra: number;
  /** Slots that survive the posts and the drawn obstacles. */
  pallets: number;
  /** Slots before posts. */
  gross: number;
  /** Surviving slots that are fast. */
  accessible: number;
  validCells: Cell[];
  bikesPerPallet: number;
  /** Bikes in the surviving pallets. */
  palletBikes: number;
  /** Bikes in the loose lines at the front of the rows. */
  bikes: number;
  /** `palletBikes + bikes` — the TOTAL BIKES counter. */
  totalBikes: number;
  /** Loose bike lines per row in the leftover depth. */
  lines: number;
  /** Slots per row. */
  deep: number;
  /** Row width and slot depth as laid out, inches. */
  rW: number;
  sD: number;
  /** Depth offset of each slot, inches from the usable area's start. */
  offs: number[];
  gapW: number;
  front: number;
  hits: Hit[];
  lost: Cell[];
  activePosts: Post[];
  /** Margins after toggles and the anti-trap cross hall. */
  margins: Margins;
  /** Obstacles to draw: the zone's (minus toggled-off ones), the cross hall, the custom ones. */
  obstacles: Obstacle[];
}
