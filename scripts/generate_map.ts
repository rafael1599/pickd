import {
  planSingleBlock,
  formatPlanForTerminal,
  type CandidateSku,
  type SkuCapacityOverrides,
} from '../src/utils/singleBlockPlanner';

// Sample dataset of inventory SKUs with total quantities & inactivity days
const mockInventoryPool: CandidateSku[] = [
  { sku: '03-xyzbr', totalQty: 80, daysInactive: 180 }, // 35u capacity -> 2 pallets (70u) + 10u sobrante
  { sku: '01-ALPHA', totalQty: 60, daysInactive: 150 }, // 25u capacity -> 2 pallets (50u) + 10u sobrante
  { sku: '02-BRAVO', totalQty: 100, daysInactive: 120 }, // 25u capacity -> 4 pallets (100u) + 0u sobrante
  { sku: '04-CHARLIE', totalQty: 75, daysInactive: 110 }, // 25u capacity -> 3 pallets (75u) + 0u sobrante
  { sku: '05-DELTA', totalQty: 40, daysInactive: 95 }, // 25u capacity -> 1 pallet (25u) + 15u sobrante
  { sku: '06-ECHO', totalQty: 110, daysInactive: 90 }, // 25u capacity -> 4 pallets (100u) + 10u sobrante
  { sku: '07-FOXTROT', totalQty: 55, daysInactive: 85 }, // 25u capacity -> 2 pallets (50u) + 5u sobrante
  { sku: '08-GOLF', totalQty: 80, daysInactive: 80 }, // 25u capacity -> 3 pallets (75u) + 5u sobrante
  { sku: '09-HOTEL', totalQty: 125, daysInactive: 75 }, // 25u capacity -> 5 pallets (125u) + 0u sobrante
  { sku: '10-INDIA', totalQty: 90, daysInactive: 70 }, // 25u capacity -> 3 pallets (75u) + 15u sobrante
  { sku: '11-JULIETT', totalQty: 65, daysInactive: 65 }, // 25u capacity -> 2 pallets (50u) + 15u sobrante
  { sku: '12-KILO', totalQty: 70, daysInactive: 60 }, // 25u capacity -> 2 pallets (50u) + 20u sobrante
  { sku: '13-LIMA', totalQty: 100, daysInactive: 50 }, // 25u capacity -> 4 pallets (100u) + 0u sobrante
  { sku: '14-MIKE', totalQty: 50, daysInactive: 40 }, // 25u capacity -> 2 pallets (50u) + 0u sobrante
];

// Custom SKU capacity overrides
const skuOverrides: SkuCapacityOverrides = {
  '03-xyzbr': 35, // Dynamic override requested by user
  '06-ECHO': 30, // Example of another override
};

export function runTerminalMapDemo() {
  const result = planSingleBlock(mockInventoryPool, skuOverrides);
  const formattedOutput = formatPlanForTerminal(result);
  console.log(formattedOutput);
  return result;
}

runTerminalMapDemo();
