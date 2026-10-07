/**
 * SOLD S/D under the Stock results (idea-257 P4): the S/D that are no longer on
 * a shelf whose serial, name, SKU or `#` matches the search — archived, or sold
 * and still at 0 in their row (`search_sd_units`). Only while searching, never
 * while browsing. Grey and dashed: a bike that left. A tap opens it (`sd-unit`).
 */
import { useQuery } from '@tanstack/react-query';

import { supabase } from '../../../lib/supabase';
import { useModal } from '../../../context/ModalContext';
import { sdCode } from '../../../utils/sdCode';
import { thumb } from './ItemDetailView/SdUnitHistory';

const month = (iso: string | null) =>
  iso
    ? new Date(iso)
        .toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: '2-digit' })
        .toUpperCase()
    : '';

/** Worth asking: three characters, or an S/D code (`#1`). */
const searchesSoldSd = (term: string) => {
  const t = term.trim();
  return /^#\s*[0-9A-Za-z]{1,6}$/.test(t) || t.replace(/[-\s]/g, '').length >= 3;
};

export function SoldSdResults({ term }: { term: string }) {
  const { open } = useModal();
  const t = term.trim();
  const enabled = searchesSoldSd(t);
  const { data = [] } = useQuery({
    queryKey: ['search-sd-units', t],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_sd_units', { p_term: t, p_limit: 10 });
      if (error) throw error;
      return data ?? [];
    },
  });
  if (!enabled || !data.length) return null;

  return (
    <section className="mx-auto max-w-2xl">
      <div className="flex items-center gap-2 px-1 py-3 text-muted">
        <div className="h-px flex-1 bg-subtle" />
        <span className="shrink-0 text-[10px] font-black uppercase tracking-widest">
          Sold S/D · {data.length}
        </span>
        <div className="h-px flex-1 bg-subtle" />
      </div>
      <div className="flex flex-col gap-1.5">
        {data.map((u) => (
          <button
            key={`${u.unit_id ?? 'row'}-${u.sku}`}
            type="button"
            onClick={() => open({ type: 'sd-unit', unitId: u.unit_id, sku: u.sku })}
            className="flex items-center gap-3 rounded-xl border border-dashed border-subtle px-3 py-2 text-left text-muted active:scale-[0.99]"
          >
            {u.cover_url ? (
              <img
                src={thumb(u.cover_url)}
                alt=""
                className="h-10 w-10 shrink-0 rounded-md object-cover opacity-70"
              />
            ) : (
              <div className="h-10 w-10 shrink-0 rounded-md border border-dashed border-subtle" />
            )}
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="font-mono text-sm font-bold text-content/70">{u.sku}</span>
                {u.sd_number != null && (
                  <span className="font-mono text-xs font-bold text-orange-500/70">
                    #{sdCode(u.sd_number)}
                  </span>
                )}
                <span className="min-w-0 truncate text-xs">{u.item_name ?? 'S/D'}</span>
              </span>
              <span className="block truncate font-mono text-[11px]">
                {[u.serial_number, `SOLD ${month(u.left_at)}`, u.left_order]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
