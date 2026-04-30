import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';

/**
 * idea-092 — pick-time SKU format auto-resolver.
 *
 * Given a raw SKU that didn't match `sku_metadata` (e.g. "034666BR" from a
 * PDF parsed without dashes), look up canonical SKUs whose normalized form
 * matches. Returns:
 *   - canonicalSku: the unique canonical SKU when there is exactly one match.
 *   - isAmbiguous:  true when 2+ canonical SKUs share the same normalized form
 *                   (rare; the caller should not auto-suggest in this case).
 *   - isLoading:    initial fetch in progress.
 *
 * Disabled when `enabled=false` so we don't hit the DB for SKUs that already
 * exist in sku_metadata.
 */
export function useSkuSuggestion(rawSku: string | null | undefined, enabled: boolean) {
  const sku = (rawSku ?? '').trim();

  const query = useQuery({
    queryKey: ['sku-suggestion', sku],
    queryFn: async () => {
      // RPC types not yet regenerated — cast until the next types refresh.
      const { data, error } = await (supabase.rpc as CallableFunction)('lookup_canonical_sku', {
        p_raw: sku,
      });
      if (error) throw error;
      return (data ?? []) as Array<{ sku: string }>;
    },
    enabled: enabled && sku.length >= 4,
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });

  const matches = query.data ?? [];
  return {
    canonicalSku: matches.length === 1 ? matches[0].sku : null,
    isAmbiguous: matches.length > 1,
    isLoading: query.isLoading,
  };
}
