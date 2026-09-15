import toast from 'react-hot-toast';
import {
  RegisterTypeSegmented,
  type RegisterType,
} from '../../../components/ui/RegisterTypeSelector';
import { useUpdateFedExReturn } from '../hooks/useFedExReturns';
import type { FedExReturn } from '../types';

interface ReturnTypeToggleProps {
  ret: Pick<FedExReturn, 'id' | 'item_type'>;
  className?: string;
}

/**
 * Bike or part, changeable at any step of a return (Rafael, 15 Sep 2026: «desde cualquier
 * parte del proceso fedex returns se pueda cambiar de bike a part»). Writes
 * `fedex_returns.item_type`; the placeholder's `is_bike` follows by trigger, so the return
 * moves between the Bikes and Parts lanes of Stock without anything else to do.
 */
export const ReturnTypeToggle: React.FC<ReturnTypeToggleProps> = ({ ret, className }) => {
  const update = useUpdateFedExReturn();

  const change = async (type: RegisterType) => {
    if (type === ret.item_type || update.isPending) return;
    try {
      await update.mutateAsync({ id: ret.id, item_type: type });
      toast.success(type === 'bike' ? 'Marked as bike' : 'Marked as part');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to change the type');
    }
  };

  return (
    // The card behind it opens the return on tap; changing the type must not.
    <div onClick={(e) => e.stopPropagation()} className={className}>
      <RegisterTypeSegmented value={ret.item_type} onChange={change} label="Type" />
    </div>
  );
};
