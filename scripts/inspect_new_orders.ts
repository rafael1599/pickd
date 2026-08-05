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
  console.log('🔍 Connecting to database and fetching recent picking_lists...');
  
  const orders = await sql`
    SELECT id, order_number, status, group_id, verified_item_keys, items, pallets_qty, is_shipped, created_at, updated_at
    FROM picking_lists
    ORDER BY created_at DESC
    LIMIT 20
  `;

  console.log(`Found ${orders.length} recent order(s):`);
  for (const o of orders) {
    console.log(`\n========================================`);
    console.log(`ORDER ID: ${o.id} | Number: ${o.order_number} | Status: ${o.status}`);
    console.log(`Created At: ${o.created_at} | Updated At: ${o.updated_at}`);
    console.log(`Group ID: ${o.group_id}`);
    console.log(`is_shipped: ${o.is_shipped}`);
    console.log(`verified_item_keys (${(o.verified_item_keys as string[])?.length ?? 0}):`, o.verified_item_keys);
    console.log(`Items count: ${(o.items as any[])?.length}`);
    
    // Test progress calculation for this order:
    const verifiedKeys = new Set((o.verified_item_keys as string[]) ?? []);
    
    const allItems = ((o.items as any[]) ?? []).map((i: any) => {
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

    const bikeSkuSet = new Set<string>();
    for (const item of allItems) {
      if (isBikeSku(item.sku, (item as any).sku_metadata)) {
        if (item.sku) bikeSkuSet.add(item.sku);
      }
    }

    const pallets = calculatePalletsWithBikeAwareness(allItems, bikeSkuSet);

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

    let progressPercent = 0;
    if (o.status === 'completed' || o.is_shipped) {
      progressPercent = 100;
    } else if (allItems.length === 0 || verifiedKeys.size === 0 || totalUnits === 0) {
      progressPercent = 0;
    } else if (verifiedUnits >= totalUnits) {
      progressPercent = 100;
    } else {
      progressPercent = Math.min(95, Math.round((verifiedUnits / totalUnits) * 100));
    }

    console.log(`Calculated progressPercent: ${progressPercent}% (verifiedKeys size: ${verifiedKeys.size}, totalUnits: ${totalUnits}, verifiedUnits: ${verifiedUnits})`);
  }

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
