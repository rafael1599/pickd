/**
 * An S/D that is no longer on a shelf (idea-257 P4): archived in `sd_units`, or
 * sold and still sitting at 0 in its own row. Opened from SOLD S/D under the
 * Stock results. Grey and read-only, like the BEFORE lines of a card: a bike
 * that left — what it was, when and on which order it went, its own history.
 */
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';

import { supabase } from '../../../lib/supabase';
import { useScrollLock } from '../../../hooks/useScrollLock';
import { sdCode } from '../../../utils/sdCode';
import { UnitLogs, thumb } from './ItemDetailView/SdUnitHistory';

interface Unit {
  sdNumber: number | null;
  sku: string;
  serial: string | null;
  name: string | null;
  cover: string | null;
  condition: string | null;
  conditionDescription: string | null;
  as400: string | null;
  leftAt: string | null;
  leftOrder: string | null;
  leftBy: string | null;
}

const day = (iso: string | null) =>
  iso
    ? new Date(iso)
        .toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: '2-digit' })
        .toUpperCase()
    : 'NO RECORD';

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

async function loadUnit(unitId: number | null, sku: string): Promise<Unit | null> {
  if (unitId != null) {
    const { data, error } = await supabase
      .from('sd_units')
      .select(
        'sd_number, sku, serial_number, item_name, cover_url, catalog, left_at, left_order, left_by'
      )
      .eq('id', unitId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const cat = (data.catalog ?? {}) as Record<string, unknown>;
    return {
      sdNumber: data.sd_number,
      sku: data.sku,
      serial: data.serial_number,
      name: data.item_name,
      cover: data.cover_url,
      condition: str(cat.condition),
      conditionDescription: str(cat.condition_description),
      as400: str(cat.as400_description),
      leftAt: data.left_at,
      leftOrder: data.left_order,
      leftBy: data.left_by,
    };
  }
  // Sold and never archived: the row still is that bike.
  const [{ data: meta, error }, { data: sold }] = await Promise.all([
    supabase
      .from('sku_metadata')
      .select(
        'sd_number, serial_number, image_url, condition, condition_description, as400_description'
      )
      .eq('sku', sku)
      .maybeSingle(),
    supabase.rpc('sd_sold_unit', { p_sku: sku }),
  ]);
  if (error) throw error;
  const s = (sold ?? {}) as Record<string, unknown>;
  return {
    sdNumber: meta?.sd_number ?? null,
    sku,
    serial: meta?.serial_number ?? null,
    name: str(s.name),
    cover: meta?.image_url ?? null,
    condition: meta?.condition ?? null,
    conditionDescription: meta?.condition_description ?? null,
    as400: meta?.as400_description ?? null,
    leftAt: str(s.left_at),
    leftOrder: str(s.left_order),
    leftBy: null,
  };
}

/** The lines of a sold S/D still in its row: the live history of that SKU. */
function SkuLogs({ sku }: { sku: string }) {
  const { data = [] } = useQuery({
    queryKey: ['sd-unit-sku-logs', sku],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_inventory_logs_for_sku', {
        p_sku: sku,
        p_limit: 30,
      });
      if (error) throw error;
      return [...(data ?? [])].reverse();
    },
  });
  if (!data.length) return null;
  return (
    <div className="mt-1.5 flex flex-col gap-0.5 font-mono text-[10.5px] text-muted">
      {data.map((l) => (
        <span key={l.id}>
          {day(l.created_at)} {l.action_type} {l.quantity_change > 0 ? '+' : ''}
          {l.quantity_change}
          {l.to_location || l.from_location ? ` ${l.to_location || l.from_location}` : ''}
          {l.order_number ? ` · ${l.order_number}` : ''}
        </span>
      ))}
    </div>
  );
}

export function SdUnitSheet({
  unitId,
  sku,
  onClose,
}: {
  unitId: number | null;
  sku: string;
  onClose: () => void;
}) {
  useScrollLock(true, onClose);
  const { data: unit, isLoading } = useQuery({
    queryKey: ['sd-unit', unitId, sku],
    staleTime: 60_000,
    queryFn: () => loadUnit(unitId, sku),
  });
  // new_built → New · built, as the S/D card says it.
  const condition = unit?.condition?.replace(/_/g, ' · ').replace(/^./, (c) => c.toUpperCase());

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-end md:items-stretch md:justify-end bg-main/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Sold S/D"
        className="w-full md:w-[430px] max-h-[90vh] md:max-h-none md:h-full flex flex-col bg-surface border-t md:border-t-0 md:border-l border-subtle rounded-t-3xl md:rounded-none shadow-2xl animate-in slide-in-from-bottom md:slide-in-from-right duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 pt-4 pb-3 border-b border-subtle shrink-0">
          <h2
            className="flex-1 text-xl font-black uppercase tracking-tighter text-content"
            style={{ fontFamily: 'var(--font-heading)' }}
          >
            {unit?.sdNumber != null && (
              <span className="mr-2 text-orange-500/70">#{sdCode(unit.sdNumber)}</span>
            )}
            {sku}
          </h2>
          <span className="text-[10px] font-black uppercase tracking-widest text-muted">
            Sold S/D
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-2 -mr-2 rounded-full text-muted hover:bg-card transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 pt-4 pb-32">
          {isLoading ? null : !unit ? (
            <p className="py-10 text-center text-sm text-muted">Not found.</p>
          ) : (
            <div className="rounded-xl border border-dashed border-subtle px-3 py-3 text-muted">
              {unit.cover && (
                <img
                  src={thumb(unit.cover)}
                  alt=""
                  className="mb-2 h-32 w-32 rounded-lg object-cover opacity-80"
                />
              )}
              <p className="text-sm font-bold text-content/80">{unit.name ?? 'S/D'}</p>
              <p className="font-mono text-xs">
                {[unit.serial, `SOLD ${day(unit.leftAt)}`, unit.leftOrder]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {[condition, unit.conditionDescription].filter(Boolean).length > 0 && (
                <p className="mt-1.5 text-xs">
                  {[condition, unit.conditionDescription].filter(Boolean).join(' · ')}
                </p>
              )}
              {unit.as400 && <p className="mt-1 font-mono text-[11px]">AS400 {unit.as400}</p>}
              {unit.leftBy && <p className="mt-1 text-[11px]">Out by {unit.leftBy}</p>}
              <div className="mt-3 border-t border-subtle pt-2">
                {unitId != null ? <UnitLogs unitId={unitId} /> : <SkuLogs sku={sku} />}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
