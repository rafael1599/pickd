// The warehouse map: the measured building, then one zone of it. Replaced the
// Plan / Live screen of warehouse-management on 2026-08-28 (idea-170).
//
// Two doors into the same zone: signed in, the zone has its editor (PLAN,
// idea-173) and a SKU opens the app's item detail — both need the Modal
// Manager and the inventory provider, which only exist inside the app; on
// /public-warehouse-map there is neither, so the zone is read-only.

import React from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { isZoneId } from './engine';
import type { ZoneId } from './engine';
import { MasterMap } from './components/MasterMap';
import { ZoneView } from './components/ZoneView';
import { useZoneData } from './hooks/useZoneData';
import { useZoneEditor } from './hooks/useZoneEditor';
import { WAREHOUSE_STOCK_KEY } from './hooks/useWarehouseStock';
import { useOpenSkuDetail } from '../inventory/hooks/useOpenSkuDetail';

const PUBLIC_PATH = '/public-warehouse-map';

const PublicZone: React.FC<{ zoneId: ZoneId }> = ({ zoneId }) => {
  const data = useZoneData(zoneId);
  return <ZoneView data={data} />;
};

const SignedInZone: React.FC<{ zoneId: ZoneId }> = ({ zoneId }) => {
  const queryClient = useQueryClient();
  const data = useZoneData(zoneId);
  const editor = useZoneEditor(zoneId, data.stock);
  const openSkuDetail = useOpenSkuDetail({
    afterChange: () => queryClient.invalidateQueries({ queryKey: WAREHOUSE_STOCK_KEY }),
  });
  return (
    <ZoneView
      data={data}
      editor={editor}
      onOpenLine={(sku, itemName, location, warehouse) =>
        openSkuDetail({ sku, itemName, pickLocation: location, pickWarehouse: warehouse })
      }
    />
  );
};

export const WarehouseMapScreen: React.FC = () => {
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  const zone = params.get('zone');
  const isPublic = pathname === PUBLIC_PATH;
  return (
    <div className="min-h-full pb-32">
      {isZoneId(zone) ? (
        isPublic ? (
          <PublicZone zoneId={zone} />
        ) : (
          <SignedInZone zoneId={zone} />
        )
      ) : (
        <MasterMap />
      )}
    </div>
  );
};
