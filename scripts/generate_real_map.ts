import postgres from 'postgres';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as dotenv from 'dotenv';
import {
  planSingleBlock,
  UNIFIED_FOUR_ROW_BLOCK,
  type CandidateSku,
  type SkuCapacityOverrides,
} from '../src/utils/singleBlockPlanner';

dotenv.config();

const dbUrl = process.env.PROD_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function runRealMapGeneration() {
  console.log('🔍 Connecting to PostgreSQL Database...');
  const sql = postgres(dbUrl, { max: 1, timeout: 10 });

  try {
    console.log('🚲 Fetching ONLY BIKE SKUs from active inventory (sku_metadata.is_bike = true)...');

    const rawInventory = await sql`
      SELECT i.sku, i.location, i.sublocation, i.quantity, i.item_name
      FROM inventory i
      JOIN sku_metadata md ON md.sku = i.sku AND md.is_bike = true
      WHERE i.is_active = true AND i.quantity > 0
    `;

    console.log(`✅ Loaded ${rawInventory.length} raw bike inventory records.`);

    const skuTotals = new Map<string, number>();
    const skuPlacements = new Map<string, { row: string; letter: string; units: number }[]>();

    for (const row of rawInventory) {
      const qty = Number(row.quantity ?? 0);
      const sku = row.sku as string;
      skuTotals.set(sku, (skuTotals.get(sku) ?? 0) + qty);

      const rowName = (row.location ?? '').replace(/^ROW\s+/i, '').trim();
      const letter = row.sublocation?.[0];
      if (rowName && letter) {
        const list = skuPlacements.get(sku) ?? [];
        list.push({ row: rowName, letter, units: qty });
        skuPlacements.set(sku, list);
      }
    }

    console.log('📊 Fetching shipment logs for movement recency...');
    let movementLogs: { sku: string; created_at: string }[] = [];
    try {
      movementLogs = await sql`
        SELECT sku, created_at
        FROM inventory_log
        WHERE action_type = 'SHIP'
        ORDER BY created_at DESC
        LIMIT 5000
      `;
    } catch {
      console.log('⚠️ Could not fetch inventory_log SHIP events, using default recency.');
    }

    const lastShippedMap = new Map<string, string>();
    for (const log of movementLogs) {
      if (log.sku && !lastShippedMap.has(log.sku)) {
        lastShippedMap.set(log.sku, log.created_at);
      }
    }

    const nowMs = Date.now();
    const candidates: CandidateSku[] = [];

    for (const [sku, totalQty] of skuTotals.entries()) {
      if (totalQty < 20) continue;

      const lastShipped = lastShippedMap.get(sku);
      let daysInactive = 100;
      if (lastShipped) {
        const diffMs = nowMs - new Date(lastShipped).getTime();
        daysInactive = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      }

      const placements = skuPlacements.get(sku) ?? [];
      const originSummary = placements.length > 0
        ? placements.map((p) => `ROW ${p.row} · ${p.letter} (${p.units}u)`).join(', ')
        : 'No registered location';

      candidates.push({
        sku,
        totalQty,
        daysInactive,
        lastShipped: lastShipped ?? null,
        originLocationSummary: originSummary,
        currentPlacements: placements,
      });
    }

    console.log(`🎯 Filtered ${candidates.length} BIKE SKUs with total stock >= 20u.`);

    const realOverrides: SkuCapacityOverrides = {
      '03-xyzbr': 35,
    };

    const result = planSingleBlock(candidates, realOverrides, UNIFIED_FOUR_ROW_BLOCK);

    console.log('\n========================================================================================');
    console.log(`FULL REAL PLAN GENERATED - (${result.placedSkus.length} REAL BIKE SKUs placed)`);
    console.log(`- Pallets Occupied: ${result.stats.usedPalletCells}/36 (${result.stats.totalUnitsInPallets} units)`);
    console.log(`- Surplus Occupied: ${result.stats.usedSobranteCells}/4 (${result.stats.totalUnitsInSobrantes} units)`);
    console.log('========================================================================================\n');

    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PickD - Real Physical Overstock Map for Bikes</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-dark: #0f172a;
      --card-bg: #1e293b;
      --border-color: #334155;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --accent-blue: #38bdf8;
      --accent-green: #22c55e;
      --accent-amber: #f59e0b;
      --locked-red: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', sans-serif;
      background-color: var(--bg-dark);
      color: var(--text-main);
      padding: 30px;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    header {
      margin-bottom: 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 16px;
    }
    h1 { font-size: 24px; font-weight: 700; color: #fff; }
    .subtitle { color: var(--text-muted); font-size: 14px; margin-top: 4px; }
    
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
      margin-bottom: 30px;
    }
    .stat-card {
      background-color: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 10px;
      padding: 16px;
    }
    .stat-label { color: var(--text-muted); font-size: 12px; text-transform: uppercase; }
    .stat-value { font-size: 24px; font-weight: 700; color: #fff; margin-top: 6px; }
    .stat-sub { font-size: 12px; color: var(--accent-blue); margin-top: 2px; }

    .section-title { font-size: 18px; font-weight: 600; margin-bottom: 16px; }

    .map-grid { display: flex; flex-direction: column; gap: 16px; margin-bottom: 40px; }
    .row-card {
      background-color: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 16px;
    }
    .row-header {
      font-weight: 700;
      font-size: 16px;
      margin-bottom: 12px;
      color: var(--accent-blue);
      display: flex;
      justify-content: space-between;
    }
    .cells-container { display: grid; grid-template-columns: repeat(10, 1fr); gap: 10px; }
    .cell {
      background-color: #0f172a;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 10px;
      min-height: 95px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .cell.sobrante { border-color: var(--accent-amber); background-color: rgba(245, 158, 11, 0.08); }
    .cell.pallet { border-color: var(--accent-blue); background-color: rgba(56, 189, 248, 0.08); }
    .cell.landlocked { border-style: dashed; }

    .cell-top { display: flex; justify-content: space-between; align-items: center; }
    .cell-letter { font-weight: 700; font-size: 14px; }
    .badge { font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: 600; }
    .badge-sobrante { background-color: rgba(245, 158, 11, 0.2); color: var(--accent-amber); }
    .badge-pallet { background-color: rgba(56, 189, 248, 0.2); color: var(--accent-blue); }
    .badge-acc { background-color: rgba(34, 197, 94, 0.2); color: var(--accent-green); }
    .badge-locked { background-color: rgba(239, 68, 68, 0.2); color: var(--locked-red); }

    .cell-sku { font-weight: 700; font-size: 12px; color: #fff; margin-top: 4px; word-break: break-all; }
    .cell-units { font-size: 11px; color: var(--text-muted); }

    table {
      width: 100%;
      border-collapse: collapse;
      background-color: var(--card-bg);
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid var(--border-color);
    }
    th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid var(--border-color); font-size: 14px; }
    th { background-color: #0f172a; color: var(--text-muted); font-weight: 600; text-transform: uppercase; font-size: 12px; }
    tr:hover { background-color: rgba(255, 255, 255, 0.02); }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>🚲 REAL Bike Physical Overstock Map (Rows 33, 32, 31, 30)</h1>
        <div class="subtitle">Unified 4-Row Layout | Exclusive for Bike SKUs (sku_metadata.is_bike = true)</div>
      </div>
      <div style="font-size: 12px; color: var(--text-muted);">PickD Production Engine</div>
    </header>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Pallet Cells (Cols B-J)</div>
        <div class="stat-value">${result.stats.usedPalletCells} / ${result.stats.totalPalletCells}</div>
        <div class="stat-sub">${result.stats.totalUnitsInPallets} Real Bike Units in Pallets</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Surplus Cells (Col A)</div>
        <div class="stat-value">${result.stats.usedSobranteCells} / ${result.stats.totalSobranteCells}</div>
        <div class="stat-sub" style="color: var(--accent-amber);">${result.stats.totalUnitsInSobrantes} Units in Surplus</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Accessibility</div>
        <div class="stat-value">🟢 ${result.stats.accessibleOccupiedCount} | 🔒 ${result.stats.landlockedOccupiedCount}</div>
        <div class="stat-sub">Aisle Access Optimization</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Placed Bike SKUs</div>
        <div class="stat-value">${result.placedSkus.length} SKUs</div>
        <div class="stat-sub">${result.unplacedSkus.length} Overflow SKUs</div>
      </div>
    </div>

    <div class="section-title">📦 Sublocation Physical Layout (Filtered Bike SKUs)</div>
    
    <div class="map-grid">
      ${UNIFIED_FOUR_ROW_BLOCK.rows.map((row) => {
        const rowSlots = result.slots.filter((s) => s.row === row);
        return `
        <div class="row-card">
          <div class="row-header">
            <span>ROW ${row}</span>
            <span style="font-size: 12px; color: var(--text-muted); font-weight: normal;">Col A: Surplus | Cols B..J: Full Pallets</span>
          </div>
          <div class="cells-container">
            ${rowSlots.map((s) => {
              const isSobrante = s.isSobranteSlot;
              const isLocked = s.accessibility === 'landlocked';
              const usage = s.usage;

              let skuText = 'Empty';
              let unitsText = '-';
              let badgeType = isSobrante ? 'badge-sobrante' : 'badge-pallet';
              let badgeLabel = isSobrante ? 'SURPLUS' : `PALLET ${usage.kind === 'pallet' ? usage.capacity + 'u' : ''}`;
              
              if (usage.kind === 'sobrante') {
                skuText = usage.sku;
                unitsText = `${usage.units}u surplus`;
              } else if (usage.kind === 'pallet') {
                skuText = usage.sku;
                unitsText = `${usage.units}u (${usage.capacity}u cap)${usage.anchored ? ' ⚓' : ''}`;
              }

              return `
              <div class="cell ${isSobrante ? 'sobrante' : 'pallet'} ${isLocked ? 'landlocked' : ''}">
                <div class="cell-top">
                  <span class="cell-letter">${s.letter}</span>
                  <span class="badge ${isLocked ? 'badge-locked' : 'badge-acc'}">${isLocked ? '🔒' : '🟢'}</span>
                </div>
                <div class="cell-sku">${skuText}</div>
                <div class="cell-units">${unitsText}</div>
                <div style="margin-top: 4px;"><span class="badge ${badgeType}">${badgeLabel}</span></div>
              </div>
              `;
            }).join('')}
          </div>
        </div>
        `;
      }).join('')}
    </div>

    <div class="section-title">📋 Placed Bike SKUs Breakdown (With Warehouse Origin Locations)</div>

    <table>
      <thead>
        <tr>
          <th>Real Bike SKU</th>
          <th>Current Origin Location (Warehouse)</th>
          <th>Total DB Stock</th>
          <th>Pallet Capacity</th>
          <th>Full Pallets</th>
          <th>Pallet Cells (Cols B-J)</th>
          <th>Surplus Units</th>
          <th>Surplus Cell (Col A)</th>
        </tr>
      </thead>
      <tbody>
        ${result.placedSkus.map((item) => `
        <tr>
          <td style="font-weight: 700; color: #fff;">${item.sku} ${item.anchoredCount > 0 ? '⚓' : ''}</td>
          <td style="color: var(--accent-green); font-weight: 600;">${item.originLocationSummary}</td>
          <td>${item.totalQty}u</td>
          <td><span class="badge badge-pallet">${item.palletCapacity}u</span></td>
          <td>${item.fullPalletsCount} pallet(s)</td>
          <td style="color: var(--accent-blue); font-weight: 500;">${item.palletSlots.join(', ') || '-'}</td>
          <td>${item.sobranteUnits > 0 ? `${item.sobranteUnits}u` : '0u'}</td>
          <td style="color: var(--accent-amber); font-weight: 500;">${item.sobranteSlot || (item.sobranteUnits > 0 ? 'No space' : '-')}</td>
        </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
</body>
</html>`;

    const outputDir = path.join(process.cwd(), 'reports');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = path.join(outputDir, 'real_map_preview.html');
    fs.writeFileSync(outputPath, htmlContent, 'utf-8');
    console.log(`✅ REAL BIKE ENGLISH HTML report successfully generated at: ${outputPath}`);
  } catch (err) {
    console.error('❌ Error executing database query:', err.message);
  } finally {
    await sql.end();
  }
}

runRealMapGeneration();
