import dotenv from 'dotenv';
dotenv.config();

if (!process.env.VITE_SUPABASE_URL) {
  process.env.VITE_SUPABASE_URL = 'http://127.0.0.1:54321';
}
if (!process.env.VITE_SUPABASE_ANON_KEY) {
  process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
}

import { createClient } from '@supabase/supabase-js';
import { mergeGroupOrders } from '../src/features/picking/components/board/mergeGroupOrders';
import { calculatePalletsWithBikeAwareness, type PickingItem } from '../src/utils/pickingLogic';
import { isBikeSku } from '../src/utils/bikeDetection';

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('🔍 Fetching all picking_lists from local Supabase DB...');
  const { data: allLists, error: fetchErr } = await supabase
    .from('picking_lists')
    .select('id, order_number, status, group_id, verified_item_keys, items')
    .limit(50);

  if (fetchErr) {
    console.error('Error fetching picking_lists:', fetchErr);
    return;
  }

  console.log(`Found ${allLists?.length ?? 0} total picking_list rows in local DB:`);
  console.table(allLists?.map(l => ({
    id: l.id,
    order_number: l.order_number,
    status: l.status,
    group_id: l.group_id,
    verified_keys_count: (l.verified_item_keys as string[])?.length ?? 0,
    items_count: (l.items as any[])?.length ?? 0,
  })));

  const ordersToTest = allLists || [];
  if (ordersToTest.length === 0) return;

  const pseudoOrder = mergeGroupOrders(ordersToTest as any);
  console.log('\n--- MERGED PSEUDO ORDER ---');
  console.log('Order Number:', pseudoOrder.order_number);
  console.log('Status:', pseudoOrder.status);
  console.log('Merged verified_item_keys count:', pseudoOrder.verified_item_keys?.length);

  const verifiedKeys = new Set(pseudoOrder.verified_item_keys ?? []);
  const allItems = (pseudoOrder.items ?? []).map((i: any) => {
    const rawQty = i.pickingQty ?? i.qty ?? i.quantity;
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
  console.log(`\nCalculated ${pallets.length} pallet(s):`);
  
  let totalUnits = 0;
  let verifiedUnits = 0;

  for (const pallet of pallets) {
    console.log(`\nPallet ${pallet.id} (${pallet.items.length} items, isParts: ${pallet.isParts}):`);
    for (const item of pallet.items) {
      const qty = item.pickingQty || 0;
      totalUnits += qty;
      const key = `${pallet.id}-${item.sku}-${item.location}`;
      const isMatched = verifiedKeys.has(key);
      if (isMatched) {
        verifiedUnits += qty;
      }
      console.log(`  Item: SKU=${item.sku}, Loc=${item.location}, Qty=${qty} -> Generated Key: "${key}", Matched: ${isMatched}`);
    }
  }

  console.log(`\nTOTAL UNITS: ${totalUnits}, VERIFIED UNITS: ${verifiedUnits}`);
  const pct = totalUnits > 0 ? Math.round((verifiedUnits / totalUnits) * 100) : 0;
  console.log(`Raw Percentage: ${pct}%`);
  console.log(`Final progressPercent: ${verifiedUnits >= totalUnits ? 100 : Math.min(95, pct)}%`);
}

main().catch(console.error);
