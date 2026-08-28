// The warehouse map: the measured building, then one zone of it. Replaced the
// Plan / Live screen of warehouse-management on 2026-08-28 (idea-170).

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
