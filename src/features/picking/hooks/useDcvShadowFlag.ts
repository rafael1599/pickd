/**
 * El interruptor de la sombra de Double Check, leído de `app_flags` — en la
 * base, no en el build: apagarlo no pide redeploy.
 *
 * Se lee una vez al abrir Double Check y se guarda 5 minutos. Cualquier cosa
 * que no sea una fila `enabled = true` bien formada —sin fila, sin red, una
 * tabla que todavía no existe— es la sombra **apagada** (`parseShadowFlag`).
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { SHADOW_FLAG_OFF, parseShadowFlag, type ShadowFlag } from '../utils/dcvShadow';

// app_flags is newer than the generated Supabase types.
type FlagRow = { enabled: unknown; config: unknown };
const fromFlags = () =>
  (
    supabase.from.bind(supabase) as unknown as (t: 'app_flags') => {
      select: (cols: string) => {
        eq: (
          col: string,
          v: string
        ) => {
          maybeSingle: () => Promise<{ data: FlagRow | null; error: { message: string } | null }>;
        };
      };
    }
  )('app_flags');

export function useDcvShadowFlag(): ShadowFlag {
  const { data } = useQuery({
    queryKey: ['app_flags', 'dcv_shadow'],
    queryFn: async () => {
      const { data: row, error } = await fromFlags()
        .select('enabled, config')
        .eq('key', 'dcv_shadow')
        .maybeSingle();
      if (error) return SHADOW_FLAG_OFF;
      return parseShadowFlag(row);
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
  return data ?? SHADOW_FLAG_OFF;
}
