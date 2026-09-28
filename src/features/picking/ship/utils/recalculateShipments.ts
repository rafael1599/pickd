import { planPallets, countPhysicalPallets, type BikeSets } from '../../pallets/planPallets';
import { unitAverages, totalWeight, type WeighedLine } from '../../pallets/weights';
import type { PickingListItem } from '../../../../schemas/picking.schema';
import type { PickingItem } from '../../../../utils/pickingLogic';

export interface SkuMetadataMap {
  [sku: string]:
    | {
        is_bike?: boolean;
        is_electric?: boolean;
        weight_lbs?: number | null;
        /** Las medidas de la caja: sin ellas las de niño no tienen regla de alto. */
        length_in?: number | null;
        width_in?: number | null;
        height_in?: number | null;
      }
    | undefined;
}

export interface PalletsAndWeight {
  pallets: number;
  weight: number;
  dims: unknown[];
}

export function calculateShipmentPalletsAndWeight(
  items: Array<Pick<PickingListItem, 'sku' | 'pickingQty'>>,
  sets: BikeSets,
  metaBySku: SkuMetadataMap = {},
  isFedex = false
): PalletsAndWeight {
  // 1. Calculate physical pallets
  const pickingItems: PickingItem[] = items.map((line) => ({
    sku: line.sku,
    pickingQty: line.pickingQty || 0,
    location: null,
  }));
  const planned = planPallets(pickingItems, sets, {
    metaFor: (sku) => {
      const meta = metaBySku[sku];
      return meta && meta.length_in != null ? meta : undefined;
    },
  });
  const palletCount = isFedex ? 0 : countPhysicalPallets(planned);

  // 2. Prepare weighed lines
  const weighedLines: WeighedLine[] = items.map((line) => {
    const meta = metaBySku[line.sku];
    const isBike = meta?.is_bike ?? sets.bikes.has(line.sku);
    return {
      pickingQty: line.pickingQty || 0,
      weightLbs: meta?.weight_lbs ?? null,
      isBike,
      isElectric: meta?.is_electric ?? false,
    };
  });

  // 3. Compute unit averages and total weight
  const averages = unitAverages(weighedLines);
  const weight = totalWeight({
    averages,
    hasLines: items.length > 0,
    palletCount,
    isFedex,
    typed: { bikes: '', parts: '' },
    useTyped: false,
  });

  return {
    pallets: palletCount,
    weight,
    dims: [],
  };
}

export function calculateCombineRecalculation(
  targetItems: Array<Pick<PickingListItem, 'sku' | 'pickingQty'>>,
  sourceItemsList: Array<Array<Pick<PickingListItem, 'sku' | 'pickingQty'>>>,
  sets: BikeSets,
  metaBySku: SkuMetadataMap = {},
  isFedex = false
): PalletsAndWeight {
  const allItems = [...targetItems, ...sourceItemsList.flat()];
  return calculateShipmentPalletsAndWeight(allItems, sets, metaBySku, isFedex);
}

export interface SplitFedexOptions {
  remainingIsFedex?: boolean;
  exitingIsFedex?: boolean;
}

export function calculateSplitRecalculation(
  remainingItems: Array<Pick<PickingListItem, 'sku' | 'pickingQty'>>,
  exitingItems: Array<Pick<PickingListItem, 'sku' | 'pickingQty'>>,
  sets: BikeSets,
  metaBySku: SkuMetadataMap = {},
  isFedex: boolean | SplitFedexOptions = false
): { source: PalletsAndWeight; target: PalletsAndWeight } {
  const remainingFedex =
    typeof isFedex === 'boolean' ? isFedex : (isFedex.remainingIsFedex ?? false);
  const exitingFedex = typeof isFedex === 'boolean' ? isFedex : (isFedex.exitingIsFedex ?? false);

  const source = calculateShipmentPalletsAndWeight(remainingItems, sets, metaBySku, remainingFedex);
  const target = calculateShipmentPalletsAndWeight(exitingItems, sets, metaBySku, exitingFedex);
  return { source, target };
}
