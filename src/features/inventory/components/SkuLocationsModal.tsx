import React from 'react';
import { useQuery } from '@tanstack/react-query';
import X from 'lucide-react/dist/esm/icons/x';
import Pencil from 'lucide-react/dist/esm/icons/pencil';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import { ModalOverlay } from '../../../components/ui/ModalOverlay';
import { RegisterTypeSelector } from '../../../components/ui/RegisterTypeSelector';
import { supabase } from '../../../lib/supabase';
import type { InventoryItemWithMetadata } from '../../../schemas/inventory.schema';
import { DistributionGlyph } from './DistributionJengaViz';
import { arrangeSkuLocations } from '../utils/skuLocations';
import { buildNewSkuPrefill } from '../utils/newSkuPrefill';

export interface SkuLocationsModalProps {
  sku: string;
  /** Shown when the SKU has no inventory row yet but the order still names it. */
  itemName?: string | null;
  /** The address the order sends the picker to — marked, and listed first. */
  pickLocation?: string | null;
  pickWarehouse?: string | null;
  /** Open the editor on one specific row. */
  onEdit: (row: InventoryItemWithMetadata) => void;
  /**
   * The SKU is not in inventory at all and the operator chose bike or part:
   * open New Item on this prefilled row (name, model/size/colour, the type's
   * default box) so only location and quantity are left to type.
   */
  onRegister: (prefill: InventoryItemWithMetadata) => void;
  onClose: () => void;
}

/**
 * Every row a SKU is stocked in, with the order's own address marked. The
 * picker long-presses an item to answer "where is it, really?", and one row
 * chosen by a rule could not answer that: 03-4066BK sat in ROW 6 A (4) and
 * ROW 41 F (78), the card said ROW 6, the old detail opened ROW 41, and the
 * card looked wrong. Editing is a deliberate second tap on the row to change,
 * so looking never lands anyone in a form.
 *
 * Reads the DB directly: the paginated inventoryData is LUDLOW-only, ROW-only
 * and capped, so parts bins and page-2 rows are not in it.
 */
export const SkuLocationsModal: React.FC<SkuLocationsModalProps> = ({
  sku,
  itemName,
  pickLocation,
  pickWarehouse,
  onEdit,
  onRegister,
  onClose,
}) => {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['inventory', 'sku-locations', sku],
    staleTime: 0,
    queryFn: async (): Promise<InventoryItemWithMetadata[]> => {
      const { data, error } = await supabase
        .from('inventory')
        .select('*, sku_metadata(*)')
        .eq('sku', sku)
        .order('quantity', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as InventoryItemWithMetadata[];
    },
  });

  const all = data ?? [];
  const pick = { location: pickLocation, warehouse: pickWarehouse };
  const { rows: stocked, pickRowMissing } = arrangeSkuLocations(all, pick);
  // Registered but empty everywhere: list the rows at 0 with their Edit
  // button. The register offer is only for a SKU with NO inventory row — the
  // second long-press after registering used to land here and offer to create
  // the SKU again, because a row saved with quantity 0 was filtered out as
  // history (2026-08-26). Editing that row is how the stock goes in.
  const dormant = stocked.length === 0 && all.length > 0;
  const rows = dormant ? arrangeSkuLocations(all, pick, { keepEmpty: true }).rows : stocked;
  const name = itemName || rows.find((r) => r.row.item_name)?.row.item_name || null;
  const totalUnits = rows.reduce((sum, r) => sum + (r.row.quantity ?? 0), 0);

  return (
    <ModalOverlay
      onClose={onClose}
      maxWidth="md"
      zIndex={170}
      cardBg="bg-surface"
      className="flex flex-col max-h-[85vh] overflow-hidden"
    >
      <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-subtle shrink-0">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted">Where it is</p>
          <p className="font-mono font-black text-2xl text-content leading-tight truncate">{sku}</p>
          {name && <p className="text-xs text-muted truncate">{name}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="p-2 -mr-2 -mt-2 rounded-full text-muted hover:bg-card transition-colors shrink-0"
        >
          <X size={20} />
        </button>
      </div>

      <div className="overflow-y-auto px-4 py-3 space-y-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="animate-spin text-amber-500 w-6 h-6 opacity-40" />
          </div>
        ) : isError ? (
          <p className="text-center text-sm text-red-400 py-8">Couldn&apos;t load locations.</p>
        ) : all.length === 0 ? (
          // The type question is asked here, where the operator already is,
          // instead of behind another full-screen gate inside the form.
          // Choosing is registering: the form opens with everything the order
          // knew filled in, and the type sets the default weight and box.
          <div className="py-3">
            <RegisterTypeSelector
              value={null}
              onChange={(kind) =>
                onRegister(buildNewSkuPrefill({ sku, itemName, warehouse: pickWarehouse }, kind))
              }
              title="Not in PickD yet — register it as"
              subtitle="Name, model and defaults are filled in from the order. You only add where it is and how many."
            />
          </div>
        ) : (
          <>
            {dormant ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs font-bold text-amber-400">
                Registered, but no stock recorded yet — edit a row to add how many and where.
              </div>
            ) : (
              pickRowMissing && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs font-bold text-red-400">
                  The order points to {pickLocation}, but there is no stock recorded there.
                </div>
              )
            )}
            {rows.map(({ row, isPick }) => {
              const qty = row.quantity ?? 0;
              const subs = row.sublocation?.length ? [...row.sublocation].sort().join('/') : null;
              return (
                <div
                  key={row.id ?? `${row.warehouse}-${row.location}`}
                  className={`rounded-2xl border px-4 py-3 flex items-center gap-3 ${
                    isPick ? 'border-amber-500/50 bg-amber-500/5' : 'border-subtle bg-card'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-black text-2xl text-amber-500 leading-none">
                        {row.location || '—'}
                        {subs && <span className="ml-2 text-content">{subs}</span>}
                      </span>
                      {isPick && (
                        <span className="text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-md bg-amber-500 text-black">
                          This order
                        </span>
                      )}
                      {row.warehouse && row.warehouse !== 'LUDLOW' && (
                        <span className="text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-md bg-card border border-subtle text-muted">
                          {row.warehouse}
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 flex items-center gap-3 flex-wrap">
                      <span
                        className={`text-sm font-black tabular-nums ${qty === 0 ? 'text-red-400' : 'text-content'}`}
                      >
                        {qty} {qty === 1 ? 'unit' : 'units'}
                      </span>
                      {row.distribution?.map((d, i) => (
                        <span key={i} className="flex items-center gap-1 text-xs text-muted">
                          <DistributionGlyph type={d.type} unitsEach={d.units_each} />
                          {d.count > 1 && <span className="font-bold">×{d.count}</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onEdit(row)}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-card border border-subtle text-xs font-black uppercase tracking-wider text-content hover:bg-surface active:scale-95 transition-all"
                  >
                    <Pencil size={14} />
                    Edit
                  </button>
                </div>
              );
            })}
            <p className="text-center text-[10px] uppercase tracking-widest text-muted pt-1">
              {totalUnits} {totalUnits === 1 ? 'unit' : 'units'} in {rows.length}{' '}
              {rows.length === 1 ? 'location' : 'locations'}
            </p>
          </>
        )}
      </div>
    </ModalOverlay>
  );
};
