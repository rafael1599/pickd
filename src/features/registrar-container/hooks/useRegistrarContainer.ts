import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useAuth } from '../../../context/AuthContext';
import {
  registerContainer,
  resolveContainerSkus,
  type RegisterContainerArgs,
} from '../api/registrarContainerApi';
import type { ContainerInputItem } from '../lib/types';

export function useRegistrarContainer() {
  const { user, profile } = useAuth();
  const performedBy = profile?.full_name || user?.email || 'Container Intake';

  const resolve = useMutation({
    mutationKey: ['registrar-container', 'resolve'],
    mutationFn: (vars: { items: ContainerInputItem[]; warehouse: string }) =>
      resolveContainerSkus(vars.items, vars.warehouse),
    onError: (err: Error) => toast.error(`Could not analyze: ${err.message}`),
  });

  const register = useMutation({
    mutationKey: ['registrar-container', 'register'],
    mutationFn: (vars: {
      location: string;
      items: ContainerInputItem[];
      warehouse: string;
      orderNumber?: string | null;
    }) => {
      const args: RegisterContainerArgs = {
        ...vars,
        userId: user?.id ?? '',
        performedBy,
      };
      return registerContainer(args);
    },
    onSuccess: (summary) =>
      toast.success(
        `Container registered: ${summary.skus} SKUs · ${summary.units} units in ${summary.location}`
      ),
    onError: (err: Error) => toast.error(`Error registering: ${err.message}`),
  });

  return { resolve, register };
}
