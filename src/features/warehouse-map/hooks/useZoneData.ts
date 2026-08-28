// Everything a zone screen needs to draw: the engine state (URL), the layout
// it produces, and the DB's stock laid over it. Shared by the public zone
// (read-only) and the signed-in one (with its editor), so neither computes
// the layout twice.

import { useMemo } from 'react';
import { ZONES, calculateLayout } from '../engine';
import type { EngineState, LayoutModel, ZoneConfig, ZoneId } from '../engine';
import { zoneStock, type ZoneStock } from '../stock/rowStock';
import { useWarehouseStock } from './useWarehouseStock';
import { useZoneState, type ZoneStatePatch } from './useZoneState';

export interface ZoneData {
  config: ZoneConfig;
  state: EngineState;
  update: (patch: ZoneStatePatch) => void;
  model: LayoutModel | null;
  stockQuery: ReturnType<typeof useWarehouseStock>;
  stock: ZoneStock | null;
}

export function useZoneData(zoneId: ZoneId): ZoneData {
  const config = ZONES[zoneId];
  const [state, update] = useZoneState(config);
  const model = useMemo(() => calculateLayout(config, state), [config, state]);
  const stockQuery = useWarehouseStock();
  const stock = useMemo(
    () => (stockQuery.data ? zoneStock(config, model, stockQuery.data) : null),
    [config, model, stockQuery.data]
  );
  return { config, state, update, model, stockQuery, stock };
}
