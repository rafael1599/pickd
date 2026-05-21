import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Save from 'lucide-react/dist/esm/icons/save';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import Flame from 'lucide-react/dist/esm/icons/flame';
import { supabase } from '../../../lib/supabase';
import { useSlotLayout } from './useSlotLayout';
import { useSlotFillCandidates, type CandidateRow } from './useSlotFillCandidates';
import { parseRpcSlotId } from './slotsToRpcInput';
import {
  SLOT_DEFAULTS,
  makeId,
  type Slot,
  type SlotGroup,
  type SlotLayout,
  type SlotType,
} from './types';

/**
 * Slot-fill tab — operator defines empty slots in an active row, sees
 * ranked SKU candidates from slow zone to fill them. Backed by the
 * exponential-decay RPC from PR #93.
 *
 * Layout decisions:
 *  - Vertical list of groups; each group renders its slots as
 *    horizontal blocks to convey "these are adjacent in the row".
 *  - Quick-add buttons for the common shapes (+Tower, +2L, +3L, +4L,
 *    +Custom).
 *  - Same-SKU toggle per group (Rafael's ROW 4 case).
 *  - Save button persists per-row so the next visit auto-loads.
 *  - Candidate table updates live as the operator edits.
 */

const DEFAULT_WAREHOUSE = 'LUDLOW';
const ACTIVE_ROWS_FOR_PICKER: string[] = [
  'ROW 1',
  'ROW 2',
  'ROW 3',
  'ROW 4',
  'ROW 5',
  'ROW 6',
  'ROW 7',
  'ROW 8',
  'ROW 9',
  'ROW 10',
  'ROW 16',
];

export const SlotFillTab: React.FC = () => {
  const [rowName, setRowName] = useState<string | null>(null);

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <RowPicker value={rowName} onChange={setRowName} />
      {rowName ? <SlotFillBody warehouse={DEFAULT_WAREHOUSE} rowName={rowName} /> : null}
    </div>
  );
};

// ─── Row picker ────────────────────────────────────────────────────

const RowPicker: React.FC<{
  value: string | null;
  onChange: (row: string) => void;
}> = ({ value, onChange }) => (
  <div>
    <label className="block text-[10px] font-black uppercase tracking-widest text-muted mb-2">
      Target row
    </label>
    <div className="flex flex-wrap gap-2">
      {ACTIVE_ROWS_FOR_PICKER.map((r) => (
        <button
          key={r}
          onClick={() => onChange(r)}
          className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-colors ${
            value === r
              ? 'bg-accent text-main'
              : 'bg-card border border-subtle text-muted hover:text-content'
          }`}
        >
          {r}
        </button>
      ))}
    </div>
  </div>
);

// ─── Body (per row) ────────────────────────────────────────────────

const SlotFillBody: React.FC<{ warehouse: string; rowName: string }> = ({ warehouse, rowName }) => {
  const { layout, isLoading, save, isSaving } = useSlotLayout(warehouse, rowName);
  // Local working copy so edits are instant and we don't refetch on
  // every keystroke. Reset whenever the underlying row changes via
  // a key prop on the body.
  return (
    <SlotFillBodyInner
      key={`${warehouse}:${rowName}`}
      rowName={rowName}
      initial={layout}
      isLoading={isLoading}
      onSave={save}
      isSaving={isSaving}
    />
  );
};

const SlotFillBodyInner: React.FC<{
  rowName: string;
  initial: SlotLayout;
  isLoading: boolean;
  onSave: (l: SlotLayout) => void;
  isSaving: boolean;
}> = ({ rowName, initial, isLoading, onSave, isSaving }) => {
  const [groups, setGroups] = useState<SlotGroup[]>(initial.groups);
  const isDirty = useMemo(
    () => JSON.stringify(groups) !== JSON.stringify(initial.groups),
    [groups, initial.groups]
  );

  const candidates = useSlotFillCandidates({ groups });
  const totalCapacity = useMemo(
    () =>
      groups.reduce(
        (acc, g) => ({
          min: acc.min + g.slots.reduce((s, x) => s + x.min_qty, 0),
          max: acc.max + g.slots.reduce((s, x) => s + x.max_qty, 0),
        }),
        { min: 0, max: 0 }
      ),
    [groups]
  );

  // Conflict feedback: SKUs already in the target row (or anywhere
  // active) get flagged. The RPC excludes them, but we surface a
  // hint so the operator understands why a SKU they'd expect isn't
  // showing up.
  const { data: skusInRow = [] } = useQuery({
    queryKey: ['slot-fill-skus-in-row', rowName],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory')
        .select('sku')
        .eq('location', rowName)
        .eq('is_active', true)
        .gt('quantity', 0);
      if (error) throw error;
      return (data ?? []).map((r) => r.sku).filter(Boolean) as string[];
    },
  });

  return (
    <div className="space-y-4">
      {/* Header strip with totals + save */}
      <div className="flex items-center justify-between bg-card border border-subtle rounded-xl px-3 py-2">
        <div className="text-xs text-muted">
          {groups.length === 0 ? (
            <span className="italic">Empty layout — add a group below to start.</span>
          ) : (
            <>
              <span className="font-black text-content">
                {groups.length} group{groups.length === 1 ? '' : 's'}
              </span>
              {' · '}
              <span className="font-black text-content">
                {totalCapacity.min}–{totalCapacity.max}u
              </span>{' '}
              capacity
              {skusInRow.length > 0 && (
                <>
                  {' · '}
                  <span title={skusInRow.join(', ')} className="text-amber-400">
                    {skusInRow.length} SKU{skusInRow.length === 1 ? '' : 's'} already in {rowName}
                  </span>
                </>
              )}
            </>
          )}
        </div>
        <button
          onClick={() => onSave({ groups })}
          disabled={!isDirty || isSaving || isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-main font-black uppercase tracking-widest text-[10px] disabled:opacity-30 active:scale-95 transition-all"
        >
          <Save size={12} />
          {isSaving ? 'Saving…' : 'Save layout'}
        </button>
      </div>

      {/* Groups */}
      <div className="space-y-3">
        {groups.map((g, gi) => (
          <GroupCard
            key={g.id}
            group={g}
            index={gi}
            onChange={(next) => setGroups((prev) => prev.map((gg) => (gg.id === g.id ? next : gg)))}
            onRemove={() => setGroups((prev) => prev.filter((gg) => gg.id !== g.id))}
          />
        ))}
      </div>

      {/* Add-group quick actions */}
      <AddGroupBar onAdd={(g) => setGroups((prev) => [...prev, g])} />

      {/* Candidates */}
      <CandidateSection
        groups={groups}
        loading={candidates.isLoading || candidates.isFetching}
        error={candidates.error}
        rows={candidates.data ?? []}
      />
    </div>
  );
};

// ─── Group card ────────────────────────────────────────────────────

const GroupCard: React.FC<{
  group: SlotGroup;
  index: number;
  onChange: (next: SlotGroup) => void;
  onRemove: () => void;
}> = ({ group, index, onChange, onRemove }) => {
  const addSlot = (type: SlotType) => {
    const defaults = SLOT_DEFAULTS[type];
    const slot: Slot = { id: makeId('s'), type, ...defaults };
    onChange({ ...group, slots: [...group.slots, slot] });
  };

  const updateSlot = (slotId: string, patch: Partial<Slot>) =>
    onChange({
      ...group,
      slots: group.slots.map((s) => (s.id === slotId ? { ...s, ...patch } : s)),
    });

  const removeSlot = (slotId: string) =>
    onChange({ ...group, slots: group.slots.filter((s) => s.id !== slotId) });

  return (
    <div className="bg-card border border-subtle rounded-2xl p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <input
          value={group.label ?? ''}
          onChange={(e) => onChange({ ...group, label: e.target.value || undefined })}
          placeholder={`Group ${index + 1}`}
          className="flex-1 bg-transparent text-sm font-black uppercase tracking-tight text-content placeholder:text-muted/50 focus:outline-none"
        />
        <label className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-muted cursor-pointer select-none">
          <input
            type="checkbox"
            checked={group.same_sku}
            onChange={(e) => onChange({ ...group, same_sku: e.target.checked })}
            className="rounded border-neutral-600 bg-surface text-accent h-3.5 w-3.5"
          />
          Same SKU
        </label>
        <button
          onClick={onRemove}
          aria-label="Remove group"
          className="p-1.5 rounded-lg text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Slot strip */}
      <div className="flex flex-wrap gap-2">
        {group.slots.map((s) => (
          <SlotChip
            key={s.id}
            slot={s}
            onChange={(p) => updateSlot(s.id, p)}
            onRemove={() => removeSlot(s.id)}
          />
        ))}
        <SlotQuickAdd onAdd={addSlot} />
      </div>
    </div>
  );
};

// ─── Slot chip (one block) ─────────────────────────────────────────

const SLOT_COLORS: Record<SlotType, string> = {
  tower: 'bg-purple-500/10 border-purple-500/40 text-purple-200',
  line: 'bg-emerald-500/10 border-emerald-500/40 text-emerald-200',
  custom: 'bg-amber-500/10 border-amber-500/40 text-amber-200',
};

const SLOT_LABEL: Record<SlotType, string> = {
  tower: 'Tower',
  line: 'Line',
  custom: 'Custom',
};

const SlotChip: React.FC<{
  slot: Slot;
  onChange: (patch: Partial<Slot>) => void;
  onRemove: () => void;
}> = ({ slot, onChange, onRemove }) => (
  <div
    className={`relative flex flex-col items-center justify-center rounded-xl border-2 px-3 py-2 min-w-[88px] ${SLOT_COLORS[slot.type]}`}
  >
    <span className="text-[10px] font-black uppercase tracking-widest">
      {SLOT_LABEL[slot.type]}
    </span>
    <div className="flex items-center gap-1 text-xs font-black mt-0.5">
      <input
        type="number"
        value={slot.min_qty}
        min={1}
        onChange={(e) => onChange({ min_qty: Math.max(1, Number(e.target.value) || 0) })}
        className="w-8 bg-transparent text-center focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <span>–</span>
      <input
        type="number"
        value={slot.max_qty}
        min={1}
        onChange={(e) => onChange({ max_qty: Math.max(1, Number(e.target.value) || 0) })}
        className="w-8 bg-transparent text-center focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <span className="opacity-60">u</span>
    </div>
    <button
      onClick={onRemove}
      aria-label="Remove slot"
      className="absolute -top-1 -right-1 w-4 h-4 bg-card border border-subtle rounded-full text-muted hover:text-red-400 flex items-center justify-center text-[10px]"
    >
      ×
    </button>
  </div>
);

const SlotQuickAdd: React.FC<{ onAdd: (type: SlotType) => void }> = ({ onAdd }) => (
  <div className="flex items-center gap-1">
    <button
      onClick={() => onAdd('tower')}
      className="px-2 py-1.5 rounded-lg border border-dashed border-purple-500/40 text-purple-300/70 hover:text-purple-200 hover:border-purple-500/60 text-[10px] font-black uppercase tracking-widest transition-colors"
    >
      + Tower
    </button>
    <button
      onClick={() => onAdd('line')}
      className="px-2 py-1.5 rounded-lg border border-dashed border-emerald-500/40 text-emerald-300/70 hover:text-emerald-200 hover:border-emerald-500/60 text-[10px] font-black uppercase tracking-widest transition-colors"
    >
      + Line
    </button>
    <button
      onClick={() => onAdd('custom')}
      className="px-2 py-1.5 rounded-lg border border-dashed border-amber-500/40 text-amber-300/70 hover:text-amber-200 hover:border-amber-500/60 text-[10px] font-black uppercase tracking-widest transition-colors"
    >
      + Custom
    </button>
  </div>
);

// ─── Add-group quick actions ───────────────────────────────────────

const AddGroupBar: React.FC<{ onAdd: (g: SlotGroup) => void }> = ({ onAdd }) => {
  const newGroup = (label: string, slots: Slot[], sameSku = false): SlotGroup => ({
    id: makeId('g'),
    label,
    same_sku: sameSku,
    slots,
  });

  const tower = (): Slot => ({ id: makeId('s'), type: 'tower', ...SLOT_DEFAULTS.tower });
  const line = (): Slot => ({ id: makeId('s'), type: 'line', ...SLOT_DEFAULTS.line });

  return (
    <div className="flex flex-wrap items-center gap-2 bg-card/40 border border-dashed border-subtle rounded-2xl p-3">
      <span className="text-[10px] font-black uppercase tracking-widest text-muted mr-1 flex items-center gap-1">
        <Plus size={12} /> Add group
      </span>
      <button
        onClick={() => onAdd(newGroup('1 Tower', [tower()]))}
        className="px-2.5 py-1.5 rounded-lg bg-surface border border-subtle text-xs font-black uppercase tracking-wider text-content hover:border-accent"
      >
        1T
      </button>
      <button
        onClick={() => onAdd(newGroup('2 Towers (same SKU)', [tower(), tower()], true))}
        className="px-2.5 py-1.5 rounded-lg bg-surface border border-subtle text-xs font-black uppercase tracking-wider text-content hover:border-accent"
      >
        2T same
      </button>
      <button
        onClick={() => onAdd(newGroup('2 Lines', [line(), line()]))}
        className="px-2.5 py-1.5 rounded-lg bg-surface border border-subtle text-xs font-black uppercase tracking-wider text-content hover:border-accent"
      >
        2L
      </button>
      <button
        onClick={() => onAdd(newGroup('3 Lines', [line(), line(), line()]))}
        className="px-2.5 py-1.5 rounded-lg bg-surface border border-subtle text-xs font-black uppercase tracking-wider text-content hover:border-accent"
      >
        3L
      </button>
      <button
        onClick={() => onAdd(newGroup('4 Lines', [line(), line(), line(), line()]))}
        className="px-2.5 py-1.5 rounded-lg bg-surface border border-subtle text-xs font-black uppercase tracking-wider text-content hover:border-accent"
      >
        4L
      </button>
      <button
        onClick={() =>
          onAdd(newGroup('Tower + 2 Lines (same SKU)', [tower(), line(), line()], true))
        }
        className="px-2.5 py-1.5 rounded-lg bg-surface border border-subtle text-xs font-black uppercase tracking-wider text-content hover:border-accent"
      >
        T+2L same
      </button>
      <button
        onClick={() => onAdd(newGroup('Empty group', []))}
        className="px-2.5 py-1.5 rounded-lg bg-surface border border-subtle text-xs font-black uppercase tracking-wider text-muted hover:text-content"
      >
        Empty
      </button>
    </div>
  );
};

// ─── Candidate section ─────────────────────────────────────────────

const CandidateSection: React.FC<{
  groups: SlotGroup[];
  loading: boolean;
  error: unknown;
  rows: CandidateRow[];
}> = ({ groups, loading, error, rows }) => {
  // Hooks before any early return — rules-of-hooks.
  const byGroup = useMemo(() => {
    const map = new Map<
      string,
      { kind: 'aggregated' | 'slot'; slotId?: string; rows: CandidateRow[] }[]
    >();
    for (const r of rows) {
      const parsed = parseRpcSlotId(r.slot_id);
      if (!parsed) continue;
      const bucket = map.get(parsed.groupId) ?? [];
      const key = parsed.kind === 'aggregated' ? 'agg' : `slot:${parsed.slotId}`;
      let entry = bucket.find(
        (b) =>
          (parsed.kind === 'aggregated' && b.kind === 'aggregated') ||
          (parsed.kind === 'slot' && b.kind === 'slot' && b.slotId === parsed.slotId)
      );
      if (!entry) {
        entry =
          parsed.kind === 'aggregated'
            ? { kind: 'aggregated', rows: [] }
            : { kind: 'slot', slotId: parsed.slotId, rows: [] };
        bucket.push(entry);
      }
      entry.rows.push(r);
      map.set(parsed.groupId, bucket);
      // suppress unused var lint for `key` — it documents intent
      void key;
    }
    return map;
  }, [rows]);

  if (groups.length === 0) return null;

  return (
    <div className="bg-card border border-subtle rounded-2xl p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-black uppercase tracking-widest text-content flex items-center gap-1.5">
          <Flame size={14} className="text-orange-400" />
          Candidate SKUs
        </h3>
        {loading && <span className="text-[10px] text-muted">Loading…</span>}
      </div>

      {error ? (
        <p className="text-xs text-red-400">
          {(error as Error).message || 'Failed to load candidates'}
        </p>
      ) : null}

      {groups.map((g, gi) => {
        const entries = byGroup.get(g.id) ?? [];
        const groupLabel = g.label || `Group ${gi + 1}`;
        return (
          <div key={g.id} className="space-y-2">
            <h4 className="text-[11px] font-black uppercase tracking-widest text-muted">
              {groupLabel}
              {g.same_sku && <span className="ml-2 text-purple-400">· same SKU</span>}
            </h4>
            {entries.length === 0 && !loading ? (
              <p className="text-[11px] text-muted/70 italic">
                No candidates match this group's slots.
              </p>
            ) : null}
            {entries.map((entry, ei) => {
              const subtitle =
                entry.kind === 'aggregated'
                  ? `Aggregated (${g.slots.length} slots together)`
                  : `Slot ${ei + 1}`;
              return (
                <div key={ei} className="ml-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted/80 mb-1">
                    {subtitle}
                  </p>
                  <div className="space-y-1">
                    {entry.rows.map((r, ri) => (
                      <CandidateRowItem key={`${r.sku}-${ri}`} row={r} rank={ri + 1} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};

const CandidateRowItem: React.FC<{ row: CandidateRow; rank: number }> = ({ row, rank }) => (
  <div className="flex items-center justify-between gap-2 bg-surface border border-subtle rounded-lg px-3 py-2">
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-[10px] font-black text-muted w-4 text-right">{rank}</span>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono font-black text-sm text-content truncate">{row.sku}</span>
          <span className="text-[10px] text-muted truncate">{row.item_name ?? ''}</span>
        </div>
        <div className="text-[10px] text-muted/70 mt-0.5">
          {row.current_row} · {row.current_qty}u · {row.orders_30d}o/30d · {row.orders_90d}o/90d
        </div>
      </div>
    </div>
    <div
      className="shrink-0 text-right"
      title="Velocity score (recency-weighted units). Higher = more shipping pressure now."
    >
      <div className="flex items-center justify-end gap-1 text-orange-300 font-black text-sm">
        <Flame size={12} /> {Math.round(row.velocity_score)}
      </div>
      <div className="text-[9px] text-muted/70 uppercase tracking-widest">
        fit {Math.round(row.fit_precision * 100)}%
      </div>
    </div>
  </div>
);
