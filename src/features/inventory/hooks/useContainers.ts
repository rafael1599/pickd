import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import {
  toContainerReport,
  type ContainerReport,
  type ContainerReportSourceRow,
} from '../utils/containerReport';

export interface ContainerHistoryEntry {
  container: string;
  warehouse: string;
  firstRegisteredAt: string;
  lastRegisteredAt: string;
  intakes: number;
  skus: number;
  units: number;
  bikes: number;
  parts: number;
  registeredBy: string[];
  remainingUnits: number;
}

export const CONTAINERS_QUERY_KEY = ['containers'] as const;

export function useContainerHistory() {
  return useQuery<ContainerHistoryEntry[]>({
    queryKey: [...CONTAINERS_QUERY_KEY, 'history'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_container_history');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        container: r.container,
        warehouse: r.warehouse,
        firstRegisteredAt: r.first_registered_at,
        lastRegisteredAt: r.last_registered_at,
        intakes: r.intakes,
        skus: r.skus,
        units: r.units,
        bikes: r.bikes,
        parts: r.parts,
        registeredBy: r.registered_by ?? [],
        remainingUnits: r.remaining_units,
      }));
    },
    staleTime: 60_000,
  });
}

export function useContainerReport(container: string | undefined) {
  return useQuery<ContainerReport>({
    queryKey: [...CONTAINERS_QUERY_KEY, 'report', container],
    enabled: Boolean(container),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_container_report', {
        p_container: container!,
      });
      if (error) throw error;
      return toContainerReport((data ?? []) as ContainerReportSourceRow[]);
    },
    staleTime: 60_000,
  });
}
