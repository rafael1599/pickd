/**
 * El catálogo de las líneas de una carga, compartido entre pantallas.
 *
 * Paso 3 de `docs/prds/ship-pallet-truth.md`: una consulta
 * (`fetchCartSkuMeta`) con caché de TanStack Query por conjunto de SKUs, así
 * que la misma carga abierta en el carrito, Double Check o Ship no vuelve a
 * preguntar lo mismo. `staleTime: 0` a propósito: se enseña lo que hay en caché
 * y se vuelve a pedir, que es la frescura que tenía cada pantalla por su cuenta
 * (registrar un SKU a media sesión tiene que llegar).
 *
 * **`isReady`** dice si el catálogo ya respondió para ESTE conjunto de SKUs.
 * Todo lo que guarde algo derivado del catálogo tiene que esperarlo: un render
 * sin catálogo cuenta una bici como parte (bug-021, `ship/lib/lineMeta.ts`).
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  bikeSetsFrom,
  cartSkusKey,
  fetchCartSkuMeta,
  type CartSkuMeta,
} from '../services/cartSkuMeta.service';

export interface CartSkuMetaResult {
  metaBySku: Readonly<Record<string, CartSkuMeta>>;
  bikeSets: { bikes: Set<string>; smallBikes: Set<string> };
  isReady: boolean;
}

const EMPTY: Record<string, CartSkuMeta> = {};

export function useCartSkuMeta(skus: ReadonlyArray<string | null | undefined>): CartSkuMetaResult {
  const key = cartSkusKey(skus);
  const { data, isSuccess } = useQuery({
    queryKey: ['cart-sku-meta', key],
    queryFn: () => fetchCartSkuMeta(key.split(',')),
    enabled: key !== '',
    staleTime: 0,
    // Cada conjunto de SKUs es una entrada, y el board cambia de conjunto con
    // cada orden: con los 7 días globales (persistidos en IndexedDB) se
    // acumularían. Diez minutos bastan para compartir entre pantallas.
    gcTime: 10 * 60_000,
  });
  const metaBySku = data ?? EMPTY;
  const bikeSets = useMemo(() => bikeSetsFrom(metaBySku), [metaBySku]);
  return { metaBySku, bikeSets, isReady: key === '' || isSuccess };
}
