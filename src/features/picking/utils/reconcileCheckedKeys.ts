/**
 * Conciliación segura de marcas de Double Check al cambiar el reparto de tarimas.
 *
 * Regla de negocio (Rafael, 10 oct 2026, idea-261):
 * «Nunca más marcas que unidades tomadas».
 *
 * Cuando el reparto de tarimas cambia (una tarima armada a mano, bicis tecleadas,
 * «+/-» de niño, medidas editadas), las marcas (`verified_item_keys`) deben seguir
 * a las UNIDADES tomadas, no al SKU en bloque.
 *
 * Algoritmo:
 * 1. Por cada (sku, ubicación): unidades marcadas = suma de pickingQty de las
 *    porciones viejas marcadas.
 * 2. En el nuevo reparto se marcan porciones de ese (sku, ubicación) cuya suma
 *    NO pase de esas unidades:
 *    - Primero las que conservan la misma llave (mismo pallet id) y la misma cantidad.
 *    - Después las que quepan exactas en lo que falta (elige la combinación que más
 *      unidades conserve sin pasarse).
 * 3. Si todas las porciones viejas estaban marcadas → todas las nuevas quedan marcadas
 *    (caso existente que no debe romperse).
 * 4. Lo que no cuadre exacto queda sin marcar (marcar de menos es seguro: el picker
 *    vuelve a tocar; marcar de más afirma bicis que nadie tomó). Se devuelve en `lost`.
 * 5. Llaves que no son de ninguna porción del reparto viejo (formatos raros o llaves
 *    de otros orígenes) se conservan tal cual si siguen existiendo en el nuevo.
 */

export interface LostUnits {
  sku: string;
  location: string | null;
  units: number;
}

export interface ReconcileCheckedKeysResult {
  keys: string[];
  lost: LostUnits[];
}

export interface PortionItem {
  sku: string;
  location?: string | null;
  pickingQty: number;
}

export interface PalletLike {
  id: number;
  items: readonly PortionItem[];
}

interface Portion {
  palletId: number;
  sku: string;
  location: string | null;
  pickingQty: number;
  key: string;
}

function portionKey(palletId: number, sku: string, location: string | null): string {
  return `${palletId}-${sku}-${location}`;
}

function makeGroupKey(sku: string, location: string | null): string {
  return `${sku}\0${location ?? ''}\0${location === null ? 'null' : 'loc'}`;
}

/**
 * Busca el subconjunto de porciones disponibles cuya suma de unidades sea <= capacity,
 * maximizando la suma de unidades (conserve la mayor cantidad sin pasarse).
 *
 * Desempate:
 * 1. Mayor cantidad de porciones con un palletId que estaba marcado en el reparto viejo.
 * 2. Menor cantidad de porciones (combinación más compacta).
 * 3. Orden original de candidatos en el nuevo reparto.
 */
function findBestPortionCombination(
  candidates: readonly Portion[],
  capacity: number,
  markedPalletIds: ReadonlySet<number>
): Portion[] {
  if (candidates.length === 0 || capacity <= 0) return [];

  let bestSubset: Portion[] = [];
  let bestWeight = 0;
  let bestFavoredCount = 0;

  function isBetter(
    weight: number,
    favoredCount: number,
    subsetLen: number,
    curBestWeight: number,
    curBestFavoredCount: number,
    curBestSubsetLen: number
  ): boolean {
    if (weight !== curBestWeight) {
      return weight > curBestWeight;
    }
    if (favoredCount !== curBestFavoredCount) {
      return favoredCount > curBestFavoredCount;
    }
    return subsetLen < curBestSubsetLen;
  }

  function search(
    index: number,
    currentSubset: Portion[],
    currentWeight: number,
    currentFavored: number
  ) {
    if (
      isBetter(
        currentWeight,
        currentFavored,
        currentSubset.length,
        bestWeight,
        bestFavoredCount,
        bestSubset.length
      )
    ) {
      bestWeight = currentWeight;
      bestFavoredCount = currentFavored;
      bestSubset = [...currentSubset];
    }

    for (let i = index; i < candidates.length; i++) {
      const candidate = candidates[i];
      const nextWeight = currentWeight + candidate.pickingQty;
      if (nextWeight <= capacity) {
        currentSubset.push(candidate);
        const nextFavored = currentFavored + (markedPalletIds.has(candidate.palletId) ? 1 : 0);
        search(i + 1, currentSubset, nextWeight, nextFavored);
        currentSubset.pop();
      }
    }
  }

  search(0, [], 0, 0);
  return bestSubset;
}

export function reconcileCheckedKeys(
  prevPallets: readonly PalletLike[],
  nextPallets: readonly PalletLike[],
  checkedKeys: ReadonlySet<string> | readonly string[]
): ReconcileCheckedKeysResult {
  const checkedSet = checkedKeys instanceof Set ? checkedKeys : new Set(checkedKeys);

  const oldPortionKeys = new Set<string>();
  const prevGroups = new Map<
    string,
    { sku: string; location: string | null; portions: Portion[] }
  >();

  for (const p of prevPallets) {
    for (const item of p.items) {
      const sku = item.sku ?? '';
      const location = item.location ?? null;
      const pickingQty = Math.max(0, Number(item.pickingQty) || 0);
      const key = portionKey(p.id, sku, location);
      oldPortionKeys.add(key);

      const groupKey = makeGroupKey(sku, location);
      let g = prevGroups.get(groupKey);
      if (!g) {
        g = { sku, location, portions: [] };
        prevGroups.set(groupKey, g);
      }
      g.portions.push({
        palletId: p.id,
        sku,
        location,
        pickingQty,
        key,
      });
    }
  }

  const newPortionKeys = new Set<string>();
  const nextGroups = new Map<
    string,
    { sku: string; location: string | null; portions: Portion[] }
  >();

  for (const p of nextPallets) {
    for (const item of p.items) {
      const sku = item.sku ?? '';
      const location = item.location ?? null;
      const pickingQty = Math.max(0, Number(item.pickingQty) || 0);
      const key = portionKey(p.id, sku, location);
      newPortionKeys.add(key);

      const groupKey = makeGroupKey(sku, location);
      let g = nextGroups.get(groupKey);
      if (!g) {
        g = { sku, location, portions: [] };
        nextGroups.set(groupKey, g);
      }
      g.portions.push({
        palletId: p.id,
        sku,
        location,
        pickingQty,
        key,
      });
    }
  }

  const selectedKeys = new Set<string>();
  const lost: LostUnits[] = [];

  // Recorrer todos los grupos de (sku, ubicación) presentes en el reparto anterior
  for (const [groupKey, prevGroup] of prevGroups.entries()) {
    const { sku, location, portions: oldPortions } = prevGroup;
    const newPortions = nextGroups.get(groupKey)?.portions ?? [];

    const markedOldPortions = oldPortions.filter((p) => checkedSet.has(p.key));
    if (markedOldPortions.length === 0) {
      // Ninguna porción vieja estaba marcada
      continue;
    }

    const allOldMarked = markedOldPortions.length === oldPortions.length;
    if (allOldMarked) {
      // 3. Si todas las porciones viejas estaban marcadas → todas las nuevas quedan marcadas
      for (const np of newPortions) {
        selectedKeys.add(np.key);
      }
      continue;
    }

    // Marcado parcial en el reparto viejo
    const markedUnits = markedOldPortions.reduce((sum, p) => sum + p.pickingQty, 0);

    // Paso 1: Primero las que conservan la misma llave (mismo pallet id) y la misma cantidad
    const step1Selected: Portion[] = [];
    const availableNew: Portion[] = [];
    const matchedOldIndices = new Set<number>();

    for (const np of newPortions) {
      const matchIdx = markedOldPortions.findIndex(
        (op, idx) =>
          !matchedOldIndices.has(idx) &&
          op.palletId === np.palletId &&
          op.pickingQty === np.pickingQty
      );
      if (matchIdx !== -1) {
        matchedOldIndices.add(matchIdx);
        step1Selected.push(np);
      } else {
        availableNew.push(np);
      }
    }

    for (const p of step1Selected) {
      selectedKeys.add(p.key);
    }

    const unitsFromStep1 = step1Selected.reduce((sum, p) => sum + p.pickingQty, 0);
    const remainingUnits = markedUnits - unitsFromStep1;

    // Paso 2: Después las que quepan exactas en lo que falta (mejor combinación <= remainingUnits)
    let unitsFromStep2 = 0;
    if (remainingUnits > 0 && availableNew.length > 0) {
      const markedPalletIds = new Set(markedOldPortions.map((p) => p.palletId));
      const step2Selected = findBestPortionCombination(
        availableNew,
        remainingUnits,
        markedPalletIds
      );
      for (const p of step2Selected) {
        selectedKeys.add(p.key);
      }
      unitsFromStep2 = step2Selected.reduce((sum, p) => sum + p.pickingQty, 0);
    }

    const preservedUnits = unitsFromStep1 + unitsFromStep2;
    const lostUnits = markedUnits - preservedUnits;
    if (lostUnits > 0) {
      lost.push({ sku, location, units: lostUnits });
    }
  }

  // 5. Llaves que no son de ninguna porción del reparto viejo (formatos raros, llaves de otros
  // orígenes) se conservan tal cual si siguen existiendo en el nuevo.
  for (const key of checkedSet) {
    if (!oldPortionKeys.has(key) && newPortionKeys.has(key)) {
      selectedKeys.add(key);
    }
  }

  // Ordenar llaves según el orden natural del nuevo reparto
  const resultKeys: string[] = [];
  const seenKeys = new Set<string>();

  for (const p of nextPallets) {
    for (const item of p.items) {
      const key = portionKey(p.id, item.sku ?? '', item.location ?? null);
      if (selectedKeys.has(key) && !seenKeys.has(key)) {
        seenKeys.add(key);
        resultKeys.push(key);
      }
    }
  }

  for (const key of selectedKeys) {
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      resultKeys.push(key);
    }
  }

  return { keys: resultKeys, lost };
}
