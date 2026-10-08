// Lo que el motor de dónde-se-recoge (`utils/pickLocation.ts`) necesita saber
// de cada dirección, en una sola llamada: `locations` (picking_order y
// pick_priority) y `row_squares` (qué cuadro de cada ROW es accesible).
//
// Hasta el 8 oct 2026 cada camino leía sólo `locations` por su cuenta, y la
// fila se elegía sin mirar el mapa. Ahora todos piden aquí, así que todos
// reciben las dos respuestas o ninguno.

import { supabase } from '../../../lib/supabase';
import { toPickingOrderMap, type PickingOrderMap } from '../utils/pickLocation';

type SquareRow = { location: string; letter: string; is_fast: boolean };

// `row_squares` sólo cambia cuando cambia el mapa (una migración), así que se
// lee como mucho cada diez minutos; `locations` se lee fresco cada vez, como
// siempre.
const SQUARES_TTL_MS = 10 * 60_000;
let squaresCache: { at: number; rows: Promise<SquareRow[]> } | null = null;

/** `row_squares`, para el camino que ya trae `locations` por otro motivo. Nunca lanza. */
export function fetchRowSquares(): Promise<SquareRow[]> {
  if (squaresCache && Date.now() - squaresCache.at < SQUARES_TTL_MS) return squaresCache.rows;
  const rows = (async (): Promise<SquareRow[]> => {
    try {
      const { data, error } = await supabase
        .from('row_squares')
        .select('location, letter, is_fast');
      if (error || !Array.isArray(data)) throw error ?? new Error('row_squares: no data');
      return data as SquareRow[];
    } catch (err) {
      // Sin la tabla todo cuadro cuenta como accesible — el motor sigue
      // eligiendo por menos unidades, sólo que sin saber qué está enterrado. No
      // se guarda el fallo: la próxima llamada lo intenta otra vez.
      squaresCache = null;
      console.error('row_squares could not be loaded:', err);
      return [];
    }
  })();
  squaresCache = { at: Date.now(), rows };
  return rows;
}

/**
 * `locations` + `row_squares` → el mapa que reciben `byPickPreference`,
 * `planPickAcrossLocations` y todo lo que planifica. Nunca lanza: si
 * `locations` falla, devuelve un mapa vacío (el cancelado se sigue reconociendo
 * por nombre), igual que hacían los caminos que la leían a mano.
 */
export async function fetchPickingOrderMap(): Promise<PickingOrderMap> {
  const [locations, squares] = await Promise.all([
    (async () => {
      try {
        const { data, error } = await supabase
          .from('locations')
          .select('warehouse, location, picking_order, pick_priority');
        if (error) console.error('Error fetching picking orders:', error);
        return data ?? [];
      } catch (err) {
        console.error('Error fetching picking orders:', err);
        return [];
      }
    })(),
    fetchRowSquares(),
  ]);
  return toPickingOrderMap(locations, squares);
}
