import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Find all orders that have a group_id
  const { data, error } = await supabase
    .from('picking_lists')
    .select('id, group_id, is_shipped, order_number, status')
    .not('group_id', 'is', null);

  if (error) throw error;
  
  // Group by group_id
  const groups = {};
  for (const o of data) {
    if (!groups[o.group_id]) groups[o.group_id] = [];
    groups[o.group_id].push(o);
  }
  
  // Find groups with mixed is_shipped status
  for (const [gid, orders] of Object.entries(groups)) {
    const hasShipped = orders.some(o => o.is_shipped);
    const hasUnshipped = orders.some(o => !o.is_shipped);
    
    if (hasShipped && hasUnshipped) {
      console.log(`Group ${gid} has mixed shipped statuses:`);
      for (const o of orders) {
        console.log(`  - #${o.order_number} (${o.id}): is_shipped=${o.is_shipped}, status=${o.status}`);
      }
      
      // Fix it: mark all unshipped as shipped and completed
      const toFix = orders.filter(o => !o.is_shipped).map(o => o.id);
      console.log(`  Fixing: ${toFix.join(', ')}`);
      
      const { error: updErr } = await supabase
        .from('picking_lists')
        .update({ is_shipped: true, status: 'completed' })
        .in('id', toFix);
        
      if (updErr) {
        console.error('Error fixing group', gid, updErr);
      } else {
        console.log('Fixed group', gid);
      }
    }
  }
  console.log('Done checking and fixing groups.');
}
main();
