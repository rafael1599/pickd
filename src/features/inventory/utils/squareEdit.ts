/**
 * Edit squares — one mode for the boxes and the figure of each square
 * (idea-258, docs/prds/square-edit-mode.md). This is the pure half: the draft
 * of a row per square, what the rule proposes, the edits, what changed and
 * what a save writes. Plus the Stock card's `+n loose` / `−n extra` chip.
 */
import type { DistributionItem } from '../../../schemas/inventory.schema';
import { boxesTotal, byShowOrder, groupUnits, squaredGroups } from '../../../utils/boxSquares';
import { DS_UNITS, palletsFor } from '../../../utils/distributionCalculator';
import { rowStock, stockUnits, type RowLike } from './moveLoad';

/** Quantity minus boxes: `+7` = 7 loose units, `−7` = boxes for 7 that are not there. */
export const boxesMismatch = (
  distribution: readonly DistributionItem[] | null | undefined,
  quantity: number
): number => quantity - boxesTotal(distribution);

/** `+7 loose` / `−7 extra`, or null when they match. */
export function mismatchLabel(diff: number): string | null {
  if (diff > 0) return `+${diff} loose`;
  if (diff < 0) return `−${-diff} extra`;
  return null;
}

// ── Edit squares: one mode for the boxes and the figure of each square ──────
// (idea-258, docs/prds/square-edit-mode.md). Rafael, 7 Oct 2026: «un modo edit
// con una vista específica… un solo modal y lógica que se reutilice en ambos
// casos». A square's figure is what stands on the floor; its pallets say how
// it is built. The rule proposes, the person accepts.

/** One square of a row, as the mode edits it. `letter` is null outside a ROW. */
export interface DraftSquare {
  letter: string | null;
  units: number;
  pallets: DistributionItem[];
}

export interface RowDraft {
  squares: DraftSquare[];
  /** Several letters and nobody said how many in each: the split is proposed first. */
  needsSplit: string[] | null;
}

export type Proposal =
  | { kind: 'rule'; pallets: DistributionItem[] }
  | { kind: 'overflow'; keep: number; rest: number };

const stamp = (pallets: readonly DistributionItem[], letter: string | null): DistributionItem[] =>
  pallets.map((p) => {
    const out = { ...p };
    if (letter) out.square = letter;
    else delete out.square;
    return out;
  });

const palletUnits = (pallets: readonly DistributionItem[]) =>
  pallets.reduce((n, p) => n + groupUnits(p), 0);

const byLetter = (a: DraftSquare, b: DraftSquare) => (a.letter ?? '').localeCompare(b.letter ?? '');

/**
 * What each square holds, its figure taken from the quantity (never from the
 * boxes): one square is the whole quantity; several, as their boxes and loose
 * say — and when those don't add up to the quantity, the split is asked again.
 */
export function rowDraft(row: RowLike, split?: Record<string, number> | null): RowDraft {
  const rs = rowStock(row, split);
  if (rs.needsSplit) {
    return {
      squares: rs.needsSplit.map((letter) => ({ letter, units: 0, pallets: [] })),
      needsSplit: rs.needsSplit,
    };
  }
  const squares = rs.squares.map((s) => ({
    letter: s.square,
    units: stockUnits(s),
    pallets: stamp(s.groups, s.square),
  }));
  const total = squares.reduce((n, s) => n + s.units, 0);
  if (total !== row.quantity) {
    if (squares.length === 1) squares[0].units = Math.max(0, row.quantity);
    else if (!split) {
      const letters = squares.map((s) => s.letter as string);
      return {
        squares: letters.map((letter) => ({ letter, units: 0, pallets: [] })),
        needsSplit: letters,
      };
    }
  }
  return { squares, needsSplit: null };
}

/** The split proposed for a `?` row: 30 per square A→Z, the rest in the last. */
export function proposeSplit(letters: readonly string[], qty: number): Record<string, number> {
  const out: Record<string, number> = {};
  let left = Math.max(0, qty);
  letters.forEach((l, i) => {
    const n = i === letters.length - 1 ? left : Math.min(DS_UNITS, left);
    out[l] = n;
    left -= n;
  });
  return out;
}

/** What the rule builds for a square (adult bikes); null for a kids bike. */
export const ruleFor = (
  units: number,
  isKid: boolean,
  letter: string | null = null
): DistributionItem[] | null => (isKid ? null : stamp(palletsFor(units), letter));

const signature = (pallets: readonly DistributionItem[]) =>
  squaredGroups(stamp(pallets, 'A'), ['A'])
    .map((p) => `${p.type}:${p.count}:${p.units_each}`)
    .join('|');

/**
 * What the mode offers under a square, or null when there is nothing to offer:
 * a kids bike (built by hand), outside a ROW, a single unit (it draws
 * nothing), a square already by the rule. More than 30 offers the overflow.
 */
export function proposalFor(sq: DraftSquare, isKid: boolean): Proposal | null {
  if (isKid || !sq.letter) return null;
  if (sq.units > DS_UNITS) return { kind: 'overflow', keep: DS_UNITS, rest: sq.units - DS_UNITS };
  if (sq.units <= 1 && sq.pallets.length === 0) return null;
  const rule = palletsFor(sq.units);
  return signature(rule) === signature(sq.pallets)
    ? null
    : { kind: 'rule', pallets: stamp(rule, sq.letter) };
}

const mapSquare = (
  draft: RowDraft,
  letter: string | null,
  fn: (s: DraftSquare) => DraftSquare
) => ({
  ...draft,
  squares: draft.squares.map((s) => (s.letter === letter ? fn(s) : s)),
});

/**
 * The split accepted: each square gets its figure — from the split, whatever
 * the boxes said — and (adult) the rule; a kids square keeps the boxes that
 * fell in it.
 */
export function acceptSplit(row: RowLike, split: Record<string, number>, isKid: boolean): RowDraft {
  const boxes = rowDraft(row, split);
  const letters = Object.keys(split).sort();
  return {
    needsSplit: null,
    squares: letters.map((letter) => {
      const units = Math.max(0, Math.trunc(split[letter] ?? 0));
      const had = boxes.squares.find((s) => s.letter === letter)?.pallets ?? [];
      return {
        letter,
        units,
        pallets: isKid || units > DS_UNITS ? had : stamp(palletsFor(units), letter),
      };
    }),
  };
}

/** ✓ under a square: its pallets become what the rule builds. */
export const acceptRule = (draft: RowDraft, letter: string | null): RowDraft =>
  mapSquare(draft, letter, (s) =>
    s.units > DS_UNITS ? s : { ...s, pallets: stamp(palletsFor(s.units), s.letter) }
  );

/**
 * A figure typed: what stands in the square. An adult square is rebuilt by the
 * rule (25 → base 18 + top 7); a kids square keeps its pallets and the
 * difference shows as loose. More than 30 keeps the pallets (the overflow is
 * offered instead).
 */
export function setSquareUnits(
  draft: RowDraft,
  letter: string | null,
  n: number,
  isKid: boolean
): RowDraft {
  const units = Math.max(0, Math.trunc(n));
  return mapSquare(draft, letter, (s) => ({
    ...s,
    units,
    pallets:
      units === 0
        ? []
        : isKid || !s.letter || units > DS_UNITS
          ? s.pallets
          : stamp(palletsFor(units), s.letter),
  }));
}

const ensureSquare = (draft: RowDraft, letter: string): RowDraft =>
  draft.squares.some((s) => s.letter === letter)
    ? draft
    : { ...draft, squares: [...draft.squares, { letter, units: 0, pallets: [] }].sort(byLetter) };

/**
 * Units of an over-30 square to another letter of the row: up to what that
 * square still has room for (30), each side rebuilt by the rule once it fits.
 */
export function overflowTo(draft: RowDraft, from: string, to: string, isKid: boolean): RowDraft {
  const src = draft.squares.find((s) => s.letter === from);
  if (!src || from === to || src.units <= DS_UNITS) return draft;
  const d = ensureSquare(draft, to);
  const dest = d.squares.find((s) => s.letter === to)!;
  const n = Math.min(src.units - DS_UNITS, Math.max(0, DS_UNITS - dest.units));
  if (n === 0) return draft;
  const rebuilt = (s: DraftSquare, units: number): DraftSquare => ({
    ...s,
    units,
    pallets: !isKid && units <= DS_UNITS ? stamp(palletsFor(units), s.letter) : s.pallets,
  });
  return {
    ...d,
    squares: d.squares.map((s) =>
      s.letter === from ? rebuilt(s, s.units - n) : s.letter === to ? rebuilt(s, s.units + n) : s
    ),
  };
}

/** A pallet's type changed; its bikes stay. */
export const setPalletType = (
  draft: RowDraft,
  letter: string | null,
  index: number,
  type: DistributionItem['type']
): RowDraft =>
  mapSquare(draft, letter, (s) => ({
    ...s,
    pallets: s.pallets.map((p, i) => (i === index ? { ...p, type } : p)),
  }));

/** How many bikes a pallet holds (or how many equal pallets); 0 deletes it. The figure stays. */
export function setPalletNumber(
  draft: RowDraft,
  letter: string | null,
  index: number,
  field: 'units_each' | 'count',
  n: number
): RowDraft {
  const v = Math.max(0, Math.trunc(n));
  return mapSquare(draft, letter, (s) => ({
    ...s,
    pallets:
      v === 0
        ? s.pallets.filter((_, i) => i !== index)
        : s.pallets.map((p, i) => (i === index ? { ...p, [field]: v } : p)),
  }));
}

/** A pallet out of the row's boxes; its bikes stay in the square as loose. */
export const deletePallet = (draft: RowDraft, letter: string | null, index: number): RowDraft =>
  setPalletNumber(draft, letter, index, 'count', 0);

/** A pallet added to a square (a kids bike's loose made a line). */
export const addPallet = (
  draft: RowDraft,
  letter: string | null,
  pallet: DistributionItem
): RowDraft =>
  mapSquare(draft, letter, (s) => ({
    ...s,
    pallets: [...s.pallets, ...stamp([pallet], s.letter)],
  }));

/**
 * One pallet to another letter of the row, its bikes with it (a correction:
 * the floor already has it there). A letter not in the row yet starts a square.
 */
export function movePallet(draft: RowDraft, from: string, index: number, to: string): RowDraft {
  const src = draft.squares.find((s) => s.letter === from);
  const p = src?.pallets[index];
  if (!src || !p || from === to) return draft;
  const n = groupUnits(p);
  const d = ensureSquare(draft, to);
  return {
    ...d,
    squares: d.squares.map((s) =>
      s.letter === from
        ? {
            ...s,
            units: Math.max(0, s.units - n),
            pallets: s.pallets.filter((_, i) => i !== index),
          }
        : s.letter === to
          ? { ...s, units: s.units + n, pallets: [...s.pallets, ...stamp([p], to)] }
          : s
    ),
  };
}

/** Everything in one square to another (Bring forward · B → A). */
export function moveSquare(draft: RowDraft, from: string, to: string): RowDraft {
  const src = draft.squares.find((s) => s.letter === from);
  if (!src || from === to) return draft;
  const d = ensureSquare(draft, to);
  return {
    ...d,
    squares: d.squares.map((s) =>
      s.letter === from
        ? { ...s, units: 0, pallets: [] }
        : s.letter === to
          ? { ...s, units: s.units + src.units, pallets: [...s.pallets, ...stamp(src.pallets, to)] }
          : s
    ),
  };
}

/** The units no pallet covers (+) or pallets beyond the figure (−). */
export const looseOf = (s: DraftSquare): number => s.units - palletUnits(s.pallets);

export const draftQuantity = (draft: RowDraft): number =>
  draft.squares.reduce((n, s) => n + s.units, 0);

/** One square's line in the bar and the confirmation. */
export interface DraftChange {
  square: string;
  before: number;
  after: number;
  palletsBefore: DistributionItem[];
  palletsAfter: DistributionItem[];
}

/** Each square whose figure or pallets changed, A→Z. */
export function draftChanges(base: RowDraft, cur: RowDraft): DraftChange[] {
  if (cur.needsSplit) return [];
  const letters = [...new Set([...base.squares, ...cur.squares].map((s) => s.letter ?? ''))].sort();
  const out: DraftChange[] = [];
  for (const l of letters) {
    const b = base.needsSplit ? undefined : base.squares.find((s) => (s.letter ?? '') === l);
    const c = cur.squares.find((s) => (s.letter ?? '') === l);
    const before = b?.units ?? 0;
    const after = c?.units ?? 0;
    const pb = b?.pallets ?? [];
    const pa = c?.pallets ?? [];
    if (base.needsSplit || before !== after || signature(pb) !== signature(pa)) {
      if (before === 0 && after === 0 && pa.length === 0 && pb.length === 0) continue;
      out.push({ square: l, before, after, palletsBefore: pb, palletsAfter: pa });
    }
  }
  return out;
}

/**
 * What a save writes: the pallets merged in show order, the quantity = the
 * figures added, and the row's letters = the squares with something in them
 * (a square at 0 leaves the row).
 */
export function draftToSave(draft: RowDraft): {
  quantity: number;
  distribution: DistributionItem[];
  sublocation: string[] | null;
} {
  const letters = draft.squares
    .filter((s) => s.letter && s.units > 0)
    .map((s) => s.letter as string)
    .sort();
  const pallets = draft.squares.flatMap((s) => (s.units > 0 ? s.pallets : []));
  const merged = letters.length
    ? squaredGroups(pallets, letters)
    : squaredGroups(stamp(pallets, null), null);
  return {
    quantity: draftQuantity(draft),
    distribution: merged.sort(byShowOrder),
    sublocation: letters.length ? letters : null,
  };
}

/**
 * After a clash, the fresh row underneath and the pending edits on top: a
 * square nobody else touched keeps its edit; one that changed takes the fresh
 * figure (never overwrite someone's count).
 */
export function rebaseDraft(oldBase: RowDraft, cur: RowDraft, fresh: RowDraft): RowDraft {
  if (fresh.needsSplit || cur.needsSplit) return fresh;
  const same = (l: string | null) => {
    const a = oldBase.squares.find((s) => s.letter === l);
    const b = fresh.squares.find((s) => s.letter === l);
    return !oldBase.needsSplit && (a?.units ?? 0) === (b?.units ?? 0);
  };
  const letters = [...new Set([...fresh.squares, ...cur.squares].map((s) => s.letter))];
  return {
    needsSplit: null,
    squares: letters
      .map(
        (l) =>
          (same(l)
            ? cur.squares.find((s) => s.letter === l)
            : fresh.squares.find((s) => s.letter === l)) ?? { letter: l, units: 0, pallets: [] }
      )
      .sort(byLetter),
  };
}
