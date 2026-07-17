import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'SUPABASE_KEY';
const supabase = createClient(supabaseUrl, supabaseKey);

const SEARCH_QUERY = 'A';

async function runTest() {
  console.log(`\n--- TESTING SEARCH OPTIMIZATION (Search Query: "${SEARCH_QUERY}") ---\n`);

  let oldPayloadSize = 0;

  // --- OLD METHOD ---
  console.log('1. OLD METHOD: Fetch 3000 rows (Client-side filtering simulated)');
  let start = performance.now();
  const { data: oldData, error: oldError } = await supabase
    .from('picking_lists')
    .select(
      `
      *,
      customer:customers(id, name, street, city, state, zip_code, phone),
      order_group:order_groups(group_type),
      user:profiles!user_id(full_name),
      checker:profiles!checked_by(full_name)
    `
    )
    .order('created_at', { ascending: false })
    .limit(3000);

  let end = performance.now();

  if (oldError) {
    console.error('Old method error:', oldError);
  } else {
    oldPayloadSize = Buffer.byteLength(JSON.stringify(oldData), 'utf8');
    // Simulate JS local filter
    const localFiltered = oldData.filter(
      (o: Record<string, unknown>) =>
        String(o.order_number).toLowerCase().includes(SEARCH_QUERY.toLowerCase()) ||
        String(o.customer?.name).toLowerCase().includes(SEARCH_QUERY.toLowerCase())
    );

    console.log(`⏱  Time taken: ${(end - start).toFixed(2)} ms`);
    console.log(`📦 Payload size downloaded: ${(oldPayloadSize / 1024 / 1024).toFixed(3)} MB`);
    console.log(`📊 Rows fetched: ${oldData.length}`);
    console.log(`🔍 Matches found after local filter: ${localFiltered.length}\n`);
  }

  // --- NEW METHOD ---
  console.log('2. NEW METHOD: Server-side dual search (Limit 100)');
  start = performance.now();

  // Step 1: Find customers
  const { data: customers } = await supabase
    .from('customers')
    .select('id')
    .ilike('name', `%${SEARCH_QUERY}%`)
    .limit(20);

  const customerIds = customers?.map((c) => c.id) || [];

  // Step 2: Main query
  let newQuery = supabase
    .from('picking_lists')
    .select(
      `
      *,
      customer:customers(id, name, street, city, state, zip_code, phone),
      order_group:order_groups(group_type),
      user:profiles!user_id(full_name),
      checker:profiles!checked_by(full_name)
    `
    )
    .order('created_at', { ascending: false })
    .limit(100);

  if (customerIds.length > 0) {
    newQuery = newQuery.or(
      `order_number.ilike.%${SEARCH_QUERY}%,customer_id.in.(${customerIds.join(',')})`
    );
  } else {
    newQuery = newQuery.ilike('order_number', `%${SEARCH_QUERY}%`);
  }

  const { data: newData, error: newError } = await newQuery;
  end = performance.now();

  if (newError) {
    console.error('New method error:', newError);
  } else {
    const newPayloadSize = Buffer.byteLength(JSON.stringify(newData), 'utf8');

    console.log(`⏱  Time taken: ${(end - start).toFixed(2)} ms`);
    console.log(`📦 Payload size downloaded: ${(newPayloadSize / 1024 / 1024).toFixed(3)} MB`);
    console.log(`📊 Rows fetched directly from DB: ${newData.length}\n`);

    const sizeReduction =
      oldPayloadSize > 0
        ? (((oldPayloadSize - newPayloadSize) / oldPayloadSize) * 100).toFixed(1)
        : 0;
    console.log(`🎉 EGRESS SAVED: ${sizeReduction}% less data transferred per keystroke!`);
  }
}

runTest();
