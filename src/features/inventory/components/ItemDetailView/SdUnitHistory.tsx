/**
 * BEFORE: the S/D bikes this SKU carried before the one on the card (idea-257,
 * `sd_units`). Rafael, 7 Oct 2026: «mantener el historial y a la vez reutilizar
 * SKUs de bicis ya vendidas». Grey and dashed, never editable: a bike that
 * left. Tapping one opens what it was — cover, condition, AS400 text of then,
 * and its own lines of history.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { supabase } from '../../../../lib/supabase';
import { sdCode } from '../../../../utils/sdCode';

interface SdUnit {
  id: number;
  sd_number: number | null;
  serial_number: string | null;
  item_name: string | null;
  cover_url: string | null;
  catalog: Record<string, unknown> | null;
  left_at: string | null;
  left_order: string | null;
  left_by: string | null;
}

const day = (iso: string | null) =>
  iso
    ? new Date(iso)
        .toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: '2-digit' })
        .toUpperCase()
    : 'NO RECORD';

export const thumb = (url: string) =>
  url.includes('/photos/gallery/')
    ? url.replace('/photos/gallery/', '/photos/gallery/thumbs/')
    : url.includes('/photos/') && !url.includes('/thumbs/')
      ? url.replace('/photos/', '/photos/thumbs/')
      : url;

export function UnitLogs({ unitId }: { unitId: number }) {
  const { data = [] } = useQuery({
    queryKey: ['sd-unit-logs', unitId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_logs')
        .select(
          'id, created_at, action_type, quantity_change, from_location, to_location, order_number'
        )
        .eq('sd_unit_id', unitId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
  if (!data.length) return null;
  return (
    <div className="mt-1.5 flex flex-col gap-0.5 font-mono text-[10.5px] text-white/45">
      {data.map((l) => (
        <span key={l.id}>
          {day(l.created_at)} {l.action_type} {l.quantity_change > 0 ? '+' : ''}
          {l.quantity_change}
          {l.from_location && l.to_location && l.from_location !== l.to_location
            ? ` ${l.from_location} → ${l.to_location}`
            : l.to_location || l.from_location
              ? ` ${l.to_location || l.from_location}`
              : ''}
          {l.order_number ? ` · ${l.order_number}` : ''}
        </span>
      ))}
    </div>
  );
}

export function SdUnitHistory({ sku }: { sku: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const { data: units = [] } = useQuery({
    queryKey: ['sd-units', sku],
    enabled: !!sku,
    staleTime: 60_000,
    queryFn: async (): Promise<SdUnit[]> => {
      const { data, error } = await supabase
        .from('sd_units')
        .select(
          'id, sd_number, serial_number, item_name, cover_url, catalog, left_at, left_order, left_by'
        )
        .eq('sku', sku)
        .order('archived_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as SdUnit[];
    },
  });
  if (!units.length) return null;

  return (
    <section className="flex flex-col">
      <span className="text-[10.5px] uppercase tracking-[0.14em] text-white/45">Before</span>
      <div className="mt-1 flex flex-col gap-1.5">
        {units.map((u) => {
          const isOpen = open === u.id;
          const cat = u.catalog ?? {};
          const text = (k: string) => (typeof cat[k] === 'string' ? (cat[k] as string) : null);
          // new_built → New · built, as the S/D card says it.
          const condition = text('condition')
            ?.replace(/_/g, ' · ')
            .replace(/^./, (c) => c.toUpperCase());
          return (
            <button
              key={u.id}
              type="button"
              onClick={() => setOpen(isOpen ? null : u.id)}
              className="rounded-lg border border-dashed border-white/20 px-2.5 py-2 text-left text-white/55"
            >
              <span className="flex items-baseline gap-2 text-xs">
                <span className="font-mono font-bold text-white/70">
                  {u.sd_number != null ? `#${sdCode(u.sd_number)}` : '—'}
                </span>
                <span className="min-w-0 flex-1 truncate">{u.item_name ?? 'S/D'}</span>
                <span className="text-white/35">{isOpen ? '⌄' : '›'}</span>
              </span>
              <span className="block font-mono text-[10.5px] text-white/40">
                {[u.serial_number, `SOLD ${day(u.left_at)}`, u.left_order]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {isOpen && (
                <span className="mt-2 block">
                  {u.cover_url && (
                    <img
                      src={thumb(u.cover_url)}
                      alt=""
                      className="mb-1.5 h-24 w-24 rounded-md object-cover opacity-80"
                    />
                  )}
                  {[condition, text('condition_description')].filter(Boolean).length > 0 && (
                    <span className="block text-[11px]">
                      {[condition, text('condition_description')].filter(Boolean).join(' · ')}
                    </span>
                  )}
                  {text('as400_description') && (
                    <span className="block font-mono text-[10.5px] text-white/40">
                      AS400 {text('as400_description')}
                    </span>
                  )}
                  {u.left_by && (
                    <span className="block text-[10.5px] text-white/40">Out by {u.left_by}</span>
                  )}
                  <UnitLogs unitId={u.id} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
