/* eslint-disable react-refresh/only-export-components */
/**
 * Editing a row's boxes from the Stock card (idea-253, part A;
 * docs/prds/stock-card-edit-and-pick-square.md §4.A). Rafael, 6 Oct 2026:
 * «con banner para hacer el cambio y pidiendo confirmación para guardar,
 * similar a agregar datos en item view».
 *
 * One card at a time. Every change waits in amber; the banner at the bottom
 * says how many and what each square goes from and to; SAVE asks to confirm
 * with the boxes against the quantity; and before writing the row is read
 * again — if someone else changed it, nothing is written (never overwrite).
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import toast from 'react-hot-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import { supabase } from '../../../lib/supabase';
import { useModal } from '../../../context/ModalContext';
import { useConfirmation } from '../../../context/ConfirmationContext';
import { useInventory } from '../hooks/InventoryProvider';
import { flashSyncStatus } from '../../../components/layout/SyncStatusIndicator';
import { squaredGroups } from '../../../utils/boxSquares';
import {
  boxesMismatch,
  boxesToSave,
  overCap,
  squareChanges,
  type SquareChange,
} from '../utils/squareEdit';
import type {
  DistributionItem,
  InventoryItemInput,
  InventoryItemWithMetadata,
} from '../../../schemas/inventory.schema';

interface Conflict {
  by: string | null;
  at: string | null;
  fresh: FreshRow;
}

interface FreshRow {
  quantity: number;
  distribution: DistributionItem[];
  sublocation: string[] | null;
  location: string | null;
}

interface Pending {
  item: InventoryItemWithMetadata;
  base: DistributionItem[];
  cur: DistributionItem[];
  conflict: Conflict | null;
}

interface StockBoxEditValue {
  /** The card being edited, or null. */
  pending: Pending | null;
  /** The groups a card shows: its pending ones, or the saved ones squared. */
  groupsFor: (item: InventoryItemWithMetadata) => DistributionItem[];
  /** Applies one edit to a card's groups (asks first if another card has changes). */
  edit: (
    item: InventoryItemWithMetadata,
    fn: (groups: DistributionItem[]) => DistributionItem[]
  ) => void;
  /** Runs `action` unless another card has changes — then asks first. */
  guard: (itemId: number | string | undefined, action: () => void) => void;
  /** «Bring forward» for a row (idea-253 P3): its buried square and the face it goes to. */
  bringForward: (itemId: number | string | undefined) => BringForward | null;
}

export interface BringForward {
  from: string;
  to: string;
}

const BRING_FORWARD_KEY = ['stock', 'bring-forward'] as const;

const Ctx = createContext<StockBoxEditValue | null>(null);

/** Null outside the Stock screen: the card then shows its boxes read-only. */
export const useStockBoxEdit = () => useContext(Ctx);

const sameGroups = (a: readonly DistributionItem[], b: readonly DistributionItem[]) =>
  JSON.stringify(a) === JSON.stringify(b);

function minutesAgo(iso: string | null): string {
  if (!iso) return '';
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
}

export function StockBoxEditProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const [saving, setSaving] = useState(false);
  const { open, close } = useModal();
  const { showConfirmation } = useConfirmation();
  const { updateItem } = useInventory();
  const queryClient = useQueryClient();

  // Rows of an active SKU whose faces are empty with stock buried behind them.
  const { data: forward } = useQuery({
    queryKey: BRING_FORWARD_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bring_forward_rows');
      if (error) throw error;
      const out = new Map<string, BringForward>();
      for (const r of data ?? []) {
        out.set(String(r.inventory_id), { from: r.from_square, to: r.to_square });
      }
      return out;
    },
    staleTime: 5 * 60_000,
  });
  const bringForward = useCallback<StockBoxEditValue['bringForward']>(
    (itemId) => (itemId == null ? null : (forward?.get(String(itemId)) ?? null)),
    [forward]
  );

  const put = useCallback((p: Pending | null) => {
    pendingRef.current = p;
    setPending(p);
  }, []);

  const discard = useCallback(() => put(null), [put]);

  const askFirst = useCallback(
    (then: () => void) => {
      const p = pendingRef.current;
      if (!p) return then();
      const n = squareChanges(p.base, p.cur).length;
      showConfirmation(
        'Unsaved changes',
        `${n} change${n === 1 ? '' : 's'} on ${p.item.sku}. Save them with the bar below, or discard them.`,
        () => {
          put(null);
          then();
        },
        undefined,
        'Discard',
        'Keep editing',
        'warning'
      );
    },
    [put, showConfirmation]
  );

  const guard = useCallback<StockBoxEditValue['guard']>(
    (itemId, action) => {
      const p = pendingRef.current;
      if (p && String(p.item.id) !== String(itemId)) askFirst(action);
      else action();
    },
    [askFirst]
  );

  const edit = useCallback<StockBoxEditValue['edit']>(
    (item, fn) => {
      const run = () => {
        const p = pendingRef.current;
        const base = p?.base ?? squaredGroups(item.distribution, item.sublocation);
        const cur = fn(p?.cur ?? base);
        put(
          squareChanges(base, cur).length === 0 && !p?.conflict
            ? null
            : { item: p?.item ?? item, base, cur, conflict: p?.conflict ?? null }
        );
      };
      const p = pendingRef.current;
      if (p && String(p.item.id) !== String(item.id)) askFirst(run);
      else run();
    },
    [askFirst, put]
  );

  const groupsFor = useCallback<StockBoxEditValue['groupsFor']>(
    (item) =>
      pending && String(pending.item.id) === String(item.id)
        ? pending.cur
        : squaredGroups(item.distribution, item.sublocation),
    [pending]
  );

  /** Reads the row again; null when it can't. */
  const readFresh = async (id: number | string): Promise<FreshRow | null> => {
    const { data, error } = await supabase
      .from('inventory')
      .select('quantity, distribution, sublocation, location')
      .eq('id', Number(id))
      .maybeSingle();
    if (error || !data) return null;
    return {
      quantity: data.quantity ?? 0,
      distribution: Array.isArray(data.distribution)
        ? (data.distribution as unknown as DistributionItem[])
        : [],
      sublocation: data.sublocation ?? null,
      location: data.location ?? null,
    };
  };

  const write = async () => {
    const p = pendingRef.current;
    if (!p) return;
    setSaving(true);
    try {
      const fresh = await readFresh(p.item.id);
      if (!fresh) throw new Error('Could not read the row again');
      const freshGroups = squaredGroups(fresh.distribution, fresh.sublocation);
      const untouched =
        fresh.quantity === p.item.quantity &&
        (fresh.location ?? '') === (p.item.location ?? '') &&
        sameGroups(freshGroups, p.base);
      if (!untouched) {
        // Someone else changed it: write nothing, say who.
        const { data: log } = await supabase
          .from('inventory_logs')
          .select('performed_by, created_at')
          .eq('item_id', Number(p.item.id))
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        put({
          ...p,
          conflict: { by: log?.performed_by ?? null, at: log?.created_at ?? null, fresh },
        });
        close();
        return;
      }
      const save = boxesToSave(p.cur, p.item.sublocation);
      const original = { ...p.item, ...fresh } as InventoryItemWithMetadata;
      await updateItem(original, {
        sku: p.item.sku,
        location: p.item.location ?? '',
        quantity: fresh.quantity,
        item_name: p.item.item_name,
        warehouse: p.item.warehouse,
        internal_note: p.item.internal_note ?? null,
        sublocation: save.sublocation,
        distribution: save.distribution,
      } as InventoryItemInput);
      put(null);
      close();
      flashSyncStatus('Boxes saved', 1500);
      void queryClient.invalidateQueries({ queryKey: BRING_FORWARD_KEY });
    } catch (e) {
      toast.error(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const requestSave = () => {
    const p = pendingRef.current;
    if (!p) return;
    open({
      type: 'box-edit',
      sheet: {
        kind: 'confirm',
        sku: p.item.sku,
        location: p.item.location ?? '',
        changes: squareChanges(p.base, p.cur),
        boxes: p.cur.reduce((s, d) => s + d.count * d.units_each, 0),
        quantity: p.item.quantity,
        mismatch: boxesMismatch(p.cur, p.item.quantity),
        over: overCap(p.cur),
        onConfirm: write,
      },
    });
  };

  const reload = () => {
    const p = pendingRef.current;
    if (!p?.conflict) return;
    const { fresh } = p.conflict;
    const item = { ...p.item, ...fresh } as InventoryItemWithMetadata;
    // The pending boxes stay on top, still amber; only the base moves.
    put({
      item,
      base: squaredGroups(fresh.distribution, fresh.sublocation),
      cur: p.cur,
      conflict: null,
    });
  };

  const value = useMemo<StockBoxEditValue>(
    () => ({ pending, groupsFor, edit, guard, bringForward }),
    [pending, groupsFor, edit, guard, bringForward]
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {pending && (
        <StockBoxEditBanner
          pending={pending}
          saving={saving}
          onDiscard={discard}
          onSave={requestSave}
          onReload={reload}
        />
      )}
    </Ctx.Provider>
  );
}

function StockBoxEditBanner({
  pending,
  saving,
  onDiscard,
  onSave,
  onReload,
}: {
  pending: Pending;
  saving: boolean;
  onDiscard: () => void;
  onSave: () => void;
  onReload: () => void;
}) {
  const changes = squareChanges(pending.base, pending.cur);
  const n = changes.length;
  const c = pending.conflict;
  return (
    <div
      data-testid="box-edit-banner"
      className="fixed inset-x-0 bottom-24 z-[140] px-3 md:bottom-0 md:pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <div className="mx-auto flex max-w-[430px] flex-col gap-2 rounded-2xl border border-amber-400/40 bg-[#161920]/95 p-3 shadow-xl backdrop-blur">
        <div className="truncate font-mono text-[11px] font-bold text-white/70">
          {c ? (
            <span className="text-amber-300">
              Changed by {c.by ?? 'someone'}
              {c.at ? ` · ${minutesAgo(c.at)}` : ''}
            </span>
          ) : (
            <>
              {pending.item.sku} · {n} change{n === 1 ? '' : 's'}
              {changes.map((ch) => (
                <span key={ch.square} className="text-amber-300">
                  {' · '}
                  <SquareDelta change={ch} />
                </span>
              ))}
            </>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onDiscard}
            className="h-11 flex-1 rounded-xl border border-[#2A2F36] bg-[#0F1115] text-sm font-bold text-white/70 active:scale-[0.98]"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={c ? onReload : onSave}
            disabled={saving}
            className="flex h-11 flex-[1.6] items-baseline justify-center gap-2 rounded-xl bg-amber-400 pt-3 text-sm font-bold text-[#3b2400] active:scale-[0.98] disabled:opacity-60"
          >
            {saving ? (
              <Loader2 size={16} className="animate-spin self-center" />
            ) : c ? (
              'Reload'
            ) : (
              <>
                SAVE
                <span className="font-mono text-[11px] opacity-75">
                  {n} change{n === 1 ? '' : 's'}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/** `F 115→30`, or `115→30` outside a ROW. */
export function SquareDelta({ change }: { change: SquareChange }) {
  return (
    <>
      {change.square ? `${change.square} ` : ''}
      {change.before}→{change.after}
    </>
  );
}
