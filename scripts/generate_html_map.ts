import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  planSingleBlock,
  UNIFIED_FOUR_ROW_BLOCK,
  type CandidateSku,
  type SkuCapacityOverrides,
} from '../src/utils/singleBlockPlanner';

const mockInventoryPool: CandidateSku[] = [
  { sku: '03-xyzbr', totalQty: 80, daysInactive: 180 }, // 35u capacity -> 2 pallets (70u) + 10u sobrante
  { sku: '01-ALPHA', totalQty: 60, daysInactive: 150 }, // 25u capacity -> 2 pallets (50u) + 10u sobrante
  { sku: '02-BRAVO', totalQty: 100, daysInactive: 120 }, // 25u capacity -> 4 pallets (100u) + 0u sobrante
  { sku: '04-CHARLIE', totalQty: 75, daysInactive: 110 }, // 25u capacity -> 3 pallets (75u) + 0u sobrante
  { sku: '05-DELTA', totalQty: 40, daysInactive: 95 }, // 25u capacity -> 1 pallet (25u) + 15u sobrante
  { sku: '06-ECHO', totalQty: 110, daysInactive: 90 }, // 30u capacity -> 3 pallets (90u) + 20u sobrante
  { sku: '07-FOXTROT', totalQty: 55, daysInactive: 85 }, // 25u capacity -> 2 pallets (50u) + 5u sobrante
  { sku: '08-GOLF', totalQty: 80, daysInactive: 80 }, // 25u capacity -> 3 pallets (75u) + 5u sobrante
  { sku: '09-HOTEL', totalQty: 125, daysInactive: 75 }, // 25u capacity -> 5 pallets (125u) + 0u sobrante
  { sku: '10-INDIA', totalQty: 90, daysInactive: 70 }, // 25u capacity -> 3 pallets (75u) + 15u sobrante
  { sku: '11-JULIETT', totalQty: 65, daysInactive: 65 }, // 25u capacity -> 2 pallets (50u) + 15u sobrante
  { sku: '12-KILO', totalQty: 70, daysInactive: 60 }, // 25u capacity -> 2 pallets (50u) + 20u sobrante
  { sku: '13-LIMA', totalQty: 100, daysInactive: 50 }, // 25u capacity -> 4 pallets (100u) + 0u sobrante
  { sku: '14-MIKE', totalQty: 50, daysInactive: 40 },
];

const skuOverrides: SkuCapacityOverrides = {
  '03-xyzbr': 35,
  '06-ECHO': 30,
};

export function generateHtmlReport() {
  const result = planSingleBlock(mockInventoryPool, skuOverrides);

  const htmlContent = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PickD - Mapa Físico de Overstock Optimizado</title>
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
      --accent-purple: #a855f7;
      --locked-red: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', sans-serif;
      background-color: var(--bg-dark);
      color: var(--text-main);
      padding: 30px;
      line-height: 1.5;
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
    .stat-label { color: var(--text-muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    .stat-value { font-size: 24px; font-weight: 700; color: #fff; margin-top: 6px; }
    .stat-sub { font-size: 12px; color: var(--accent-blue); margin-top: 2px; }

    .section-title {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .map-grid {
      display: flex;
      flex-direction: column;
      gap: 16px;
      margin-bottom: 40px;
    }
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
    .cells-container {
      display: grid;
      grid-template-columns: repeat(10, 1fr);
      gap: 10px;
    }
    .cell {
      background-color: #0f172a;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 10px;
      min-height: 90px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      position: relative;
    }
    .cell.sobrante {
      border-color: var(--accent-amber);
      background-color: rgba(245, 158, 11, 0.08);
    }
    .cell.pallet {
      border-color: var(--accent-blue);
      background-color: rgba(56, 189, 248, 0.08);
    }
    .cell.landlocked {
      border-style: dashed;
    }

    .cell-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .cell-letter {
      font-weight: 700;
      font-size: 14px;
    }
    .badge {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 600;
    }
    .badge-sobrante { background-color: rgba(245, 158, 11, 0.2); color: var(--accent-amber); }
    .badge-pallet { background-color: rgba(56, 189, 248, 0.2); color: var(--accent-blue); }
    .badge-acc { background-color: rgba(34, 197, 94, 0.2); color: var(--accent-green); }
    .badge-locked { background-color: rgba(239, 68, 68, 0.2); color: var(--locked-red); }

    .cell-sku {
      font-weight: 700;
      font-size: 13px;
      color: #fff;
      margin-top: 4px;
      word-break: break-all;
    }
    .cell-units {
      font-size: 12px;
      color: var(--text-muted);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      background-color: var(--card-bg);
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid var(--border-color);
    }
    th, td {
      padding: 12px 16px;
      text-align: left;
      border-bottom: 1px solid var(--border-color);
      font-size: 14px;
    }
    th {
      background-color: #0f172a;
      color: var(--text-muted);
      font-weight: 600;
      text-transform: uppercase;
      font-size: 12px;
    }
    tr:hover { background-color: rgba(255, 255, 255, 0.02); }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>🗺️ Mapa Físico Unificado de Overstock (Rows 33, 32, 31, 30)</h1>
        <div class="subtitle">Lógica de Llenado 100% Automático con Capacidad Dinámica y Protección de Accesibilidad</div>
      </div>
      <div style="font-size: 12px; color: var(--text-muted);">PickD Warehouse Engine</div>
    </header>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Celdas de Pallet (Cols B-J)</div>
        <div class="stat-value">${result.stats.usedPalletCells} / ${result.stats.totalPalletCells}</div>
        <div class="stat-sub">${result.stats.totalUnitsInPallets} Unidades en Pallets</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Celdas Sobrante (Col A)</div>
        <div class="stat-value">${result.stats.usedSobranteCells} / ${result.stats.totalSobranteCells}</div>
        <div class="stat-sub" style="color: var(--accent-amber);">${result.stats.totalUnitsInSobrantes} Unidades en Sobrantes</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Accesibilidad Celdas</div>
        <div class="stat-value">🟢 ${result.stats.accessibleOccupiedCount} | 🔒 ${result.stats.landlockedOccupiedCount}</div>
        <div class="stat-sub">Libres de Bloqueos de Montacargas</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">SKUs Colocados</div>
        <div class="stat-value">${result.placedSkus.length} SKUs</div>
        <div class="stat-sub">${result.unplacedSkus.length} SKUs sin espacio</div>
      </div>
    </div>

    <div class="section-title">📦 Distribución Físicas de Sublocaciones (Matriz 4 Rows × 10 Posiciones)</div>
    
    <div class="map-grid">
      ${UNIFIED_FOUR_ROW_BLOCK.rows.map((row) => {
        const rowSlots = result.slots.filter((s) => s.row === row);
        return `
        <div class="row-card">
          <div class="row-header">
            <span>ROW ${row}</span>
            <span style="font-size: 12px; color: var(--text-muted); font-weight: normal;">Posición A (Sobrantes) | Posiciones B..J (Pallets)</span>
          </div>
          <div class="cells-container">
            ${rowSlots.map((s) => {
              const isSobrante = s.isSobranteSlot;
              const isLocked = s.accessibility === 'landlocked';
              const usage = s.usage;

              let skuText = 'Vacío';
              let unitsText = '-';
              let badgeType = isSobrante ? 'badge-sobrante' : 'badge-pallet';
              let badgeLabel = isSobrante ? 'SOBRANTE' : `PALLET ${usage.kind === 'pallet' ? usage.capacity + 'u' : ''}`;
              
              if (usage.kind === 'sobrante') {
                skuText = usage.sku;
                unitsText = `${usage.units}u sobrantes`;
              } else if (usage.kind === 'pallet') {
                skuText = usage.sku;
                unitsText = `${usage.units}u (${usage.capacity}u cap)`;
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

    <div class="section-title">📋 Detalle de SKUs y Sublocaciones Asignadas</div>

    <table>
      <thead>
        <tr>
          <th>SKU</th>
          <th>Total Stock</th>
          <th>Capacidad Pallet</th>
          <th>Pallets Formados</th>
          <th>Celdas Pallet (Cols B-J)</th>
          <th>Sobrante</th>
          <th>Celda Sobrante (Col A)</th>
        </tr>
      </thead>
      <tbody>
        ${result.placedSkus.map((item) => `
        <tr>
          <td style="font-weight: 700; color: #fff;">${item.sku}</td>
          <td>${item.totalQty}u</td>
          <td><span class="badge badge-pallet">${item.palletCapacity}u</span></td>
          <td>${item.fullPalletsCount} pallet(s)</td>
          <td style="color: var(--accent-blue); font-weight: 500;">${item.palletSlots.join(', ') || '-'}</td>
          <td>${item.sobranteUnits > 0 ? `${item.sobranteUnits}u` : '0u'}</td>
          <td style="color: var(--accent-amber); font-weight: 500;">${item.sobranteSlot || (item.sobranteUnits > 0 ? 'Sin espacio' : '-')}</td>
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

  const outputPath = path.join(outputDir, 'map_preview.html');
  fs.writeFileSync(outputPath, htmlContent, 'utf-8');
  console.log(`HTML report successfully generated at: ${outputPath}`);
  return outputPath;
}

generateHtmlReport();
