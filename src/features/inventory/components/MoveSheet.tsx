/**
 * Move — exact numbers per square (idea-255 P1, docs/prds/relocate-stock-redesign.md,
 * mock docs/design/relocate-stock.html). Rafael, 7 Oct 2026: «darles la
 * herramienta para que los usuarios en el piso hagan los movimientos con los
 * números exactos por sublocation… quita LUDLOW… no quiero ver un parecido al
 * anterior, debe ser fácil de entender como item detail».
 *
 * Reads like a sentence: FROM this square, THIS MANY, TO that square, one green
 * button. The pure half is `utils/moveLoad.ts`; `move_stock_squares` writes the
 * two rows as this sheet built them, or nothing if someone changed them first.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import X from 'lucide-react/dist/esm/icons/x';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import ScanLine from 'lucide-react/dist/esm/icons/scan-line';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../context/AuthContext';
import type { Json } from '../../../integrations/supabase/types';
import type {
  DistributionItem,
  InventoryItemWithMetadata,
} from '../../../schemas/inventory.schema';
import { isSmallBikeSku } from '../../../utils/bikeDetection';
import { DS_UNITS } from '../../../utils/distributionCalculator';
import { DistributionGlyph } from './DistributionJengaViz';
import { useWhereChoices, HEADING } from './ItemDetailView/itemCardShared';
import { cardThumbUrl } from '../utils/stockCard';
import { isRowLocation, squaresForRow } from '../utils/registerItem';
import {
  allocate,
  landInRow,
  parseDestination,
  rowOccupancy,
  rowStock,
  stockUnits,
  takeCount,
  takePallets,
  toDistribution,
  type RowLine,
  type RowStock,
  type SquareFill,
} from '../utils/moveLoad';
import { INVENTORY_ROOT_KEY, invalidateInventorySearch } from '../hooks/useInventoryRealtime';

interface Fresh {
  quantity: number;
  location: string | null;
  sublocation: string[] | null;
  /** As the database has it: what the write compares against. */
  raw: Json;
  distribution: DistributionItem[];
}

const asGroups = (d: unknown): DistributionItem[] =>
  Array.isArray(d) ? (d as DistributionItem[]) : [];

const TYPE_WORD: Record<DistributionItem['type'], string> = {
  TOWER: 'tower',
  LINE: 'line',
  PALLET: 'pallet',
  OTHER: 'other',
  BASE: 'base',
  TOP: 'top',
  LINE_PALLET: 'line pallet',
};

/** `base 18 + top 4`, `line pallet 3`, `2×30 tower`. */
const describe = (groups: DistributionItem[]) =>
  groups
    .map((g) => `${TYPE_WORD[g.type]} ${g.count > 1 ? `${g.count}×` : ''}${g.units_each}`)
    .join(' + ');

function minutesAgo(iso: string | null): string {
  if (!iso) return '';
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
}

/** The squares of a row and which are reachable (`row_squares`); A–K for a row not drawn. */
function useRowSquares(location: string | null, used: string[]) {
  const isRow = isRowLocation(location);
  const { data = [] } = useQuery({
    queryKey: ['move-sheet', 'row-squares', location],
    enabled: isRow,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from('row_squares')
        .select('letter, is_fast')
        .eq('location', location as string);
      if (error) throw error;
      return rows ?? [];
    },
  });
  return useMemo(() => {
    const drawn = data.map((r) => r.letter);
    const letters = drawn.length ? [...new Set([...drawn, ...used])].sort() : squaresForRow(used);
    const fast = new Set(data.filter((r) => r.is_fast).map((r) => r.letter));
    return { letters: isRow ? letters : [], fast };
  }, [data, used, isRow]);
}

export function MoveSheet({
  item,
  onClose,
}: {
  item: InventoryItemWithMetadata;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();
  const userName = profile?.full_name || user?.email || 'Warehouse Team';
  const warehouse = item.warehouse ?? 'LUDLOW';
  const isBike = item.sku_metadata?.is_bike !== false;
  const isKid = isSmallBikeSku(item.sku, item.sku_metadata);

  // ── The origin, read again: the write compares against exactly this ──
  const originQuery = useQuery({
    queryKey: ['move-sheet', 'origin', item.id],
    staleTime: 0,
    queryFn: async (): Promise<Fresh> => {
      const { data, error } = await supabase
        .from('inventory')
        .select('quantity, location, sublocation, distribution')
        .eq('id', Number(item.id))
        .single();
      if (error) throw error;
      return {
        quantity: data.quantity ?? 0,
        location: data.location,
        sublocation: data.sublocation,
        raw: data.distribution,
        distribution: asGroups(data.distribution),
      };
    },
  });
  const origin: Fresh = originQuery.data ?? {
    quantity: item.quantity ?? 0,
    location: item.location ?? null,
    sublocation: item.sublocation ?? null,
    raw: (item.distribution ?? []) as unknown as Json,
    distribution: asGroups(item.distribution),
  };
  const fromLoc = origin.location ?? '';

  // ── State ──
  const [split, setSplit] = useState<Record<string, number> | null>(null);
  const [splitText, setSplitText] = useState('');
  const [fromSquare, setFromSquare] = useState<string | null>(null);
  const [picks, setPicks] = useState<Set<number | 'loose'>>(new Set());
  const [typed, setTyped] = useState<number | null>(null);
  const [typing, setTyping] = useState(false);
  const [destText, setDestText] = useState('');
  const [destLoc, setDestLoc] = useState<string | null>(null);
  const [tapped, setTapped] = useState<string[]>([]);
  const [clash, setClash] = useState<{ by: string | null; at: string | null } | null>(null);
  const destInput = useRef<HTMLInputElement>(null);

  const rs = useMemo(
    () =>
      rowStock(
        {
          quantity: origin.quantity,
          location: isBike ? origin.location : null,
          distribution: origin.distribution,
          sublocation: origin.sublocation,
        },
        split
      ),
    [origin.quantity, origin.location, origin.distribution, origin.sublocation, split, isBike]
  );
  const mineLetters = rs.squares.map((s) => s.square).filter((l): l is string => !!l);
  const mineKey = mineLetters.join('');
  const usedAtOrigin = useMemo(() => (mineKey ? mineKey.split('') : []), [mineKey]);
  const fromRow = useRowSquares(isBike ? fromLoc : null, usedAtOrigin);
  const stock =
    rs.squares.find((s) => s.square === fromSquare) ??
    (rs.squares.length === 1 ? rs.squares[0] : null);

  const take = useMemo(() => {
    if (!stock || rs.needsSplit) return null;
    return typed != null ? takeCount(stock, typed) : takePallets(stock, picks);
  }, [stock, rs.needsSplit, typed, picks]);
  const units = take?.load.units ?? 0;

  // ── The destination ──
  const destIsRow = isBike && isRowLocation(destLoc);
  const sameRow = !!destLoc && destLoc.trim().toUpperCase() === fromLoc.trim().toUpperCase();
  const { data: destData, refetch: refetchDest } = useQuery({
    queryKey: ['move-sheet', 'dest', warehouse, destLoc],
    enabled: !!destLoc,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory')
        .select('id, sku, quantity, location, sublocation, distribution')
        .eq('warehouse', warehouse)
        .eq('location', destLoc as string)
        .eq('is_active', true)
        .gt('quantity', 0);
      if (error) throw error;
      return data ?? [];
    },
  });
  const destMine = sameRow
    ? null
    : ((destData ?? []).find((l) => l.sku === item.sku && String(l.id) !== String(item.id)) ??
      null);

  // The origin, as it stays (the same row's squares when moving within it).
  const originAfter = useMemo<RowStock | null>(
    () =>
      take && stock
        ? { squares: rs.squares.map((s) => (s === stock ? take.after : s)), needsSplit: null }
        : null,
    [take, stock, rs.squares]
  );

  const lines: RowLine[] = useMemo(
    () =>
      (destData ?? []).map((l) => {
        const line = {
          sku: l.sku,
          quantity: l.quantity ?? 0,
          location: l.location,
          sublocation: l.sublocation,
          distribution: asGroups(l.distribution),
        };
        if (sameRow && String(l.id) === String(item.id) && originAfter) {
          return {
            ...line,
            quantity: origin.quantity - units,
            distribution: toDistribution(originAfter.squares),
            sublocation: null,
          };
        }
        return line;
      }),
    [destData, sameRow, item.id, originAfter, origin.quantity, units]
  );
  const occupancy = useMemo(() => rowOccupancy(lines, item.sku), [lines, item.sku]);
  const usedAtDest = useMemo(() => [...occupancy.keys()], [occupancy]);
  const destRow = useRowSquares(destIsRow ? destLoc : null, usedAtDest);

  const { land, left } = allocate(
    units,
    tapped,
    new Map([...occupancy].map(([l, f]) => [l, f.units]))
  );

  const destStock: RowStock | null = sameRow
    ? originAfter
    : destMine
      ? rowStock({
          quantity: destMine.quantity ?? 0,
          location: destMine.location,
          sublocation: destMine.sublocation,
          distribution: asGroups(destMine.distribution),
        })
      : null;
  const destGroups =
    destIsRow && take && land.length > 0
      ? landInRow(
          destStock,
          sameRow ? toDistribution(originAfter?.squares ?? []) : asGroups(destMine?.distribution),
          take.load,
          land,
          isKid
        )
      : null;

  // ── Where-to choices: the item card's chips and search ──
  const choices = useWhereChoices({
    enabled: true,
    warehouse,
    sku: item.sku,
    model: item.sku_metadata?.model ?? '',
    location: destLoc,
    query: destText,
  });

  const chooseDest = (text: string) => {
    const parsed = parseDestination(text);
    if (!parsed) return;
    const loc = choices.resolve(parsed.location);
    setDestLoc(loc);
    setDestText('');
    setTapped(parsed.square ? [parsed.square] : []);
  };

  // A load chosen: the scanner's keystrokes land in TO.
  useEffect(() => {
    if (units > 0 && !destLoc) destInput.current?.focus();
  }, [units, destLoc]);

  const pickSquare = (l: string) => {
    setFromSquare(l);
    setPicks(new Set());
    setTyped(null);
  };

  const togglePick = (k: number | 'loose') => {
    setTyped(null);
    setPicks((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const toggleTap = (l: string) =>
    setTapped((prev) => (prev.includes(l) ? prev.filter((x) => x !== l) : [...prev, l]));

  // ── Blockers, in the order the floor meets them ──
  const sameSquare = sameRow && tapped.length > 0 && tapped.every((l) => l === stock?.square);
  const blocker = rs.needsSplit
    ? 'How many in each?'
    : !stock
      ? 'Tap a square'
      : units <= 0
        ? 'What moves?'
        : !destLoc
          ? 'Where to?'
          : destIsRow && tapped.length === 0
            ? 'Tap a square'
            : sameRow && !destIsRow
              ? 'Same place'
              : sameSquare
                ? 'Same place'
                : null;

  // ── The write ──
  const move = useMutation({
    mutationKey: ['inventory', 'moveSquares'],
    mutationFn: async () => {
      if (!take || !destLoc) throw new Error('Nothing to move');
      const originDistribution = toDistribution(originAfter?.squares ?? []);
      const { data, error } = await supabase.rpc('move_stock_squares', {
        p_item_id: Number(item.id),
        p_expected: { quantity: origin.quantity, distribution: origin.raw ?? [] } as Json,
        p_qty: units,
        p_origin_distribution: originDistribution as unknown as Json,
        p_to_location: destLoc,
        p_dest_expected: {
          quantity: destMine?.quantity ?? 0,
          distribution: destMine?.distribution ?? [],
        } as Json,
        p_dest_distribution: (destGroups ?? null) as unknown as Json,
        p_dest_squares: destIsRow ? land.map((l) => l.square) : [],
        p_detail: {
          take: {
            square: take.load.square,
            groups: take.load.groups,
            loose: take.load.loose,
            units,
            typed: typed != null,
          },
          land,
          origin_split: split,
        } as unknown as Json,
        p_performed_by: userName,
        p_user_id: user?.id,
      });
      if (error) throw error;
      return data as { log_id: string };
    },
    onSuccess: async (data) => {
      onClose();
      invalidateInventorySearch(queryClient);
      void queryClient.invalidateQueries({ queryKey: INVENTORY_ROOT_KEY });
      void queryClient.invalidateQueries({ queryKey: ['stock', 'bring-forward'] });
      const where = `${destLoc}${destIsRow ? ` ${land.map((l) => l.square).join(' ')}` : ''}`;
      toast.custom(
        (t) => (
          <div
            className="flex w-[min(406px,calc(100vw-24px))] items-center gap-2.5 rounded-2xl border border-[#2A2F36] bg-[#1b1f27] p-3 shadow-2xl"
            data-testid="move-toast"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400 font-black text-[#062a1d]">
              ✓
            </span>
            <span className="flex-1 font-mono text-xs font-bold leading-snug text-white/75">
              Moved <b className="text-white">{units}</b> · {item.sku}
              <br />
              {fromLoc}
              {stock?.square ? ` ${stock.square}` : ''} → <b className="text-white">{where}</b>
            </span>
            <button
              type="button"
              onClick={async () => {
                toast.dismiss(t.id);
                const { data: r, error } = await supabase.rpc('undo_inventory_action', {
                  target_log_id: data.log_id,
                });
                const res = r as { success?: boolean; message?: string } | null;
                if (error || !res?.success) {
                  toast.error(`Could not undo: ${error?.message ?? res?.message ?? ''}`);
                  return;
                }
                invalidateInventorySearch(queryClient);
                void queryClient.invalidateQueries({ queryKey: INVENTORY_ROOT_KEY });
                toast.success('Move undone');
              }}
              className="rounded-lg border border-amber-400/40 px-3 py-2 font-mono text-xs font-black text-amber-300"
            >
              Undo
            </button>
          </div>
        ),
        { duration: 8000 }
      );
    },
    onError: async (err: Error) => {
      if (!String(err.message).includes('stale:')) {
        toast.error(`Could not move: ${err.message}`);
        return;
      }
      // Someone changed a row first: write nothing, say who.
      const dest = String(err.message).includes('stale:dest');
      const id = dest ? destMine?.id : item.id;
      let q = supabase
        .from('inventory_logs')
        .select('performed_by, created_at')
        .order('created_at', { ascending: false })
        .limit(1);
      q = id != null ? q.eq('item_id', Number(id)) : q.eq('to_location', destLoc ?? '');
      const { data: log } = await q.maybeSingle();
      setClash({ by: log?.performed_by ?? null, at: log?.created_at ?? null });
    },
  });

  const reload = async () => {
    setClash(null);
    const before = stock ? stockUnits(stock) : 0;
    await Promise.all([originQuery.refetch(), refetchDest()]);
    // Lifted pallets are positions in the square: they only survive if it didn't change.
    if (stock && before !== stockUnits(stock)) setPicks(new Set());
  };

  // ── Before → after ──
  const fromLabel = `${fromLoc}${stock?.square ? ` · ${stock.square}` : ''}`;
  const fromBefore = stock ? stockUnits(stock) : 0;
  const fromAfter = take ? stockUnits(take.after) : fromBefore;
  const destLabel = `${destLoc ?? ''}${destIsRow && land.length ? ` · ${land.map((l) => l.square).join(' ')}` : ''}`;
  const destBefore = destIsRow
    ? land.reduce((n, l) => n + (occupancy.get(l.square)?.units ?? 0), 0)
    : sameRow
      ? 0
      : (destMine?.quantity ?? 0);
  const destAfterUnits = destBefore + units;
  const destShared = land.some((l) => (occupancy.get(l.square)?.others ?? 0) > 0);
  const destOver = land.some((l) => (occupancy.get(l.square)?.units ?? 0) + l.units > DS_UNITS);
  const landedShape =
    destIsRow && destGroups && land.length === 1 && !destShared
      ? describe(destGroups.filter((g) => g.square === land[0].square))
      : null;

  const thumb = cardThumbUrl(item.sku_metadata?.image_url);
  const pink = (take?.load.fromTop ?? 0) > 0;
  const name = item.item_name ?? item.sku_metadata?.model ?? '';

  return (
    <div
      className="fixed inset-0 z-[190] flex justify-center bg-black/60"
      data-testid="move-sheet"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-md flex-col bg-[#0c0d12] text-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* The item card's header, small */}
        <div className="flex items-center gap-2.5 px-3 pb-2.5 pt-[max(0.875rem,env(safe-area-inset-top))]">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#2A2F36] bg-[#161920]">
            {thumb ? (
              <img src={thumb} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-xl">{isBike ? '🚲' : '⚙︎'}</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-2xl font-extrabold leading-none tracking-tight" style={HEADING}>
              {item.sku}
            </div>
            <div className="mt-1 truncate text-[11.5px] font-bold uppercase text-white/45">
              {name}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#2A2F36] text-white/50"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3 pb-3">
          {clash && (
            <div className="flex items-center gap-2.5 rounded-2xl border border-amber-500/35 bg-amber-500/10 px-3 py-2.5 font-mono text-[13px] font-extrabold text-amber-300">
              Changed by {clash.by ?? 'someone'}
              {clash.at ? ` · ${minutesAgo(clash.at)}` : ''}
              <button
                type="button"
                onClick={reload}
                className="ml-auto rounded-lg bg-amber-400 px-3 py-2 text-[#3b2400]"
              >
                Reload
              </button>
            </div>
          )}

          {/* FROM */}
          <section className="flex flex-col gap-2.5 rounded-2xl border border-[#2A2F36] bg-[#161920] p-3">
            <span className="text-[10.5px] uppercase tracking-[0.14em] text-white/45">From</span>
            <div className="text-4xl font-extrabold leading-none tracking-tight" style={HEADING}>
              {fromLoc || '—'}
              {stock?.square && (
                <span className="ml-1.5 text-xl text-amber-400">{stock.square}</span>
              )}
              {!isBike && (
                <span className="ml-2 font-mono text-sm font-bold tracking-normal text-white/45">
                  {origin.quantity}
                </span>
              )}
            </div>

            {fromRow.letters.length > 0 && (
              <SquareStrip letters={fromRow.letters}>
                {(l) => {
                  const s = rs.squares.find((x) => x.square === l);
                  const on = stock?.square === l;
                  return (
                    <button
                      key={l}
                      type="button"
                      disabled={!s}
                      onClick={() => s && pickSquare(l)}
                      className={`flex aspect-[1/1.3] min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg border font-mono ${
                        on
                          ? 'border-amber-400 bg-amber-400 text-[#3b2400]'
                          : s
                            ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                            : 'border-[#2A2F36] bg-[#0F1115] text-white/55 opacity-30'
                      }`}
                    >
                      <b className="text-[13px] font-extrabold">{l}</b>
                      <i className="text-[11px] font-bold not-italic">
                        {s ? (rs.needsSplit ? '?' : stockUnits(s)) : '·'}
                      </i>
                    </button>
                  );
                }}
              </SquareStrip>
            )}

            {rs.needsSplit && (
              <SplitAsk
                letters={rs.needsSplit}
                total={origin.quantity}
                text={splitText}
                onText={setSplitText}
                onDone={(m) => {
                  setSplit(m);
                  setFromSquare(null);
                }}
              />
            )}

            {stock && !rs.needsSplit && isBike && (
              <div className="flex flex-wrap items-end gap-2.5 pt-0.5">
                {stock.groups.map((g, i) => {
                  const up = typed == null && picks.has(i);
                  const top = g.type === 'TOP';
                  return (
                    <button
                      key={`${g.type}-${g.units_each}-${i}`}
                      type="button"
                      onClick={() => togglePick(i)}
                      data-testid="move-pallet"
                      className={`flex flex-col items-center gap-1 rounded-xl border-2 px-2 pb-1.5 pt-2 transition-transform ${
                        up
                          ? top
                            ? '-translate-y-1 border-pink-400 bg-pink-400/15'
                            : '-translate-y-1 border-emerald-400 bg-emerald-400/10 shadow-lg'
                          : 'border-transparent'
                      }`}
                    >
                      <span className="flex h-12 w-11 items-end justify-center">
                        <DistributionGlyph
                          type={g.type}
                          unitsEach={g.units_each}
                          showNumber={false}
                        />
                      </span>
                      <span
                        className={`flex items-baseline gap-1 font-mono text-[13px] font-extrabold ${
                          up ? (top ? 'text-pink-300' : 'text-emerald-400') : 'text-white'
                        }`}
                      >
                        {g.count > 1 ? `${g.count}×` : ''}
                        {g.units_each}
                        <em className="text-[10px] font-bold not-italic text-white/45">
                          {TYPE_WORD[g.type]}
                          {top ? ' 🪜' : ''}
                        </em>
                      </span>
                    </button>
                  );
                })}
                {stock.loose > 0 && (
                  <button
                    type="button"
                    onClick={() => togglePick('loose')}
                    className={`flex flex-col items-center gap-1 rounded-xl border-2 px-2 pb-1.5 pt-2 ${
                      typed == null && picks.has('loose')
                        ? '-translate-y-1 border-emerald-400 bg-emerald-400/10'
                        : 'border-transparent'
                    }`}
                  >
                    <span className="mt-1.5 flex h-10 w-10 items-center justify-center rounded-lg border-[1.5px] border-dashed border-amber-400 font-mono text-[10px] font-extrabold text-amber-400">
                      {stock.loose}
                    </span>
                    <span className="flex items-baseline gap-1 font-mono text-[13px] font-extrabold text-amber-400">
                      {stock.loose}
                      <em className="text-[10px] font-bold not-italic text-white/45">loose</em>
                    </span>
                  </button>
                )}
              </div>
            )}
          </section>

          {/* THE LOAD */}
          {stock && !rs.needsSplit && (
            <div className="flex flex-col items-center gap-1 py-1">
              <div className="flex items-center gap-3.5">
                {typing ? (
                  <input
                    autoFocus
                    inputMode="numeric"
                    aria-label="How many move"
                    defaultValue={units || ''}
                    onFocus={(e) => e.target.select()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                    onBlur={(e) => {
                      const n = Number(e.target.value.replace(/\D/g, ''));
                      setTyped(n > 0 ? Math.min(n, stockUnits(stock)) : null);
                      if (n > 0) setPicks(new Set());
                      setTyping(false);
                    }}
                    className="w-40 rounded-2xl bg-transparent text-center text-7xl font-extrabold tabular-nums text-white outline-none ring-2 ring-amber-400"
                    style={HEADING}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setTyping(true)}
                    data-testid="move-figure"
                    className={`rounded-2xl px-2.5 text-7xl font-extrabold leading-[0.9] tabular-nums tracking-tighter ${
                      units === 0 ? 'text-white/25' : pink ? 'text-pink-400' : 'text-emerald-400'
                    } ${typed != null ? 'ring-2 ring-amber-400' : ''}`}
                    style={HEADING}
                  >
                    {units || '?'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setTyped(stockUnits(stock));
                    setPicks(new Set());
                  }}
                  className={`h-8 rounded-lg border px-3 font-mono text-xs font-extrabold ${
                    units > 0 && units === stockUnits(stock)
                      ? 'border-emerald-400 text-emerald-400'
                      : 'border-[#2A2F36] bg-[#0F1115] text-slate-300'
                  }`}
                >
                  All {stockUnits(stock)}
                </button>
              </div>
              {take && units > 0 && (
                <div className="text-center font-mono text-xs font-bold text-white/45">
                  {pink ? (
                    <span className="text-pink-400">
                      {take.load.fromTop} from top 🪜 · top {take.load.topBefore} →{' '}
                      {take.load.topAfter}
                    </span>
                  ) : (
                    <b className="text-white">
                      {describe(take.load.groups) || ''}
                      {take.load.loose > 0
                        ? `${take.load.groups.length ? ' + ' : ''}${take.load.loose} loose`
                        : ''}
                    </b>
                  )}
                  {' · '}
                  {stock.square ?? fromLoc} {fromBefore} → {fromAfter}
                </div>
              )}
            </div>
          )}

          {/* TO */}
          {stock && !rs.needsSplit && (
            <section
              className={`flex flex-col gap-2.5 rounded-2xl border bg-[#161920] p-3 ${
                units > 0 ? 'border-white' : 'border-[#2A2F36]'
              }`}
            >
              <span className="flex items-center gap-2 text-[10.5px] uppercase tracking-[0.14em] text-white/45">
                To
                {left > 0 && (
                  <span className="ml-auto animate-pulse rounded-full bg-amber-400 px-2.5 py-1 font-mono text-[11px] font-extrabold normal-case tracking-normal text-[#3b2400]">
                    {left} left · tap a square
                  </span>
                )}
              </span>
              {destLoc ? (
                <button
                  type="button"
                  onClick={() => {
                    setDestLoc(null);
                    setTapped([]);
                    setTimeout(() => destInput.current?.focus(), 0);
                  }}
                  className="text-left text-4xl font-extrabold leading-none tracking-tight"
                  style={HEADING}
                  data-testid="move-dest"
                >
                  {destLoc}
                  {land.length > 0 && destIsRow && (
                    <span className="ml-1.5 text-xl text-amber-400">
                      {land.map((l) => l.square).join(' ')}
                    </span>
                  )}
                </button>
              ) : (
                <label className="flex h-14 items-center gap-2.5 rounded-xl border-2 border-emerald-400 bg-[#0F1115] px-3.5">
                  <input
                    ref={destInput}
                    value={destText}
                    onChange={(e) => setDestText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && destText.trim()) chooseDest(destText);
                    }}
                    placeholder="Scan or type — 34, 30F"
                    aria-label="Where to"
                    data-testid="move-dest-input"
                    className="min-w-0 flex-1 bg-transparent text-2xl font-extrabold uppercase tracking-tight text-white outline-none placeholder:text-lg placeholder:normal-case placeholder:text-white/25"
                    style={HEADING}
                  />
                  <span className="flex items-center gap-1 rounded-lg border border-[#2A2F36] px-2 py-1.5 font-mono text-[11px] font-extrabold text-white/45">
                    <ScanLine size={13} /> SCAN
                  </span>
                </label>
              )}
              {!destLoc && (
                <div className="flex flex-wrap gap-1.5">
                  {(destText.trim()
                    ? choices.results.map((l) => ({ location: l, why: '' }))
                    : choices.chips
                  )
                    .filter((c) => c.location.toUpperCase() !== fromLoc.toUpperCase())
                    .map((c) => (
                      <button
                        key={c.location}
                        type="button"
                        onClick={() => chooseDest(c.location)}
                        className="rounded-full border border-[#2A2F36] bg-[#0F1115] px-3 py-1.5 font-mono text-xs font-extrabold text-white"
                      >
                        {c.location}
                        {c.why && <span className="ml-1 font-medium text-white/45">{c.why}</span>}
                      </button>
                    ))}
                </div>
              )}
              {destIsRow && destRow.letters.length > 0 && (
                <SquareStrip letters={destRow.letters}>
                  {(l) => (
                    <DestSquare
                      key={l}
                      letter={l}
                      fill={occupancy.get(l)}
                      fast={destRow.fast.has(l)}
                      landing={land.find((x) => x.square === l)?.units ?? 0}
                      on={tapped.includes(l)}
                      from={sameRow && stock?.square === l}
                      onTap={() => toggleTap(l)}
                    />
                  )}
                </SquareStrip>
              )}
              {landedShape && (
                <div className="font-mono text-[11.5px] text-white/45">
                  {land[0].square} becomes <span className="text-white">{landedShape}</span>
                </div>
              )}
            </section>
          )}
        </div>

        {/* Before → after, and the one button */}
        <div className="flex flex-col gap-2 bg-[#0c0d12] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
          {!blocker && (
            <div className="grid grid-cols-2 gap-1.5">
              <div className="rounded-xl border border-[#2A2F36] px-2.5 py-1.5 font-mono text-xs font-bold text-white/45">
                <span className="block text-[10.5px]">{fromLabel}</span>
                <b className="text-white">{fromBefore}</b> →{' '}
                <span className="font-extrabold text-emerald-400">{fromAfter}</span>
              </div>
              <div className="rounded-xl border border-[#2A2F36] px-2.5 py-1.5 font-mono text-xs font-bold text-white/45">
                <span className="block truncate text-[10.5px]">{destLabel}</span>
                <b className="text-white">{destBefore}</b> →{' '}
                <span
                  className={`font-extrabold ${
                    destOver ? 'text-red-400' : destShared ? 'text-white/60' : 'text-emerald-400'
                  }`}
                >
                  {destAfterUnits}
                  {destOver ? ` > ${DS_UNITS}` : destShared ? ' shared' : ''}
                </span>
              </div>
            </div>
          )}
          <button
            type="button"
            disabled={!!blocker || move.isPending || !!clash}
            onClick={() => move.mutate()}
            data-testid="move-go"
            className={`flex h-14 items-center justify-center gap-2.5 rounded-2xl text-lg font-extrabold ${
              blocker || clash
                ? 'bg-[#1d2028] text-white/35'
                : 'bg-emerald-400 text-[#062a1d] active:scale-[0.98]'
            }`}
            style={HEADING}
          >
            {move.isPending ? (
              <Loader2 size={20} className="animate-spin" />
            ) : clash ? (
              'Reload first'
            ) : (
              (blocker ?? `Move ${units} → ${destLabel}`)
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/** A row's squares in one line (two when there are 12 or more). */
function SquareStrip({
  letters,
  children,
}: {
  letters: string[];
  children: (l: string) => React.ReactNode;
}) {
  const cols = letters.length >= 12 ? Math.ceil(letters.length / 2) : letters.length;
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {letters.map((l) => children(l))}
    </div>
  );
}

function DestSquare({
  letter,
  fill,
  fast,
  landing,
  on,
  from,
  onTap,
}: {
  letter: string;
  fill: SquareFill | undefined;
  fast: boolean;
  landing: number;
  on: boolean;
  from: boolean;
  onTap: () => void;
}) {
  const units = fill?.units ?? 0;
  const empty = units === 0;
  const other = (fill?.others ?? 0) > 0;
  const mine = (fill?.mine ?? 0) > 0 && !other;
  const after = units + landing;
  const over = (on ? after : units) > DS_UNITS;
  return (
    <button
      type="button"
      onClick={onTap}
      disabled={from && !on}
      data-testid={`move-square-${letter}`}
      className={`relative flex aspect-[1/1.3] min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg font-mono ${
        on
          ? 'border-2 border-white bg-[#1c2a24]'
          : from
            ? 'border border-amber-400 bg-amber-400/20 opacity-60'
            : empty
              ? 'border border-dashed border-[#3a404a] bg-[#0F1115]'
              : mine
                ? 'border border-amber-500/40 bg-amber-500/10'
                : 'border border-[#2A2F36] bg-[repeating-linear-gradient(135deg,#181b22_0_5px,#20242c_5px_10px)]'
      }`}
    >
      {on && landing > 0 && (
        <span
          className={`absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[9.5px] font-extrabold leading-none ${
            over ? 'bg-red-500 text-white' : 'bg-emerald-400 text-[#062a1d]'
          }`}
        >
          +{landing}
        </span>
      )}
      {empty && fast && !on && (
        <span className="absolute right-1 top-1 h-[5px] w-[5px] rounded-full bg-emerald-400" />
      )}
      <b
        className={`text-[13px] font-extrabold ${on ? 'text-white' : mine ? 'text-amber-400' : 'text-white/55'}`}
      >
        {letter}
      </b>
      <i
        className={`text-[11px] font-bold not-italic ${
          over
            ? 'text-red-400'
            : on
              ? 'text-emerald-400'
              : mine
                ? 'text-amber-400'
                : 'text-white/45'
        }`}
      >
        {on ? after : units || '·'}
      </i>
      {other && (fill?.others ?? 0) > 1 && (
        <span className="text-[8.5px] text-white/45">{fill?.others} SKUs</span>
      )}
    </button>
  );
}

/** «How many in B?» — once, for a row with several squares nobody split. */
function SplitAsk({
  letters,
  total,
  text,
  onText,
  onDone,
}: {
  letters: string[];
  total: number;
  text: string;
  onText: (t: string) => void;
  onDone: (split: Record<string, number>) => void;
}) {
  // Asked one square at a time, all but the last; the last is the rest.
  const answers = text ? text.split(',').map(Number) : [];
  const i = answers.length;
  const used = answers.reduce((a, b) => a + b, 0);
  const [cur, setCur] = useState('');
  const ask = letters[i];
  const commit = () => {
    const n = Math.max(0, Math.min(Number(cur) || 0, total - used));
    const next = [...answers, n];
    setCur('');
    if (next.length === letters.length - 1) {
      const rest = total - next.reduce((a, b) => a + b, 0);
      const out: Record<string, number> = {};
      letters.forEach((l, k) => (out[l] = k < next.length ? next[k] : rest));
      onText('');
      onDone(out);
    } else onText(next.join(','));
  };
  return (
    <form
      className="flex flex-col gap-2 rounded-2xl border-2 border-amber-400 bg-amber-500/5 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
    >
      <span className="text-2xl font-extrabold leading-none" style={HEADING}>
        How many in <b className="text-amber-400">{ask}</b>?
      </span>
      <div className="flex items-center gap-2 font-mono text-sm font-extrabold text-white/45">
        <span>{total} in all ·</span>
        {letters.map((l, k) => (
          <span key={l}>
            {l}{' '}
            {k < i ? (
              <b className="text-white">{answers[k]}</b>
            ) : k === i ? (
              <input
                autoFocus
                inputMode="numeric"
                value={cur}
                aria-label={`Units in ${l}`}
                onChange={(e) => setCur(e.target.value.replace(/\D/g, ''))}
                className="w-14 border-b-2 border-amber-400 bg-transparent text-center text-amber-300 outline-none"
              />
            ) : k === letters.length - 1 ? (
              <b className="text-white">{Math.max(0, total - used - (Number(cur) || 0))}</b>
            ) : (
              '…'
            )}
          </span>
        ))}
      </div>
      <button
        type="submit"
        disabled={cur === ''}
        className="h-11 rounded-xl bg-amber-400 font-bold text-[#3b2400] disabled:opacity-40"
      >
        OK
      </button>
      <span className="text-xs text-white/45">
        Asked once: the boxes go where you say, and the row stays split.
      </span>
    </form>
  );
}
