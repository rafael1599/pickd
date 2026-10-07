import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { isRowLocation, squaresForRow } from '../utils/registerItem';

/** The squares of a row and which are reachable (`row_squares`); A–K for a row not drawn. */
export function useRowSquares(location: string | null, used: string[]) {
  const isRow = isRowLocation(location);
  const { data = [] } = useQuery({
    queryKey: ['move-sheet', 'row-squares', location],
    enabled: isRow,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from('row_squares')
        .select('letter, is_fast')
        .eq('location', location as string);
      if (error) throw error;
      return rows ?? [];
    },
  });
  return useMemo(() => {
    const drawn = data.map((r) => r.letter);
    const letters = drawn.length ? [...new Set([...drawn, ...used])].sort() : squaresForRow(used);
    const fast = new Set(data.filter((r) => r.is_fast).map((r) => r.letter));
    return { letters: isRow ? letters : [], fast };
  }, [data, used, isRow]);
}
