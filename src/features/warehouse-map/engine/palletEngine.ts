// Lays pallets out inside a measured zone: how many rows fit, in which blocks,
// with what halls, and which slots a post kills. Pure — same input, same
// layout — so the totals a zone prints are testable numbers, not text under
// a drawing.
//
// Ported from the old public/warehouse/PalletEngine.js (calculate + autoBlocks)
// on 2026-08-28 (idea-170), behaviour for behaviour; the 54 reference cases the
// JS produced that day are what the port was checked against. One deliberate
// change: the JS fell back to `Math.random()` when the halls had to be split
// unevenly around a post. Here that fallback runs on a seeded generator, so
// the same zone always gets the same layout.
//
// Layout rules the search encodes (also in the warehouse-space-planner agent):
// rows are flush; no hall narrower than HALL_MIN; a block deeper than two rows
// against a wall gets a wall hall (its far rows would be buried otherwise);
// leftover depth becomes loose bike lines at the front of each row, on the
// main hall; a post inside a hall is fine only with HALL_MIN clear on at
// least one side; on a tie, fewer wall halls, then less leftover.

import type {
  Cell,
  EngineState,
  Hit,
  LayoutModel,
  Margins,
  Obstacle,
  Row,
  StripSegment,
  ZoneConfig,
} from './types';

/** Narrowest hall a pallet jack works in, inches. */
export const HALL_MIN = 54;
export const BIKES_PER_PALLET = 30;
/** Bikes in one loose line across a row's width. */
export const BIKES_PER_LINE = 6;
/** Depth one loose bike line takes, inches. */
export const BIKE_LINE_DEPTH = 10;
/** The pallet the plans were drawn with: 60" deep into the row, 62" along the hall. */
export const DEFAULT_PALLET = { pd: 60, pw: 62 } as const;

/** Labels the engine can hand out; the search never needs more rows than this. */
const LABEL_SEQUENCE_LENGTH = 150;
/** Anti-trap cross hall the engine adds when rows run parallel to the main hall. */
const CROSS_HALL_WIDTH = 120;
const DEFAULT_ALLOWED_BLOCKS = [2, 3];
const DEFAULT_POST_SIZE = 8;
const RANDOM_SPLIT_TRIES = 20;

export function defaultEngineState(overrides: Partial<EngineState> = {}): EngineState {
  return {
    pw: DEFAULT_PALLET.pw,
    pd: DEFAULT_PALLET.pd,
    isEW: false,
    layoutPreset: 'standard',
    toggles: { west: true, east: true },
    hallOverrides: {},
    ...overrides,
  };
}

/**
 * Row numbers from `rowRange.start`, counting toward `end` and past it. The
 * plans never stop at `end`: a zone that fits more rows than its range keeps
 * numbering, and one that fits fewer simply does not reach it.
 */
export function rowLabelSequence(config: ZoneConfig): string[] {
  if (!config.rowRange) return [];
  const { start, end } = config.rowRange;
  const step = start <= end ? 1 : -1;
  const seq: string[] = [];
  for (let i = 0; i < LABEL_SEQUENCE_LENGTH; i++) seq.push(String(start + step * i));
  return seq;
}

/** mulberry32 — small, seeded, good enough to split a hall twenty ways. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface BlockSearchResult {
  blocks: number[];
  nRows: number;
  extra: number;
  wallHallLeft: boolean;
  wallHallRight: boolean;
  hallWidths: number[];
  /** `hallIndex: -1` shifts block 0 up to a post; `i` shifts what follows hall `i`. */
  extraSpaces: { hallIndex: number; shiftAmt: number }[];
}

function countOf(list: number[], size: number): number {
  let n = 0;
  for (const b of list) if (b === size) n++;
  return n;
}

/**
 * Searches every sequence of allowed block sizes that fits in `span` and keeps
 * the one with the most rows. `startIsHall` / `endIsHall` say whether the
 * span already borders a hall on that side, which is what decides wall halls.
 */
function autoBlocks(
  config: ZoneConfig,
  state: EngineState,
  span: number,
  rW: number,
  startIsHall: boolean,
  endIsHall: boolean
): BlockSearchResult | null {
  let best: BlockSearchResult | null = null;
  let maxRows = 0;
  let minExtra = Infinity;
  let bestWallHallsCount = Infinity;
  const sizes = config.allowedBlocks ?? DEFAULT_ALLOWED_BLOCKS;
  const minSize = Math.min(...sizes);
  const constraints = config.blockConstraints;
  const maxAtWall = state.maxAtWall !== undefined ? state.maxAtWall : constraints?.maxAtWall;
  const posts = config.posts ?? [];
  const random = seededRandom(0x5eed);

  /** A post's position along the row axis, from the zone's original margins. */
  const postAlong = (post: { x: number; y: number }) =>
    state.isEW ? post.y - config.margins.top : post.x - config.margins.left;

  const search = (bList: number[], used: number): void => {
    const first = bList[0];
    const last = bList[bList.length - 1];
    const wallHallLeft = !startIsHall && first > 2;
    const wallHallRight = !endIsHall && last > 2;

    const hCount = bList.length > 0 ? bList.length - 1 : 0;
    const req =
      used + hCount * HALL_MIN + (wallHallLeft ? HALL_MIN : 0) + (wallHallRight ? HALL_MIN : 0);
    if (req > span) return;

    if (maxAtWall !== undefined && !startIsHall && first > maxAtWall) return;

    // A one-row block with a hall on both sides is a hall wasted: prune it.
    for (let i = 0; i < bList.length - 1; i++) {
      if (bList[i] === 1) {
        const hasHallBefore = i > 0 || startIsHall || wallHallLeft;
        if (hasHallBefore) return;
      }
    }

    const extra = span - req;

    let valid = true;
    if (last === 1) {
      const hasHallBefore = bList.length > 1 || startIsHall || wallHallLeft;
      const hasHallAfter = endIsHall || wallHallRight;
      if (hasHallBefore && hasHallAfter) valid = false;
    }
    if (maxAtWall !== undefined && !endIsHall && last > maxAtWall) valid = false;

    if (valid && constraints) {
      if (constraints.maxCount) {
        for (const [sizeStr, max] of Object.entries(constraints.maxCount)) {
          if (countOf(bList, parseInt(sizeStr, 10)) > max) {
            valid = false;
            break;
          }
        }
      }
      if (valid && constraints.requireAtEast) {
        for (const size of constraints.requireAtEast) {
          let found = false;
          for (const b of bList) {
            if (b === size) found = true;
            else if (found) {
              valid = false;
              break;
            }
          }
          if (!valid) break;
        }
      }
    }

    let finalHallWidths: number[] = [];

    if (valid) {
      if (posts.length > 0) {
        // A post inside a hall needs HALL_MIN clear on one side of it, or the
        // jack cannot get past. Try the even split first, then all of the
        // leftover in one hall, then random splits.
        const checkHalls = (extraDist: number[]): boolean => {
          const halls: { x: number; w: number }[] = [];
          let currX = 0;
          if (wallHallLeft) {
            halls.push({ x: currX, w: HALL_MIN });
            currX += HALL_MIN;
          }
          for (let i = 0; i < bList.length; i++) {
            currX += bList[i] * rW;
            if (i < bList.length - 1) {
              const w = HALL_MIN + extraDist[i];
              halls.push({ x: currX, w });
              currX += w;
            }
          }
          if (wallHallRight) {
            halls.push({ x: currX, w: HALL_MIN });
            currX += HALL_MIN;
          }
          for (const post of posts) {
            const px = postAlong(post);
            const pSize = post.size || DEFAULT_POST_SIZE;
            for (const h of halls) {
              if (px + pSize > h.x && px < h.x + h.w) {
                const leftSpace = px - h.x;
                const rightSpace = h.x + h.w - (px + pSize);
                if (leftSpace < HALL_MIN && rightSpace < HALL_MIN) return false;
              }
            }
          }
          return true;
        };

        let foundDist: number[] | null = null;
        if (hCount === 0) {
          foundDist = checkHalls([]) ? [] : null;
        } else {
          const uniform = Array<number>(hCount).fill(extra / hCount);
          if (checkHalls(uniform)) {
            foundDist = uniform;
          } else {
            for (let i = 0; i < hCount; i++) {
              const dist = Array<number>(hCount).fill(0);
              dist[i] = extra;
              if (checkHalls(dist)) {
                foundDist = dist;
                break;
              }
            }
            if (!foundDist && hCount > 1) {
              for (let tries = 0; tries < RANDOM_SPLIT_TRIES; tries++) {
                const dist = Array<number>(hCount).fill(0);
                let remaining = extra;
                for (let i = 0; i < hCount - 1; i++) {
                  const alloc = random() * remaining;
                  dist[i] = alloc;
                  remaining -= alloc;
                }
                dist[hCount - 1] = remaining;
                if (checkHalls(dist)) {
                  foundDist = dist;
                  break;
                }
              }
            }
          }
        }

        if (foundDist) finalHallWidths = foundDist.map((d) => HALL_MIN + d);
        else valid = false;
      } else if (hCount > 0) {
        finalHallWidths = Array<number>(hCount).fill(HALL_MIN + extra / hCount);
      }
    }

    if (valid) {
      // Forced hall widths take their inches from the leftover; the rest of
      // the halls share what remains. Forcing more than there is invalidates.
      let totalOverride = 0;
      let overrideCount = 0;
      for (const [idx, val] of Object.entries(state.hallOverrides)) {
        const i = parseInt(idx, 10);
        if (i < finalHallWidths.length) {
          totalOverride += val;
          overrideCount++;
          finalHallWidths[i] = val;
        }
      }
      const remainingExtra = extra - (totalOverride - overrideCount * HALL_MIN);
      if (remainingExtra < 0) {
        valid = false;
      } else {
        const nonOverrideCount = finalHallWidths.length - overrideCount;
        if (nonOverrideCount > 0) {
          for (let i = 0; i < finalHallWidths.length; i++) {
            if (state.hallOverrides[i] === undefined) {
              finalHallWidths[i] = HALL_MIN + remainingExtra / nonOverrideCount;
            }
          }
        }
      }
    }

    if (valid) {
      const extraSpaces: BlockSearchResult['extraSpaces'] = [];
      if (config.pushBlocksEastToPosts) {
        // Slide each block along its hall until it sits an inch off the
        // nearest post, so the post lands in the hall and not in a slot.
        let currX = wallHallLeft ? HALL_MIN : 0;
        for (let i = 0; i < bList.length - 1; i++) {
          currX += bList[i] * rW;
          const hw = finalHallWidths[i];

          let minLeftSpace: number | null = null;
          let pSizeForMin = DEFAULT_POST_SIZE;
          for (const post of posts) {
            const px = postAlong(post);
            if (px > currX && px < currX + hw) {
              const leftSpace = px - currX;
              if (minLeftSpace === null || leftSpace < minLeftSpace) {
                minLeftSpace = leftSpace;
                pSizeForMin = post.size || DEFAULT_POST_SIZE;
              }
            }
          }

          if (minLeftSpace !== null && minLeftSpace > 1) {
            const shift = minLeftSpace - pSizeForMin / 2 - 1;
            const hasOverride =
              state.hallOverrides[i] !== undefined ||
              (i > 0 && state.hallOverrides[i - 1] !== undefined);
            if (!hasOverride && shift > 0) {
              finalHallWidths[i] -= shift;
              if (i > 0) finalHallWidths[i - 1] += shift;
              extraSpaces.push({ hallIndex: i - 1, shiftAmt: shift });
            }
          }
          currX += hw;
        }
      }

      const totalRows = bList.reduce((a, b) => a + b, 0);
      const wallHallsCount = (wallHallLeft ? 1 : 0) + (wallHallRight ? 1 : 0);

      let meetsMin = true;
      if (constraints?.minCount) {
        for (const [sizeStr, min] of Object.entries(constraints.minCount)) {
          if (countOf(bList, parseInt(sizeStr, 10)) < min) {
            meetsMin = false;
            break;
          }
        }
      }

      let isBetter = false;
      if (meetsMin) {
        if (totalRows > maxRows) isBetter = true;
        else if (totalRows === maxRows) {
          if (wallHallsCount < bestWallHallsCount) isBetter = true;
          else if (wallHallsCount === bestWallHallsCount && extra < minExtra) isBetter = true;
        }
      }

      if (isBetter) {
        maxRows = totalRows;
        minExtra = extra;
        bestWallHallsCount = wallHallsCount;
        best = {
          blocks: [...bList],
          nRows: totalRows,
          extra,
          wallHallLeft,
          wallHallRight,
          hallWidths: finalHallWidths,
          extraSpaces,
        };
      }
    }

    const minBlockSpan = minSize * rW + HALL_MIN;
    if (extra >= minBlockSpan) {
      for (const b of sizes) {
        bList.push(b);
        search(bList, used + b * rW);
        bList.pop();
      }
    }
  };

  for (const b of sizes) search([b], b * rW);
  return best;
}

/**
 * The layout of one zone under one state, or `null` when not even one row of
 * pallets fits (or no block sequence satisfies the zone's constraints).
 */
export function calculateLayout(config: ZoneConfig, state: EngineState): LayoutModel | null {
  const c = config;
  const s = state;

  const margins: Margins = { ...c.margins };
  const dynamicObstacles: Obstacle[] = [];

  // A toggled-off wall hall gives its margin back to the floor.
  for (const obs of c.obstacles ?? []) {
    if (obs.toggleable && s.toggles[obs.toggleable] === false) {
      if (obs.x === 0 && obs.w === margins.left) margins.left = 0;
      if (obs.x > 0 && obs.x + obs.w === c.width && obs.w === margins.right) margins.right = 0;
    } else {
      dynamicObstacles.push(obs);
    }
  }

  // Anti-trap: rows parallel to the main hall need a cross hall to reach it.
  const isMainHorizontal = c.mainAccess === 'south' || c.mainAccess === 'north';
  const isMainVertical = c.mainAccess === 'east' || c.mainAccess === 'west';

  if (isMainHorizontal && s.isEW && margins.left < HALL_MIN && margins.right < HALL_MIN) {
    margins.left = CROSS_HALL_WIDTH;
    dynamicObstacles.push({
      id: 'dynamic_cross_hall',
      x: 0,
      y: 0,
      w: CROSS_HALL_WIDTH,
      h: c.height,
      type: 'hall',
      label: `CROSS HALL (${CROSS_HALL_WIDTH}")`,
    });
  }
  if (isMainVertical && !s.isEW && margins.top < HALL_MIN && margins.bottom < HALL_MIN) {
    margins.top = CROSS_HALL_WIDTH;
    dynamicObstacles.push({
      id: 'dynamic_cross_hall',
      x: 0,
      y: 0,
      w: c.width,
      h: CROSS_HALL_WIDTH,
      type: 'hall',
      label: `CROSS HALL (${CROSS_HALL_WIDTH}")`,
    });
  }

  const usableEW = c.width - margins.left - margins.right;
  const usableNS = c.height - margins.top - margins.bottom;

  // N–S rows: the row axis is east–west and the pallet's W runs along it.
  const rW = s.isEW ? s.pd : s.pw;
  const sD = s.isEW ? s.pw : s.pd;
  const rSpan = s.isEW ? usableNS : usableEW;
  const dSpan = s.isEW ? usableEW : usableNS;

  if (usableEW < rW || usableNS < sD) return null;

  const deep = Math.floor(dSpan / sD + 1e-9);
  if (deep < 1) return null;
  const front = dSpan - deep * sD;
  const nLines = Math.floor(front / BIKE_LINE_DEPTH + 1e-9);
  const gapW = nLines * BIKE_LINE_DEPTH;
  // Slot A sits on the main hall: at the far end when the hall is south/east.
  const isReverse = c.mainAccess === 'south' || c.mainAccess === 'east';
  const offs: number[] = [];
  for (let i = 0; i < deep; i++) {
    offs.push(isReverse ? dSpan - gapW - (i + 1) * sD : gapW + i * sD);
  }

  let blocks: number[];
  let nRows: number;
  let extra: number;
  let wallHallLeft = false;
  let wallHallRight = false;
  let extraSpaces: BlockSearchResult['extraSpaces'] = [];
  let hallWidths: number[] = [];

  if (s.layoutPreset === 'solid') {
    // One mass block across the whole span, no internal halls.
    nRows = Math.floor(rSpan / rW);
    if (nRows < 1) return null;
    blocks = [nRows];
    extra = rSpan - nRows * rW;
  } else if (s.layoutPreset === 'center_hall') {
    // Two big blocks around one wide hall that takes all the leftover.
    const minHall = s.centerHallWidth ?? HALL_MIN;
    nRows = Math.floor((rSpan - minHall) / rW);
    if (nRows < 2) return null;
    blocks = [Math.ceil(nRows / 2), Math.floor(nRows / 2)];
    extra = 0;
    hallWidths = [rSpan - nRows * rW];
  } else {
    const minW = rW * Math.min(...(c.allowedBlocks ?? DEFAULT_ALLOWED_BLOCKS)) + HALL_MIN;
    if (rSpan < minW) return null;

    let startIsHall = false;
    let endIsHall = false;
    if (c.openBoundaries) {
      if (s.isEW) {
        if (c.openBoundaries.top) startIsHall = true;
        if (c.openBoundaries.bottom) endIsHall = true;
      } else {
        if (c.openBoundaries.left) startIsHall = true;
        if (c.openBoundaries.right) endIsHall = true;
      }
    }
    // A hall obstacle running at least half the usable span along a boundary
    // counts as that boundary being open.
    for (const o of c.obstacles ?? []) {
      if (o.toggleable && s.toggles[o.toggleable] === false) continue;
      if (o.type !== 'hall') continue;
      if (s.isEW) {
        if (o.w >= usableEW * 0.5) {
          if (o.y <= margins.top && o.y + o.h >= margins.top) startIsHall = true;
          if (o.y <= c.height - margins.bottom && o.y + o.h >= c.height - margins.bottom) {
            endIsHall = true;
          }
        }
      } else if (o.h >= usableNS * 0.5) {
        if (o.x <= margins.left && o.x + o.w >= margins.left) startIsHall = true;
        if (o.x <= c.width - margins.right && o.x + o.w >= c.width - margins.right) {
          endIsHall = true;
        }
      }
    }

    const res = autoBlocks(c, s, rSpan, rW, startIsHall, endIsHall);
    if (!res) return null;
    ({ blocks, nRows, extra, wallHallLeft, wallHallRight, extraSpaces, hallWidths } = res);
  }

  const nHalls = blocks.length - 1;
  const hall = nHalls > 0 ? HALL_MIN + extra / nHalls : 0;

  // The strip: halls and blocks laid end to end along the row axis.
  const strip: StripSegment[] = [];
  let cx = 0;
  const seq = rowLabelSequence(c);
  const origin = c.rowRange?.origin ?? 'west';
  let rowIndex = 0;
  let hallIndex = 0;

  if (wallHallLeft) {
    strip.push({ type: 'hall', w: HALL_MIN, x: cx });
    cx += HALL_MIN;
  }
  const initialExtra = extraSpaces.find((e) => e.hallIndex === -1);
  if (initialExtra && initialExtra.shiftAmt > 0) {
    strip.push({
      type: 'hall',
      w: initialExtra.shiftAmt,
      x: cx,
      isExtraOnly: true,
      extra: initialExtra.shiftAmt,
    });
    cx += initialExtra.shiftAmt;
  }

  for (let i = 0; i < blocks.length; i++) {
    const bSize = blocks[i];
    const start = cx;
    const rows: Row[] = [];
    for (let k = 0; k < bSize; k++) {
      const seqIdx = origin === 'east' ? nRows - 1 - rowIndex : rowIndex;
      const num = seqIdx < seq.length ? seq[seqIdx] : '?';
      rows.push({ idx: k, of: bSize, x: cx, num });
      rowIndex++;
      cx += rW;
    }
    strip.push({ type: 'block', size: bSize, x0: start, x1: cx, rows });

    if (i < blocks.length - 1) {
      const hw = hallWidths[hallIndex] || HALL_MIN;
      const extraSpc = extraSpaces.find((e) => e.hallIndex === hallIndex);
      strip.push({ type: 'hall', w: hw, x: cx, idx: hallIndex, extra: extraSpc?.shiftAmt ?? 0 });
      cx += hw;
      hallIndex++;
    }
  }

  if (wallHallRight) {
    strip.push({ type: 'hall', w: HALL_MIN, x: cx, isWall: true });
    cx += HALL_MIN;
  }

  // Every slot, with its place on the zone and how far it is from the hall.
  const cells: Cell[] = [];
  const blockBikes = nRows * nLines * BIKES_PER_LINE;
  const mainHall = (c.obstacles ?? []).find((o) => o.id === 'main_hall');

  // Rows with one square more than the zone is deep (bay3_north 30–33: the K,
  // Rafael 31 Aug 2026). It sits one step past the far end, a little over the
  // clearance strip, and it is the row's far face — fast where the square
  // behind it stops being so.
  const extraRows = new Set((c.extraSlotRows ?? []).map(String));
  const extraOff = isReverse ? dSpan - gapW - (deep + 1) * sD : gapW + deep * sD;

  for (const seg of strip) {
    if (seg.type !== 'block') continue;
    for (const r of seg.rows) {
      const rowDeep = extraRows.has(String(r.num)) ? deep + 1 : deep;
      for (let d = 0; d < rowDeep; d++) {
        const cxSlot = s.isEW ? margins.left + (d < deep ? offs[d] : extraOff) : margins.left + r.x;
        const cySlot = s.isEW ? margins.top + r.x : margins.top + (d < deep ? offs[d] : extraOff);
        const cwSlot = s.isEW ? sD : rW;
        const chSlot = s.isEW ? rW : sD;
        const edgeRow = r.idx === 0 || r.idx === r.of - 1;
        const isFast = edgeRow || d === 0 || d === rowDeep - 1;

        // Manhattan distance to the main hall, then to the west wall (x = 0).
        let distY: number;
        if (mainHall) {
          distY = Math.min(
            Math.abs(cySlot - mainHall.y),
            Math.abs(cySlot - (mainHall.y + mainHall.h))
          );
        } else {
          distY = c.mainAccess === 'south' ? c.height - cySlot : cySlot;
        }

        cells.push({
          row: r,
          d,
          letter: String.fromCharCode(65 + d),
          cx: cxSlot,
          cy: cySlot,
          cw: cwSlot,
          ch: chSlot,
          isFast,
          distance: distY + cxSlot,
        });
      }
    }
  }

  const overlaps = (x: number, y: number, w: number, h: number) => (cl: Cell) =>
    !(x + w <= cl.cx || x >= cl.cx + cl.cw || y + h <= cl.cy || y >= cl.cy + cl.ch);

  const activePosts = (c.posts ?? []).filter((p) => p.size > 0);
  const hits: Hit[] = [];
  const lost: Cell[] = [];

  for (const p of activePosts) {
    const hitCells = cells.filter(overlaps(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size));
    if (hitCells.length > 0) {
      hits.push({ source: { id: p.id, note: p.note ?? String(p.id) }, cells: hitCells });
      lost.push(...hitCells);
    }
  }

  const customObstacles = s.customObstacles ?? [];
  for (const obs of customObstacles) {
    const hitCells = cells.filter(overlaps(obs.x, obs.y, obs.w, obs.h));
    if (hitCells.length > 0) {
      hits.push({ source: { id: obs.id, note: obs.label || 'Non-Bike Area' }, cells: hitCells });
      lost.push(...hitCells);
    }
  }

  const validCells = cells.filter((cell) => !lost.includes(cell));
  const accessible = validCells.filter((cell) => cell.isFast).length;
  const palletBikes = validCells.length * BIKES_PER_PALLET;

  return {
    strip,
    blocks,
    nRows,
    nHalls,
    hall,
    extra,
    pallets: validCells.length,
    gross: cells.length,
    accessible,
    validCells,
    bikesPerPallet: BIKES_PER_PALLET,
    palletBikes,
    bikes: blockBikes,
    totalBikes: palletBikes + blockBikes,
    lines: nLines,
    deep,
    rW,
    sD,
    offs,
    gapW,
    front,
    hits,
    lost,
    activePosts,
    margins,
    obstacles: [...dynamicObstacles, ...customObstacles],
  };
}

/** `ROW n · letter` — the slot's name, which is also its `location` + `sublocation`. */
export function slotKey(cell: Cell): string {
  return `${cell.row.num}-${cell.letter}`;
}
