import React, { useState, useEffect, useMemo } from 'react';
import { useInventory } from './InventoryProvider';
import { useWarehouseZones } from './useWarehouseZones';
import { useLocationManagement } from './useLocationManagement';
import {
  calculateSkuVelocity,
  calculateHybridLocationScore,
  type InventoryLogSimple,
} from '../../../utils/capacityUtils';
import { SLOTTING_CONFIG } from '../../../config/slotting';
import { type ZoneType } from '../../../schemas/zone.schema';

export interface LocationSuggestion {
  value: string;
  current: number;
  max: number;
  zone: ZoneType;
  score: number;
  priorityLabel: string;
}

export const useLocationSuggestions = (
  sku: string | null,
  targetWarehouse: string | null,
  excludeLocation: string | null = null
) => {
  // Note: useInventory now returns InventoryItem[] typed data
  const { inventoryData, ludlowData, atsData, locationCapacities, fetchLogs } = useInventory();
  const { locations } = useLocationManagement();
  const { getZone } = useWarehouseZones(); // migrated to ts

  const [skuVelocity, setSkuVelocity] = useState<number | null>(null);
  const [allVelocities, setAllVelocities] = useState<number[]>([]);
  const [isLoadingVelocity, setIsLoadingVelocity] = useState(false);

  // Stable ref to inventoryData to avoid re-triggering the effect on every render
  const inventoryDataRef = React.useRef(inventoryData);
  inventoryDataRef.current = inventoryData;

  // 1. Calculate Velocity for the specific SKU
  useEffect(() => {
    if (!sku) {
      setSkuVelocity(null);
      return;
    }

    const loadVelocity = async () => {
      setIsLoadingVelocity(true);
      try {
        const logs = await fetchLogs();
        if (logs && logs.length > 0) {
          // map logs to simple interface needed by utils
          const simpleLogs: InventoryLogSimple[] = logs.map((l) => ({
            sku: l.sku,
            action_type: l.action_type,
            quantity_change: l.quantity_change,
            created_at: l.created_at,
          }));

          const v = calculateSkuVelocity(sku, simpleLogs);
          setSkuVelocity(v);

          // Sample velocities for normalization (use ref to avoid dependency)
          const sampleVelocities = inventoryDataRef.current
            .slice(0, 50)
            .map((i) => calculateSkuVelocity(i.sku, simpleLogs))
            .filter((val): val is number => val !== null);

          setAllVelocities(sampleVelocities);
        }
      } catch (e) {
        console.error('Error loading velocity', e);
      } finally {
        setIsLoadingVelocity(false);
      }
    };

    loadVelocity();
  }, [sku, fetchLogs]);

  // 2. Generate Suggestions
  const suggestions = useMemo(() => {
    if (!targetWarehouse) return [];

    const targetInv = targetWarehouse === 'ATS' ? atsData : ludlowData;
    // Ensure targetWarehouse is strictly typed as 'LUDLOW' | 'ATS'
    // If it's effectively one of them, types should work with a cast or check
     
    const shippingArea = SLOTTING_CONFIG.SHIPPING_AREAS[targetWarehouse as 'LUDLOW' | 'ATS'];

    const locationMap = new Map<string, LocationSuggestion>();

    // Iterate through all items in that warehouse
    targetInv.forEach((item) => {
      if (item.location) {
        const key = `${item.warehouse}-${item.location}`;

        // Find config in locations table
        const locConfig = locations.find(
          (l) => l.warehouse === item.warehouse && l.location === item.location
        );
        const maxCapacity = locConfig?.max_capacity || 550;

        const capData = locationCapacities[key] || { current: 0, max: 550 };
        // Override max with DB value if available locally
        capData.max = maxCapacity;

        const locName = String(item.location).trim();
        const zone = getZone(item.warehouse, item.location) as ZoneType;
        if (!locationMap.has(locName)) {
          // Calculate Hybrid Score
          const score = calculateHybridLocationScore(
            {
              name: locName,
              current: capData.current,
              max: capData.max,
              zone,
            },
            skuVelocity,
            shippingArea,
            allVelocities
          );

          locationMap.set(locName, {
            value: locName,
            current: capData.current,
            max: capData.max,
            zone: zone,
            score: score,
            priorityLabel: score > 80 ? '🔥 BEST' : score > 50 ? '✅ GOOD' : '⚠️ FAIR',
          });
        }
      }
    });

    return Array.from(locationMap.values()).sort((a, b) => b.score - a.score);
  }, [
    targetWarehouse,
    ludlowData,
    atsData,
    locationCapacities,
    skuVelocity,
    allVelocities,
    getZone,
    locations,
  ]);

  // 3. Check for existing SKU location (Merge Opportunity)
  const mergeOpportunity = useMemo(() => {
    if (!sku || !targetWarehouse) return null;
    const targetInv = targetWarehouse === 'ATS' ? atsData : ludlowData;
    const matching = targetInv.find((i) => i.sku === sku && i.location !== excludeLocation);
    return matching ? matching.location : null;
  }, [sku, targetWarehouse, ludlowData, atsData, excludeLocation]);

  return {
    suggestions,
    skuVelocity,
    isLoadingVelocity,
    mergeOpportunity,
  };
};
