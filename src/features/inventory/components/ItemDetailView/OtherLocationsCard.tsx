import React, { useMemo } from 'react';
import MapPin from 'lucide-react/dist/esm/icons/map-pin';

import type { InventoryItemWithMetadata } from '../../../../schemas/inventory.schema';

interface OtherLocationsCardProps {
  sku: string;
  currentItemId: string | number;
  ludlowData: InventoryItemWithMetadata[];
  atsData: InventoryItemWithMetadata[];
}

export const OtherLocationsCard: React.FC<OtherLocationsCardProps> = ({
  sku,
  currentItemId,
  ludlowData,
  atsData,
}) => {
  const others = useMemo(() => {
    const trimmed = (sku || '').trim();
    if (!trimmed) return [];
    const all = [...ludlowData, ...atsData];
    return all
      .filter(
        (i) => (i.sku || '').trim() === trimmed && i.id !== currentItemId && (i.quantity || 0) > 0
      )
      .sort((a, b) => (b.quantity || 0) - (a.quantity || 0));
  }, [sku, currentItemId, ludlowData, atsData]);

  if (others.length === 0) return null;

  const totalElsewhere = others.reduce((sum, i) => sum + (i.quantity || 0), 0);

  return (
    <div className="bg-card border-b border-subtle mt-4 mx-4 rounded-2xl overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MapPin size={12} className="text-emerald-500" />
          <span className="text-[11px] font-bold text-emerald-500 uppercase tracking-wider">
            Available elsewhere
          </span>
        </div>
        <span className="text-[10px] font-black uppercase tracking-widest text-muted">
          {totalElsewhere}u total
        </span>
      </div>
      <ul className="divide-y divide-subtle/60">
        {others.map((item) => (
          <li
            key={`${item.id}-${item.warehouse}-${item.location}`}
            className="flex items-center gap-3 px-4 py-2"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 text-[10px] font-bold">
                <span className="text-content/80">{item.warehouse || '—'}</span>
                <span className="text-muted/40">·</span>
                <span className="text-accent font-black">{item.location || '—'}</span>
                {Array.isArray(item.sublocation) && item.sublocation.length > 0 && (
                  <span className="text-[8px] font-black bg-accent/15 text-accent px-1 py-0.5 rounded border border-accent/20">
                    {item.sublocation.join(',')}
                  </span>
                )}
              </div>
              {item.internal_note && (
                <div
                  className="text-[9px] font-bold text-muted truncate"
                  title={item.internal_note}
                >
                  📍 {item.internal_note}
                </div>
              )}
            </div>
            <div className="text-sm font-black leading-none text-content shrink-0">
              {item.quantity}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};
