import postgres from 'postgres';
import * as dotenv from 'dotenv';

dotenv.config();

const dbUrl = process.env.PROD_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function fetchPlacedSkusSales() {
  const sql = postgres(dbUrl, { max: 1, timeout: 10 });
  const skus = ['03-3982BL', '03-3978BL', '03-3983GY'];

  try {
    console.log('📊 Sales Statistics for requested SKUs:');
    for (const sku of skus) {
      const stats = await sql`
        SELECT * FROM public.get_sku_movement_stats(${sku}, NOW() - INTERVAL '12 months')
      `;
      const s = stats[0];
      console.log(`SKU: ${sku} | Orders 12m: ${s.orders_completed} | Units Shipped: ${s.units_shipped}u | Last Shipped: ${s.last_shipped}`);
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await sql.end();
  }
}

fetchPlacedSkusSales();
