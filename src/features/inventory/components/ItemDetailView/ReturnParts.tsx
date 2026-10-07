/**
 * The FedEx return's own pieces of the item card (docs/prds/fedex-return-card.md):
 * what it is (RMA, model, misship, how long it has waited) and where it goes
 * (RESOLVE: back to stock, S/D, dispose). The card draws the rest — the label,
 * Where, the note — as it does for any unit.
 */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Search from 'lucide-react/dist/esm/icons/search';

import { useDebounce } from '../../../../hooks/useDebounce';
import { inventoryApi } from '../../api/inventoryApi';
import type { ResolveAction } from '../../api/resolveReturn';
import type { InventoryItemWithMetadata } from '../../../../schemas/inventory.schema';
import type { ReturnState } from '../../utils/itemCardEdit';
import { DISPOSE_REASONS } from '../../utils/returnCard';
import { WherePicker } from './ItemCardParts.tsx';
import { useWhereChoices } from './itemCardShared';

// ── What it is ──────────────────────────────────────────────────────────────

export const ReturnFacts: React.FC<{
  ret: ReturnState;
  days: number | null;
  changed: { rma: boolean; model: boolean; misship: boolean };
  onRma: () => void;
  onModel: () => void;
  onMisship: () => void;
}> = ({ ret, days, changed, onRma, onModel, onMisship }) => {
  const dot = (on: boolean) =>
    on ? <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-amber-400" /> : null;
  const row = (label: string, value: React.ReactNode, on: boolean, onTap: () => void) => (
    <button
      type="button"
      onClick={onTap}
      className="flex w-full items-center gap-3 border-b border-[#2A2F36] py-2.5 text-left last:border-b-0"
    >
      <span className="w-16 shrink-0 text-[10.5px] uppercase tracking-[0.14em] text-white/45">
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-bold text-white">
        {value}
      </span>
      {dot(on)}
      <ChevronRight size={16} className="shrink-0 text-white/30" />
    </button>
  );
  return (
    <section aria-label="FedEx return" className="flex flex-col">
      <span className="text-[10.5px] uppercase tracking-[0.14em] text-white/45">
        FedEx return{days !== null && <b className="text-white"> · {days} d</b>}
      </span>
      <div className="mt-1 flex flex-col border-t border-[#2A2F36]">
        {row(
          'RMA',
          ret.rma || <span className="font-sans font-medium text-white/40">tap to add</span>,
          changed.rma,
          onRma
        )}
        {row(
          'Model',
          ret.model ? (
            <>
              {ret.model}
              {ret.modelName && (
                <span className="ml-2 font-sans font-medium text-white/55">{ret.modelName}</span>
              )}
            </>
          ) : (
            <span className="font-sans font-medium text-white/40">which bike is it?</span>
          ),
          changed.model,
          onModel
        )}
        <button
          type="button"
          role="switch"
          aria-checked={ret.misship}
          onClick={onMisship}
          className="flex w-full items-center gap-3 py-2.5 text-left"
        >
          <span className="w-16 shrink-0 text-[10.5px] uppercase tracking-[0.14em] text-white/45">
            Misship
          </span>
          <span className="flex-1" />
          {dot(changed.misship)}
          <span
            className={`relative h-6 w-10 rounded-full transition-colors ${ret.misship ? 'bg-amber-400' : 'bg-[#2A2F36]'}`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${ret.misship ? 'left-[18px]' : 'left-0.5'}`}
            />
          </span>
        </button>
      </div>
    </section>
  );
};

// ── Which bike it is ────────────────────────────────────────────────────────

export interface ModelPick {
  sku: string;
  name: string;
}

/** A catalogue SKU (a new bike or part, never another special unit). */
export const ModelSheet: React.FC<{
  onCancel: () => void;
  onPick: (m: ModelPick) => void;
}> = ({ onCancel, onPick }) => {
  const [query, setQuery] = useState('');
  const q = useDebounce(query.trim(), 250);
  const { data: hits = [], isFetching } = useQuery({
    queryKey: ['item-card', 'return-model', q],
    enabled: q.length >= 2,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await inventoryApi.fetchInventoryWithMetadata({
        search: q,
        showParts: null,
        includeInactive: true,
        warehouse: 'LUDLOW',
        limit: 40,
      });
      const bySku = new Map<string, { sku: string; name: string; qty: number }>();
      for (const r of data as InventoryItemWithMetadata[]) {
        if ((r.sku_metadata?.unit_kind ?? 'new') !== 'new') continue;
        const cur = bySku.get(r.sku) ?? { sku: r.sku, name: r.item_name ?? '', qty: 0 };
        cur.qty += Number(r.quantity ?? 0);
        if (!cur.name && r.item_name) cur.name = r.item_name;
        bySku.set(r.sku, cur);
      }
      return [...bySku.values()].slice(0, 12);
    },
  });

  return (
    <div
      className="fixed inset-0 z-[195] flex items-end justify-center bg-black/55"
      onClick={onCancel}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-[430px] flex-col gap-3 rounded-t-2xl border border-b-0 border-[#2A2F36] bg-[#161920] px-4 pb-[max(1.1rem,env(safe-area-inset-bottom))] pt-4"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-[10.5px] uppercase tracking-[0.14em] text-white/45">
          Which bike is it?
        </span>
        <label className="flex items-center gap-2 rounded-xl border border-white bg-[#0F1115] px-3 py-3">
          <Search size={16} className="text-white/40" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="SKU or name"
            aria-label="Search the model"
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent font-mono text-base font-bold text-white placeholder:font-sans placeholder:font-medium placeholder:text-white/30 focus:outline-none"
          />
          {isFetching && <Loader2 size={16} className="animate-spin text-white/45" />}
        </label>
        <div className="flex min-h-0 flex-col overflow-y-auto">
          {hits.map((h) => (
            <button
              key={h.sku}
              type="button"
              onClick={() => onPick({ sku: h.sku, name: h.name })}
              className="flex items-center gap-3 border-b border-[#2A2F36] py-2.5 text-left"
            >
              <span className="min-w-0 flex-1">
                <b className="block font-mono text-[13px] text-white">{h.sku}</b>
                <span className="block truncate text-xs text-white/55">{h.name || '—'}</span>
              </span>
              <span className="font-mono text-sm font-bold text-white/70">{h.qty}</span>
            </button>
          ))}
          {q.length >= 2 && !isFetching && hits.length === 0 && (
            <span className="py-3 text-sm text-white/45">Nothing in the catalogue for {q}</span>
          )}
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-[#2A2F36] py-3 font-semibold text-white"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

// ── Where it goes ───────────────────────────────────────────────────────────

export interface ResolveChoice {
  action: ResolveAction;
  location?: string;
  squares?: string[];
  serial?: string;
  reason?: string;
}

type Step = 'choose' | ResolveAction;

export const ResolveSheet: React.FC<{
  tracking: string;
  warehouse: string;
  /** The model it was identified as, if anyone has. */
  model: ModelPick | null;
  busy: boolean;
  onPickModel: () => void;
  onCancel: () => void;
  onConfirm: (choice: ResolveChoice) => void;
  /** Open on one answer: the ⋯ «Mark as S/D» of a return goes straight to its serial. */
  initialStep?: ResolveAction;
}> = ({ tracking, warehouse, model, busy, onPickModel, onCancel, onConfirm, initialStep }) => {
  const [step, setStep] = useState<Step>(initialStep ?? 'choose');
  const [location, setLocation] = useState('');
  const [squares, setSquares] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [serial, setSerial] = useState('');
  const [reason, setReason] = useState('');
  const choices = useWhereChoices({
    enabled: step === 'stock' && !!model,
    warehouse,
    sku: model?.sku ?? '',
    model: '',
    location: location || null,
    query,
  });

  const big =
    'flex w-full flex-col items-start gap-0.5 rounded-2xl border border-[#2A2F36] bg-[#0F1115] px-4 py-3.5 text-left active:scale-[0.99]';
  const ready =
    step === 'stock'
      ? !!model && !!location
      : step === 'sd'
        ? !!serial.trim()
        : step === 'dispose'
          ? !!reason
          : false;
  const confirmLabel =
    step === 'stock'
      ? location
        ? `Move to ${location}${squares.length ? ` · ${squares.join(' ')}` : ''}`
        : 'Where?'
      : step === 'sd'
        ? serial.trim()
          ? 'Make it S/D'
          : 'Serial?'
        : reason
          ? 'Dispose'
          : 'Why?';

  return (
    <div
      className="fixed inset-0 z-[190] flex items-end justify-center bg-black/55"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-[430px] flex-col gap-3 overflow-y-auto rounded-t-2xl border border-b-0 border-[#2A2F36] bg-[#161920] px-4 pb-[max(1.1rem,env(safe-area-inset-bottom))] pt-4"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-[10.5px] uppercase tracking-[0.14em] text-white/45">
          Resolve · <span className="font-mono">{tracking}</span>
        </span>

        {step === 'choose' && (
          <div className="flex flex-col gap-2">
            <button type="button" className={big} onClick={() => setStep('stock')}>
              <b className="text-base text-white">Back to stock</b>
              <span className="text-xs text-white/55">
                {model ? `As ${model.sku} — pick where` : 'Pick the model, then where'}
              </span>
            </button>
            <button type="button" className={big} onClick={() => setStep('sd')}>
              <b className="text-base text-white">S/D</b>
              <span className="text-xs text-white/55">
                Damaged: it becomes an S/D, with its serial
              </span>
            </button>
            <button type="button" className={big} onClick={() => setStep('dispose')}>
              <b className="text-base text-red-400">Dispose</b>
              <span className="text-xs text-white/55">It leaves the building</span>
            </button>
          </div>
        )}

        {step === 'stock' && (
          <>
            <button
              type="button"
              onClick={onPickModel}
              className="flex items-center gap-3 rounded-xl border border-[#2A2F36] bg-[#0F1115] px-3 py-2.5 text-left"
            >
              <span className="w-12 shrink-0 text-[10.5px] uppercase tracking-[0.14em] text-white/45">
                As
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-sm font-bold text-white">
                {model ? (
                  <>
                    {model.sku}
                    {model.name && (
                      <span className="ml-2 font-sans font-medium text-white/55">{model.name}</span>
                    )}
                  </>
                ) : (
                  <span className="font-sans font-medium text-amber-300">which bike is it?</span>
                )}
              </span>
              <ChevronRight size={16} className="text-white/30" />
            </button>
            {model && (
              <WherePicker
                choices={choices}
                location={location || null}
                selected={squares}
                query={query}
                onQuery={setQuery}
                onLocation={(l) => {
                  setLocation(choices.resolve(l));
                  setSquares([]);
                  setQuery('');
                }}
                onSquare={(l) => setSquares((cur) => (cur.includes(l) ? [] : [l]))}
              />
            )}
          </>
        )}

        {step === 'sd' && (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/55">
              Its serial. The tracking stays its SKU until it gets its 01- number.
            </span>
            <input
              autoFocus
              value={serial}
              onChange={(e) => setSerial(e.target.value.toUpperCase())}
              placeholder="Serial"
              aria-label="Serial"
              autoComplete="off"
              className="w-full rounded-xl border border-white bg-[#0F1115] p-3.5 font-mono text-xl font-bold uppercase text-white placeholder:font-sans placeholder:text-base placeholder:font-medium placeholder:normal-case placeholder:text-white/30 focus:outline-none"
            />
          </label>
        )}

        {step === 'dispose' && (
          <div className="flex flex-wrap gap-2">
            {DISPOSE_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={reason === r}
                onClick={() => setReason(r)}
                className={`rounded-full border px-4 py-2 text-sm font-semibold ${
                  reason === r
                    ? 'border-white bg-white text-[#0F1115]'
                    : 'border-[#2A2F36] bg-[#0F1115] text-white'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => (step === 'choose' ? onCancel() : setStep('choose'))}
            className="flex-1 rounded-xl border border-[#2A2F36] py-3 font-semibold text-white disabled:opacity-40"
          >
            {step === 'choose' ? 'Cancel' : 'Back'}
          </button>
          {step !== 'choose' && (
            <button
              type="button"
              disabled={!ready || busy}
              onClick={() =>
                onConfirm(
                  step === 'stock'
                    ? { action: 'stock', location, squares }
                    : step === 'sd'
                      ? { action: 'sd', serial: serial.trim() }
                      : { action: 'dispose', reason }
                )
              }
              className={`flex flex-[2] items-center justify-center rounded-xl py-3 font-semibold disabled:bg-[#2A2F36] disabled:text-white/45 ${
                step === 'dispose' ? 'bg-red-500 text-white' : 'bg-amber-400 text-[#3b2400]'
              }`}
            >
              {busy ? <Loader2 size={18} className="animate-spin" /> : confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
