/**
 * Lo que `shipCheck` necesita y la tarjeta de Ship no trae ya leído: las marcas
 * de verificación de todas las órdenes del envío (son del grupo, pueden vivir
 * en otra orden), las S/D que comparten SKU con bicis nuevas, las órdenes del
 * mismo cliente con las mismas líneas y cuántas veces se reabrió.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../../lib/supabase';
import { lineSignature, type ShipCheckLine } from '../utils/shipCheck';

/** Órdenes del mismo cliente con las mismas líneas a menos de esto: posible duplicada. */
const DUPLICATE_WINDOW_DAYS = 7;
const SD_ROW = 'ROW 12';

export interface ShipCheckData {
  verifiedKeys: string[];
  sdShared: { sku: string; sdNumber: number | null; location: string }[];
  duplicates: string[];
  reopenCount: number;
}

const EMPTY: ShipCheckData = { verifiedKeys: [], sdShared: [], duplicates: [], reopenCount: 0 };

type Row = Record<string, unknown>;

export function useShipCheckData(input: {
  memberIds: string[];
  customerId: string | null;
  createdAt: string | null;
  lines: ShipCheckLine[];
}): ShipCheckData {
  const skus = [...new Set(input.lines.map((l) => l.sku).filter(Boolean))].sort();
  const signature = lineSignature(input.lines);
  const { data } = useQuery({
    queryKey: ['ship-check', input.memberIds.join(','), input.customerId, signature],
    enabled: input.memberIds.length > 0,
    staleTime: 30_000,
    queryFn: async (): Promise<ShipCheckData> => {
      const [members, sd, rows, near] = await Promise.all([
        supabase
          .from('picking_lists')
          .select('id, verified_item_keys, reopen_count')
          .in('id', input.memberIds),
        skus.length
          ? supabase
              .from('sku_metadata')
              .select('sku, sd_number')
              .in('sku', skus)
              .eq('is_scratch_dent', true)
          : Promise.resolve({ data: [] as Row[] }),
        skus.length
          ? supabase
              .from('inventory')
              .select('sku, location, sublocation, quantity')
              .in('sku', skus)
              .eq('is_active', true)
              .gt('quantity', 0)
          : Promise.resolve({ data: [] as Row[] }),
        input.customerId && input.createdAt
          ? supabase
              .from('picking_lists')
              .select('id, order_number, items, status, created_at')
              .eq('customer_id', input.customerId)
              .neq('status', 'cancelled')
              .gte(
                'created_at',
                new Date(
                  Date.parse(input.createdAt) - DUPLICATE_WINDOW_DAYS * 86_400_000
                ).toISOString()
              )
              .lte(
                'created_at',
                new Date(
                  Date.parse(input.createdAt) + DUPLICATE_WINDOW_DAYS * 86_400_000
                ).toISOString()
              )
          : Promise.resolve({ data: [] as Row[] }),
      ]);

      const memberRows = (members.data ?? []) as Row[];
      const verifiedKeys = memberRows.flatMap((m) =>
        Array.isArray(m.verified_item_keys) ? (m.verified_item_keys as string[]) : []
      );
      const reopenCount = Math.max(0, ...memberRows.map((m) => Number(m.reopen_count) || 0));

      const inv = (rows.data ?? []) as Row[];
      const sdShared = ((sd.data ?? []) as Row[]).flatMap((m) => {
        const mine = inv.filter((r) => r.sku === m.sku);
        const sdRow = mine.find((r) => r.location === SD_ROW);
        const fresh = mine.some((r) => r.location !== SD_ROW);
        if (!sdRow || !fresh) return [];
        const sub = Array.isArray(sdRow.sublocation)
          ? (sdRow.sublocation as string[]).join('')
          : '';
        return [
          {
            sku: String(m.sku),
            sdNumber: m.sd_number == null ? null : Number(m.sd_number),
            location: sub ? `${SD_ROW} ${sub}` : SD_ROW,
          },
        ];
      });

      const duplicates = (signature ? ((near.data ?? []) as Row[]) : [])
        .filter((o) => !input.memberIds.includes(String(o.id)))
        .filter((o) => lineSignature((o.items as ShipCheckLine[]) ?? []) === signature)
        .map((o) => String(o.order_number));

      return { verifiedKeys, sdShared, duplicates, reopenCount };
    },
  });
  return data ?? EMPTY;
}
