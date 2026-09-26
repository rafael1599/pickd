import { useCartSkuMeta } from './useCartSkuMeta';

/** Las bicis y, dentro de ellas, las pequeñas. Un solo viaje a la base. */
export interface BikeSets {
  bikes: Set<string>;
  smallBikes: Set<string>;
}

/**
 * Qué SKUs de la carga son bici (`sku_metadata.is_bike`, o el prefijo si no hay
 * ficha), junto con las que son de línea juvenil o de rueda chica — las que el
 * cálculo de pallets trata aparte. Desde el paso 3 de ship-pallet-truth sale del
 * catálogo compartido (`useCartSkuMeta`): mismo resultado que antes (replay de
 * 855 órdenes, 0 diferencias), con caché entre pantallas.
 */
export function useBikeSets(skus: string[]): BikeSets {
  return useCartSkuMeta(skus).bikeSets;
}

/** Sólo las bicis, para quien no necesita distinguir las pequeñas. */
export function useBikeSkuSet(skus: string[]): Set<string> {
  return useBikeSets(skus).bikes;
}
