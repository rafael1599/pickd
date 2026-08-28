// The warehouse map: the measured building, then one zone of it. Replaces the
// Plan / Live screen of warehouse-management (idea-170); until F4 that one is
// still reachable at /warehouse-map/legacy.

import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { isZoneId } from './engine';
import { MasterMap } from './components/MasterMap';
import { ZoneView } from './components/ZoneView';

export const WarehouseMapScreen: React.FC = () => {
  const [params] = useSearchParams();
  const zone = params.get('zone');
  return (
    <div className="min-h-full pb-32">
      {isZoneId(zone) ? <ZoneView zoneId={zone} /> : <MasterMap />}
    </div>
  );
};
