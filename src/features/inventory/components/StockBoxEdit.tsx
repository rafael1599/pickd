/* eslint-disable react-refresh/only-export-components */
/**
 * «Bring forward» for the Stock list (idea-253 P3): rows of an active SKU whose
 * faces are empty with stock buried behind them. The card's pill opens Edit
 * squares with the move already staged (idea-258); editing a row's boxes no
 * longer happens inside the card.
 */
import { createContext, useCallback, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';

interface StockBoxEditValue {
  /** «Bring forward» for a row: its buried square and the face it goes to. */
  bringForward: (itemId: number | string | undefined) => BringForward | null;
}

export interface BringForward {
  from: string;
  to: string;
}

const BRING_FORWARD_KEY = ['stock', 'bring-forward'] as const;

const Ctx = createContext<StockBoxEditValue | null>(null);

/** Null outside the Stock screen: the card then offers no pill. */
export const useStockBoxEdit = () => useContext(Ctx);

export function StockBoxEditProvider({ children }: { children: ReactNode }) {
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
  const value = useMemo<StockBoxEditValue>(() => ({ bringForward }), [bringForward]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
