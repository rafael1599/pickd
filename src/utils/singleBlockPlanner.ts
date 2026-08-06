// Unified 4-Row DS-Pallet Planner with Dynamic Per-SKU Capacity & Physical Accessibility.
//
// Integrates:
// 1. Unified 4-Row Block: ROW 33, 32, 31, 30 with 10 positions (A..J).
// 2. Column A: Dedicated Surplus / Remainder Slot.
// 3. Columns B..J: Full DS-Pallet Slots.
// 4. Dynamic Pallet Capacity: Custom capacity per SKU (e.g. 35u for 03-xyzbr, default 25u).
// 5. Accessibility Guards: Distinguishes 'accessible' vs 'landlocked' positions (middle rows 31 & 32 positions B..I).
// 6. Placement Priority: Multi-pallet SKUs absorb landlocked positions first to prevent single-pallet SKUs from getting trapped.
// 7. Physical Anchoring: Preserves current physical cell if candidate already stands in the block.
// 8. Origin Locations: Tracks original physical location(s) in warehouse where stock is pulled from.
// 9. 100% Automatic Full Block Fill.

export type Accessibility = 'accessible' | 'landlocked';

export interface SingleBlockConfig {
  id: string;
  label: string;
  rows: string[]; // ['33', '32', '31', '30']
  positionsPerRow: number; // 10
  sobranteLetter: string; // 'A'
  defaultPalletCapacity: number; // 25
}

export const UNIFIED_FOUR_ROW_BLOCK: SingleBlockConfig = {
  id: 'LUDLOW_UNIFIED_4ROW_BLOCK',
  label: 'ROW 33/32/31/30',
  rows: ['33', '32', '31', '30'],
  positionsPerRow: 10,
  sobranteLetter: 'A',
  defaultPalletCapacity: 25,
};

export type SlotUsage =
  | { kind: 'empty' }
  | { kind: 'sobrante'; sku: string; units: number }
  | { kind: 'pallet'; sku: string; units: number; capacity: number; anchored: boolean };

export interface SingleBlockSlot {
  id: string;
  row: string;
  letter: string;
  isSobranteSlot: boolean;
  accessibility: Accessibility;
  usage: SlotUsage;
}

export interface CurrentPlacement {
  row: string;
  letter: string;
  units: number;
}

export interface CandidateSku {
  sku: string;
  totalQty: number;
  daysInactive?: number;
  ordersCompleted12m?: number;
  originLocationSummary?: string;
  currentPlacements?: CurrentPlacement[];
}

export type SkuCapacityOverrides = Record<string, number>;

export interface PlacedSkuSummary {
  sku: string;
  totalQty: number;
  palletCapacity: number;
  fullPalletsCount: number;
  palletSlots: string[];
  sobranteUnits: number;
  sobranteSlot?: string;
  anchoredCount: number;
  originLocationSummary: string;
}

export interface UnplacedSkuSummary {
  sku: string;
  totalQty: number;
  reason: 'no-space' | 'no-stock';
}

export interface SingleBlockPlanResult {
  config: SingleBlockConfig;
  slots: SingleBlockSlot[];
  placedSkus: PlacedSkuSummary[];
  unplacedSkus: UnplacedSkuSummary[];
  stats: {
    totalPalletCells: number;
    usedPalletCells: number;
    totalSobranteCells: number;
    usedSobranteCells: number;
    totalUnitsInPallets: number;
    totalUnitsInSobrantes: number;
    landlockedOccupiedCount: number;
    accessibleOccupiedCount: number;
  };
}

export function positionLetters(count: number): string[] {
  const letters: string[] = [];
  for (let i = 0; i < count; i++) {
    letters.push(String.fromCharCode(65 + i));
  }
  return letters;
}

export function accessibilityFor(
  row: string,
  letterIndex: number,
  config: SingleBlockConfig
): Accessibility {
  const isMiddleRow = row === '32' || row === '31';
  if (!isMiddleRow) return 'accessible';
  const isEndPosition = letterIndex === 0 || letterIndex === config.positionsPerRow - 1;
  return isEndPosition ? 'accessible' : 'landlocked';
}

export function buildSingleBlockLayout(config: SingleBlockConfig): SingleBlockSlot[] {
  const letters = positionLetters(config.positionsPerRow);
  return config.rows.flatMap((row) =>
    letters.map((letter, letterIndex) => ({
      id: `${row}-${letter}`,
      row,
      letter,
      isSobranteSlot: letter === config.sobranteLetter,
      accessibility: accessibilityFor(row, letterIndex, config),
      usage: { kind: 'empty' },
    }))
  );
}

export function sortCandidatesByInactivity<T extends CandidateSku>(candidates: T[]): T[] {
  return [...candidates].sort((a, b) => {
    const daysA = a.daysInactive ?? 9999;
    const daysB = b.daysInactive ?? 9999;
    if (daysB !== daysA) return daysB - daysA;

    const ordersA = a.ordersCompleted12m ?? 0;
    const ordersB = b.ordersCompleted12m ?? 0;
    if (ordersA !== ordersB) return ordersA - ordersB;

    if (b.totalQty !== a.totalQty) return b.totalQty - a.totalQty;
    return a.sku.localeCompare(b.sku);
  });
}

function proximityRank(slot: SingleBlockSlot, letters: string[]): number {
  return letters.length - 1 - letters.indexOf(slot.letter);
}

export function formatOriginSummary(candidate: CandidateSku): string {
  if (candidate.originLocationSummary) return candidate.originLocationSummary;
  if (!candidate.currentPlacements || candidate.currentPlacements.length === 0) {
    return 'No registered location';
  }
  return candidate.currentPlacements
    .map((p) => `ROW ${p.row} · ${p.letter} (${p.units}u)`)
    .join(', ');
}

export function planSingleBlock(
  candidates: CandidateSku[],
  overrides: SkuCapacityOverrides = {},
  config: SingleBlockConfig = UNIFIED_FOUR_ROW_BLOCK
): SingleBlockPlanResult {
  const letters = positionLetters(config.positionsPerRow);
  const slots = buildSingleBlockLayout(config);
  const orderedCandidates = sortCandidatesByInactivity(candidates);

  const getCapacity = (sku: string) => overrides[sku] ?? config.defaultPalletCapacity;

  const placedSkus: PlacedSkuSummary[] = [];
  const unplacedSkus: UnplacedSkuSummary[] = [];

  const isPalletSlotEmpty = (s: SingleBlockSlot) => !s.isSobranteSlot && s.usage.kind === 'empty';
  const isSobranteSlotEmpty = (s: SingleBlockSlot) => s.isSobranteSlot && s.usage.kind === 'empty';

  // 1. Process Anchors first
  const anchoredSlotsBySku = new Map<string, SingleBlockSlot[]>();

  for (const candidate of orderedCandidates) {
    if (!candidate.currentPlacements || candidate.currentPlacements.length === 0) continue;
    const capacity = getCapacity(candidate.sku);
    if (candidate.totalQty < capacity) continue;

    for (const placement of candidate.currentPlacements) {
      if (!config.rows.includes(placement.row)) continue;
      const targetSlot = slots.find(
        (s) => s.row === placement.row && s.letter === placement.letter
      );
      if (targetSlot && !targetSlot.isSobranteSlot && targetSlot.usage.kind === 'empty') {
        targetSlot.usage = {
          kind: 'pallet',
          sku: candidate.sku,
          units: capacity,
          capacity,
          anchored: true,
        };
        const list = anchoredSlotsBySku.get(candidate.sku) ?? [];
        list.push(targetSlot);
        anchoredSlotsBySku.set(candidate.sku, list);
        break;
      }
    }
  }

  // 2. Order for placement: Multi-pallet SKUs first
  const multiPalletSkus: CandidateSku[] = [];
  const singlePalletSkus: CandidateSku[] = [];

  for (const candidate of orderedCandidates) {
    const capacity = getCapacity(candidate.sku);
    const fullPallets = Math.floor(candidate.totalQty / capacity);
    if (fullPallets >= 2) multiPalletSkus.push(candidate);
    else singlePalletSkus.push(candidate);
  }

  const sortedForPlacement = [...multiPalletSkus, ...singlePalletSkus];

  // 3. Main Placement Loop
  for (const candidate of sortedForPlacement) {
    if (!candidate.totalQty || candidate.totalQty <= 0) {
      unplacedSkus.push({ sku: candidate.sku, totalQty: 0, reason: 'no-stock' });
      continue;
    }

    const capacity = getCapacity(candidate.sku);
    const existingAnchors = anchoredSlotsBySku.get(candidate.sku) ?? [];
    const neededPallets = Math.floor(candidate.totalQty / capacity) - existingAnchors.length;
    const sobranteUnits = candidate.totalQty % capacity;

    const availablePalletSlots = slots.filter(isPalletSlotEmpty);
    const palletsToPlace = Math.max(0, Math.min(neededPallets, availablePalletSlots.length));
    const unplacedPallets = Math.max(0, neededPallets - palletsToPlace);

    if (unplacedPallets > 0) {
      unplacedSkus.push({
        sku: candidate.sku,
        totalQty: unplacedPallets * capacity,
        reason: 'no-space',
      });
    }

    const assignedPalletSlots: SingleBlockSlot[] = [...existingAnchors];
    const isMulti = Math.floor(candidate.totalQty / capacity) >= 2;

    for (let p = 0; p < palletsToPlace; p++) {
      const currentAvailable = slots.filter(isPalletSlotEmpty);
      if (currentAvailable.length === 0) break;

      const preferLandlocked = isMulti && assignedPalletSlots.length > 0;

      const pool = (acc: Accessibility) =>
        currentAvailable
          .filter((s) => s.accessibility === acc)
          .sort((a, b) => proximityRank(a, letters) - proximityRank(b, letters));

      const primary = pool(preferLandlocked ? 'landlocked' : 'accessible');
      const fallback = pool(preferLandlocked ? 'accessible' : 'landlocked');

      const targetSlot = primary[0] ?? fallback[0];
      if (!targetSlot) break;

      targetSlot.usage = {
        kind: 'pallet',
        sku: candidate.sku,
        units: capacity,
        capacity,
        anchored: false,
      };
      assignedPalletSlots.push(targetSlot);
    }

    let assignedSobranteSlot: SingleBlockSlot | undefined = undefined;
    if (sobranteUnits > 0) {
      const preferredRow = assignedPalletSlots[0]?.row;
      const freeSobranteSlots = slots.filter(isSobranteSlotEmpty);

      let sobranteTarget = freeSobranteSlots.find((s) => s.row === preferredRow);
      if (!sobranteTarget) {
        sobranteTarget = freeSobranteSlots[0];
      }

      if (sobranteTarget) {
        sobranteTarget.usage = {
          kind: 'sobrante',
          sku: candidate.sku,
          units: sobranteUnits,
        };
        assignedSobranteSlot = sobranteTarget;
      }
    }

    placedSkus.push({
      sku: candidate.sku,
      totalQty: candidate.totalQty,
      palletCapacity: capacity,
      fullPalletsCount: assignedPalletSlots.length,
      palletSlots: assignedPalletSlots.map((s) => s.id),
      sobranteUnits,
      sobranteSlot: assignedSobranteSlot?.id,
      anchoredCount: existingAnchors.length,
      originLocationSummary: formatOriginSummary(candidate),
    });
  }

  // Calculate statistics
  const palletCells = slots.filter((s) => !s.isSobranteSlot);
  const sobranteCells = slots.filter((s) => s.isSobranteSlot);

  const usedPalletCells = palletCells.filter((s) => s.usage.kind === 'pallet');
  const usedSobranteCells = sobranteCells.filter((s) => s.usage.kind === 'sobrante');

  const landlockedOccupied = slots.filter(
    (s) => s.accessibility === 'landlocked' && s.usage.kind === 'pallet'
  ).length;
  const accessibleOccupied = slots.filter(
    (s) => s.accessibility === 'accessible' && s.usage.kind === 'pallet'
  ).length;

  const totalUnitsInPallets = usedPalletCells.reduce(
    (sum, s) => sum + (s.usage.kind === 'pallet' ? s.usage.units : 0),
    0
  );
  const totalUnitsInSobrantes = usedSobranteCells.reduce(
    (sum, s) => sum + (s.usage.kind === 'sobrante' ? s.usage.units : 0),
    0
  );

  return {
    config,
    slots,
    placedSkus,
    unplacedSkus,
    stats: {
      totalPalletCells: palletCells.length,
      usedPalletCells: usedPalletCells.length,
      totalSobranteCells: sobranteCells.length,
      usedSobranteCells: usedSobranteCells.length,
      totalUnitsInPallets,
      totalUnitsInSobrantes,
      landlockedOccupiedCount: landlockedOccupied,
      accessibleOccupiedCount: accessibleOccupied,
    },
  };
}

export function formatPlanForTerminal(result: SingleBlockPlanResult): string {
  const lines: string[] = [];
  lines.push(
    '========================================================================================'
  );
  lines.push(
    `OPTIMIZED PHYSICAL MAP WITH ACCESSIBILITY - UNIFIED (ROWS ${result.config.rows.join(', ')})`
  );
  lines.push(
    '========================================================================================'
  );

  for (const row of result.config.rows) {
    const rowSlots = result.slots.filter((s) => s.row === row);
    const formattedSlots = rowSlots.map((s) => {
      const accTag = s.accessibility === 'landlocked' ? '🔒LOCKED' : '🟢ACC';
      if (s.usage.kind === 'empty') {
        return `${s.letter}(${accTag}): [EMPTY]`;
      }
      if (s.usage.kind === 'sobrante') {
        return `${s.letter} [SURPLUS]: ${s.usage.sku} (${s.usage.units}u)`;
      }
      const anchorTag = s.usage.anchored ? '⚓' : '';
      return `${s.letter}(${accTag}) [PALLET ${s.usage.capacity}u${anchorTag}]: ${s.usage.sku} (${s.usage.units}u)`;
    });
    lines.push(`ROW ${row} | ${formattedSlots.join(' | ')}`);
  }

  lines.push(
    '========================================================================================'
  );
  lines.push('CAPACITY & ACCESSIBILITY STATISTICS:');
  lines.push(
    `- Pallet Cells (Cols B-J): ${result.stats.usedPalletCells}/${result.stats.totalPalletCells} occupied (${result.stats.totalUnitsInPallets} units)`
  );
  lines.push(
    `- Surplus Cells (Col A): ${result.stats.usedSobranteCells}/${result.stats.totalSobranteCells} occupied (${result.stats.totalUnitsInSobrantes} units)`
  );
  lines.push(
    `- Accessibility Distribution: ${result.stats.accessibleOccupiedCount} in Accessible Cells (🟢) | ${result.stats.landlockedOccupiedCount} in Landlocked Cells (🔒)`
  );
  lines.push(
    '========================================================================================'
  );
  lines.push('PLACED SKUs DETAILED BREAKDOWN (WITH ORIGIN LOCATIONS):');

  for (const item of result.placedSkus) {
    const palletsText =
      item.fullPalletsCount > 0
        ? `${item.fullPalletsCount} pallet(s) of ${item.palletCapacity}u in [${item.palletSlots.join(', ')}]`
        : '0 pallets';
    const sobranteText = item.sobranteSlot
      ? `Surplus: ${item.sobranteUnits}u in [${item.sobranteSlot}]`
      : item.sobranteUnits > 0
        ? `Surplus: ${item.sobranteUnits}u (no space in Col A)`
        : 'No surplus';
    const anchorText = item.anchoredCount > 0 ? ` [⚓ ${item.anchoredCount} anchored]` : '';

    lines.push(
      `• ${item.sku.padEnd(12)} | Origin: ${item.originLocationSummary.padEnd(30)} | Total: ${String(item.totalQty).padStart(4)}u | Cap: ${item.palletCapacity}u${anchorText} | ${palletsText} | ${sobranteText}`
    );
  }

  if (result.unplacedSkus.length > 0) {
    lines.push(
      '----------------------------------------------------------------------------------------'
    );
    lines.push('UNPLACED SKUs (NO SPACE / NO STOCK):');
    for (const item of result.unplacedSkus) {
      lines.push(
        `• ${item.sku.padEnd(12)} | Total: ${String(item.totalQty).padStart(4)}u | Reason: ${item.reason}`
      );
    }
  }

  lines.push(
    '========================================================================================'
  );

  return lines.join('\n');
}
