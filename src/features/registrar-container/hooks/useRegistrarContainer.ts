import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useAuth } from '../../../context/AuthContext';
import {
  fetchContainerIntakes,
  registerContainer,
  resolveContainerSkus,
} from '../api/registrarContainerApi';
import { toInputItems } from '../lib/containers';
import type {
  AnalyzedContainer,
  ParsedContainer,
  RegisterBatchItem,
  RegisterOutcome,
} from '../lib/types';

export function useRegistrarContainer() {
  const { user, profile } = useAuth();
  const performedBy = profile?.full_name || user?.email || 'Container Intake';

  // The file's containers read against PickD: which it already has, and what
  // each of the others would register.
  const analyze = useMutation({
    mutationKey: ['registrar-container', 'analyze'],
    mutationFn: async (vars: {
      containers: ParsedContainer[];
      warehouse: string;
    }): Promise<AnalyzedContainer[]> => {
      const pos = vars.containers.flatMap((c) => (c.po ? [c.po] : []));
      const intakes = await fetchContainerIntakes(pos, vars.warehouse);
      return Promise.all(
        vars.containers.map(async (container, i) => {
          const intake = container.po ? (intakes.get(container.po) ?? null) : null;
          const resolved = intake
            ? []
            : await resolveContainerSkus(toInputItems(container), vars.warehouse);
          return { key: container.po ?? `${container.sheet}#${i}`, container, intake, resolved };
        })
      );
    },
    onError: (err: Error) => toast.error(`Could not analyze: ${err.message}`),
  });

  // One container at a time, each its own register_container transaction: a
  // container that fails says why and the others still land -- they are
  // separate loads, and the next attempt skips whatever made it in.
  const register = useMutation({
    mutationKey: ['registrar-container', 'register'],
    mutationFn: async (vars: {
      batch: RegisterBatchItem[];
      warehouse: string;
      itemTypesBySku: Record<string, 'bike' | 'part'>;
    }): Promise<RegisterOutcome[]> => {
      // Read again right before writing: another device may have registered
      // one of these since the file was read, and a PO is only loaded once.
      // A typed name ('FLORIDA') is a staging spot used over and over, so only
      // register_container's stock guard applies to it.
      const fresh = await fetchContainerIntakes(
        vars.batch.flatMap((b) => (b.po ? [b.po] : [])),
        vars.warehouse
      );
      const outcomes: RegisterOutcome[] = [];
      for (const b of vars.batch) {
        if (b.po && fresh.has(b.po)) {
          outcomes.push({
            location: b.location,
            ok: false,
            error: 'Already in PickD — registered after this file was read.',
          });
          continue;
        }
        try {
          // Only this container's SKUs: the type is written with an upsert, and
          // a SKU of a container still to come would be inserted into the
          // catalog before its own intake creates it.
          const itemTypesBySku = Object.fromEntries(
            b.skus.flatMap((sku) =>
              vars.itemTypesBySku[sku] ? [[sku, vars.itemTypesBySku[sku]]] : []
            )
          );
          const summary = await registerContainer({
            location: b.location,
            items: b.items,
            userId: user?.id ?? '',
            performedBy,
            warehouse: vars.warehouse,
            orderNumber: null,
            itemTypesBySku,
          });
          outcomes.push({ location: b.location, ok: true, summary });
        } catch (err) {
          outcomes.push({ location: b.location, ok: false, error: (err as Error).message });
        }
      }
      return outcomes;
    },
    onSuccess: (outcomes) => {
      const done = outcomes.flatMap((o) => (o.ok ? [o.summary] : []));
      const failed = outcomes.length - done.length;
      if (failed > 0) {
        toast.error(
          `${failed} of ${outcomes.length} container${outcomes.length === 1 ? '' : 's'} not registered`
        );
      } else if (done.length === 1) {
        toast.success(
          `Container registered: ${done[0].skus} SKUs · ${done[0].units} units in ${done[0].location}`
        );
      } else {
        const units = done.reduce((sum, s) => sum + s.units, 0);
        toast.success(`${done.length} containers registered · ${units} units`);
      }
    },
    onError: (err: Error) => toast.error(`Error registering: ${err.message}`),
  });

  return { analyze, register };
}
