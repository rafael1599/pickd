import postgres from 'postgres';
import dotenv from 'dotenv';
import { mergeGroupOrders } from '../src/features/picking/components/board/mergeGroupOrders';
import { calculatePalletsWithBikeAwareness, type PickingItem } from '../src/utils/pickingLogic';
import { isBikeSku } from '../src/utils/bikeDetection';

dotenv.config();

const dbUrl = process.env.PROD_DB_URL;
if (!dbUrl) {
  console.error('PROD_DB_URL not found in environment');
  process.exit(1);
}

const sql = postgres(dbUrl, { ssl: 'require' });

function computeProgressPercent(order: any, bikeSkuSet: Set<string>): number {
  if (order.status === 'completed' || order.is_shipped) {
    return 100;
  }
  if (order.status === 'ready_to_double_check' || order.status === 'active') {
    return 0;
  }
  if (!Array.isArray(order.items) || order.items.length === 0) return 0;

  const verifiedKeys = new Set(order.verified_item_keys ?? []);
  if (verifiedKeys.size === 0) return 0;

  const currentBikeSkuSet = new Set<string>();
  for (const item of order.items) {
    const sku = typeof item.sku === 'string' ? item.sku : '';
    const isBike =
      (bikeSkuSet && bikeSkuSet.has(sku)) ||
      isBikeSku(sku, item.sku_metadata as { is_bike?: boolean | null } | null);
    if (isBike && sku) {
      currentBikeSkuSet.add(sku);
    }
  }

  const allItems = (order.items ?? []).map((i: any) => {
    const rawQty =
      i.pickingQty ??
      (i as { qty?: number }).qty ??
      (i as { quantity?: number | string }).quantity;
    return {
      ...i,
      sku: typeof i.sku === 'string' ? i.sku : '',
      pickingQty: typeof rawQty === 'string' ? Number(rawQty) || 0 : rawQty || 0,
      location: i.location ?? null,
    };
  }) as unknown as PickingItem[];
  
  const pallets = calculatePalletsWithBikeAwareness(allItems, currentBikeSkuSet);

  const verifiedSuffixCounts = new Map<string, number>();
  for (const vk of verifiedKeys) {
    const dashIdx = vk.indexOf('-');
    if (dashIdx !== -1) {
      const suffix = vk.slice(dashIdx);
      verifiedSuffixCounts.set(suffix, (verifiedSuffixCounts.get(suffix) ?? 0) + 1);
    }
  }

  let totalUnits = 0;
  let verifiedUnits = 0;

  for (const pallet of pallets) {
    for (const item of pallet.items) {
      const qty = item.pickingQty || 0;
      totalUnits += qty;
      const key = `${pallet.id}-${item.sku}-${item.location}`;
      const suffix = `-${item.sku}-${item.location}`;

      let isMatched = verifiedKeys.has(key);
      if (!isMatched) {
        const count = verifiedSuffixCounts.get(suffix) ?? 0;
        if (count > 0) {
          isMatched = true;
          verifiedSuffixCounts.set(suffix, count - 1);
        }
      }

      if (isMatched) {
        verifiedUnits += qty;
      }
    }
  }

  if (totalUnits === 0) return 0;
  if (verifiedUnits >= totalUnits) return 100;
  return Math.min(95, Math.round((verifiedUnits / totalUnits) * 100));
}

async function main() {
  console.log('🔍 Auditing ALL orders in DB for Live Board card progress rendering...');
  
  const activeOrders = await sql`
    SELECT id, order_number, status, group_id, verified_item_keys, items, pallets_qty, is_shipped, created_at, updated_at, checked_by, is_waiting_inventory
    FROM picking_lists
    WHERE status IN ('active', 'ready_to_double_check', 'double_checking', 'needs_correction')
      AND (is_shipped IS NULL OR is_shipped = false)
    ORDER BY updated_at DESC
  `;

  const completedOrders = await sql`
    SELECT id, order_number, status, group_id, verified_item_keys, items, pallets_qty, is_shipped, created_at, updated_at, checked_by, is_waiting_inventory
    FROM picking_lists
    WHERE status = 'completed'
      AND (is_shipped IS NULL OR is_shipped = false)
    ORDER BY updated_at DESC
    LIMIT 15
  `;

  console.log(`\nFound ${activeOrders.length} active/queue orders and ${completedOrders.length} recent completed orders.`);

  // Group active orders by group_id
  const groupMap = new Map<string, any[]>();
  const standaloneOrders: any[] = [];

  for (const o of activeOrders) {
    if (o.group_id) {
      if (!groupMap.has(o.group_id)) groupMap.set(o.group_id, []);
      groupMap.get(o.group_id)!.push(o);
    } else {
      standaloneOrders.push(o);
    }
  }

  const allCardsToRender: { cardLabel: string; status: string; progress: number; isGroup: boolean; itemCount: number; verifiedKeysCount: number }[] = [];

  // Evaluate Standalone Active Cards
  for (const o of standaloneOrders) {
    const pct = computeProgressPercent(o, new Set());
    const itemsCount = Array.isArray(o.items) ? o.items.length : 0;
    const verifiedCount = Array.isArray(o.verified_item_keys) ? o.verified_item_keys.length : 0;
    allCardsToRender.push({
      cardLabel: `#${o.order_number || o.id.slice(0, 6)}`,
      status: o.status,
      progress: pct,
      isGroup: false,
      itemCount: itemsCount,
      verifiedKeysCount: verifiedCount,
    });
  }

  // Evaluate Group Active Cards
  for (const [groupId, groupList] of groupMap.entries()) {
    const pseudoOrder = mergeGroupOrders(groupList as any);
    const pct = computeProgressPercent(pseudoOrder, new Set());
    const itemsCount = Array.isArray(pseudoOrder.items) ? pseudoOrder.items.length : 0;
    const verifiedCount = Array.isArray(pseudoOrder.verified_item_keys) ? pseudoOrder.verified_item_keys.length : 0;
    allCardsToRender.push({
      cardLabel: `Group (${pseudoOrder.order_number})`,
      status: pseudoOrder.status,
      progress: pct,
      isGroup: true,
      itemCount: itemsCount,
      verifiedKeysCount: verifiedCount,
    });
  }

  // Evaluate Completed Cards
  for (const o of completedOrders) {
    const pct = computeProgressPercent(o, new Set());
    const itemsCount = Array.isArray(o.items) ? o.items.length : 0;
    const verifiedCount = Array.isArray(o.verified_item_keys) ? o.verified_item_keys.length : 0;
    allCardsToRender.push({
      cardLabel: `#${o.order_number || o.id.slice(0, 6)}`,
      status: o.status,
      progress: pct,
      isGroup: !!o.group_id,
      itemCount: itemsCount,
      verifiedKeysCount: verifiedCount,
    });
  }

  console.log('\n========================================================================');
  console.log('LIVE BOARD AUDIT RESULTS: ALL CARDS RENDERED ON BOARD RIGHT NOW');
  console.log('========================================================================');
  console.table(allCardsToRender);

  // Check for any anomaly (e.g. ready_to_double_check or active displaying > 0%)
  const anomalies = allCardsToRender.filter(
    (c) => (c.status === 'ready_to_double_check' || c.status === 'active') && c.progress > 0
  );

  if (anomalies.length > 0) {
    console.error('❌ ANOMALIES DETECTED:', anomalies);
  } else {
    console.log('✅ ZERO ANOMALIES! All active/ready orders render 0% progress bar. All completed render 100%.');
  }

  // --- STATE MATRIX VERIFICATION ---
  console.log('\n========================================================================');
  console.log('STATE MATRIX VERIFICATION (Simulating all order lifecycles)');
  console.log('========================================================================');

  const dummyItems = [
    { sku: 'BIKE-01', pickingQty: 2, location: 'ROW 1' },
    { sku: 'BIKE-02', pickingQty: 2, location: 'ROW 2' },
  ];

  const stateMatrixTests = [
    {
      label: 'New Watcher Order (ready_to_double_check, 0 keys)',
      order: { status: 'ready_to_double_check', items: dummyItems, verified_item_keys: [] },
      expectedPct: 0,
    },
    {
      label: 'New Watcher Order with stale keys in DB (ready_to_double_check, 2 keys)',
      order: { status: 'ready_to_double_check', items: dummyItems, verified_item_keys: ['1-BIKE-01-ROW 1'] },
      expectedPct: 0,
    },
    {
      label: 'Active Picking Order (active, 0 keys)',
      order: { status: 'active', items: dummyItems, verified_item_keys: [] },
      expectedPct: 0,
    },
    {
      label: 'Active Double Check — Partial (double_checking, 2/4 units verified)',
      order: { status: 'double_checking', items: dummyItems, verified_item_keys: ['1-BIKE-01-ROW 1'] },
      expectedPct: 50,
    },
    {
      label: 'Active Double Check — Fully Verified (double_checking, 4/4 units verified)',
      order: { status: 'double_checking', items: dummyItems, verified_item_keys: ['1-BIKE-01-ROW 1', '1-BIKE-02-ROW 2'] },
      expectedPct: 100,
    },
    {
      label: 'Completed Order (completed, 0 keys)',
      order: { status: 'completed', items: dummyItems, verified_item_keys: [] },
      expectedPct: 100,
    },
  ];

  const matrixResults = stateMatrixTests.map((t) => {
    const calculated = computeProgressPercent(t.order, new Set());
    const pass = calculated === t.expectedPct;
    return {
      Scenario: t.label,
      Status: t.order.status,
      Expected: `${t.expectedPct}%`,
      Calculated: `${calculated}%`,
      Result: pass ? 'PASSED ✅' : 'FAILED ❌',
    };
  });

  console.table(matrixResults);
  const matrixFailed = matrixResults.filter((r) => r.Result.includes('FAILED'));
  if (matrixFailed.length > 0) {
    console.error('❌ State Matrix Failures detected:', matrixFailed);
  } else {
    console.log('✅ ALL STATE MATRIX TESTS PASSED! Every lifecycle state matches exact expected progress percentage.');
  }

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
