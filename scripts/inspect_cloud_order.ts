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

async function main() {
  console.log('🔍 Connecting to database and searching for order 880965 / 880962...');
  
  const orders = await sql`
    SELECT id, order_number, status, group_id, verified_item_keys, items, pallets_qty, user_id, checked_by, is_shipped, created_at, updated_at
    FROM picking_lists
    WHERE order_number ILIKE '%880965%' OR order_number ILIKE '%880962%'
  `;

  console.log(`Found ${orders.length} order(s):`);
  for (const o of orders) {
    console.log(`\n========================================`);
    console.log(`ORDER ID: ${o.id} | Number: ${o.order_number} | Status: ${o.status}`);
    console.log(`Group ID: ${o.group_id}`);
    console.log(`Pallets Qty: ${o.pallets_qty}`);
    console.log(`verified_item_keys count: ${(o.verified_item_keys as string[])?.length ?? 0}`);
    console.log(`verified_item_keys:`, o.verified_item_keys);
    console.log(`Items count: ${(o.items as any[])?.length}`);
    console.log(`Items:`, JSON.stringify(o.items, null, 2));
  }

  if (orders.length === 0) {
    await sql.end();
    return;
  }

  const pseudoOrder = mergeGroupOrders(orders as any);
  console.log('\n========================================');
  console.log('--- MERGED PSEUDO ORDER (What SortableOrderCard receives) ---');
  console.log('Order Number:', pseudoOrder.order_number);
  console.log('Status:', pseudoOrder.status);
  console.log('Merged verified_item_keys count:', pseudoOrder.verified_item_keys?.length);
  console.log('Merged verified_item_keys:', pseudoOrder.verified_item_keys);

  const verifiedKeys = new Set(pseudoOrder.verified_item_keys ?? []);
  
  const allItems = (pseudoOrder.items ?? []).map((i: any) => {
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
  }) as PickingItem[];

  console.log(`\nAll Items (${allItems.length} items):`);
  allItems.forEach(i => console.log(`  SKU: ${i.sku}, Loc: ${i.location}, pickingQty: ${i.pickingQty}`));

  const bikeSkuSet = new Set<string>();
  for (const item of allItems) {
    if (isBikeSku(item.sku, (item as any).sku_metadata)) {
      if (item.sku) bikeSkuSet.add(item.sku);
    }
  }

  const pallets = calculatePalletsWithBikeAwareness(allItems, bikeSkuSet);
  console.log(`\nCalculated ${pallets.length} Pallet(s):`);

  // Build map of verified key occurrences per suffix `-${sku}-${location}`
  const verifiedSuffixCounts = new Map<string, number>();
  for (const vk of verifiedKeys) {
    // vk is e.g. "1-03-4662YL-ROW 3"
    const dashIdx = vk.indexOf('-');
    if (dashIdx !== -1) {
      const suffix = vk.slice(dashIdx); // "-03-4662YL-ROW 3"
      verifiedSuffixCounts.set(suffix, (verifiedSuffixCounts.get(suffix) ?? 0) + 1);
    }
  }

  let totalUnits = 0;
  let verifiedUnits = 0;

  for (const pallet of pallets) {
    console.log(`\n--- Pallet ID ${pallet.id} (isParts: ${pallet.isParts}, totalUnits: ${pallet.totalUnits}) ---`);
    for (const item of pallet.items) {
      const qty = item.pickingQty || 0;
      totalUnits += qty;
      const key = `${pallet.id}-${item.sku}-${item.location}`;
      const suffix = `-${item.sku}-${item.location}`;

      let isMatched = verifiedKeys.has(key);
      if (!isMatched) {
        // Fallback: check if verifiedSuffixCounts has available count for this suffix
        const count = verifiedSuffixCounts.get(suffix) ?? 0;
        if (count > 0) {
          isMatched = true;
          verifiedSuffixCounts.set(suffix, count - 1);
        }
      }
      if (isMatched) {
        verifiedUnits += qty;
      }
      console.log(`  Item: SKU=${item.sku}, Loc="${item.location}", Qty=${qty} | Generated Key: "${key}" | Matched: ${isMatched}`);
    }
  }

  console.log(`\n========================================`);
  console.log(`TOTAL UNITS: ${totalUnits}`);
  console.log(`VERIFIED UNITS MATCHED: ${verifiedUnits}`);
  const pct = totalUnits > 0 ? Math.round((verifiedUnits / totalUnits) * 100) : 0;
  console.log(`Calculated Percentage: ${pct}%`);
  console.log(`Final progressPercent: ${verifiedUnits >= totalUnits ? 100 : Math.min(95, pct)}%`);
  console.log(`========================================\n`);

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
