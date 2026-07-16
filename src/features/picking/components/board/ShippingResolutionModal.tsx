import React, { useState } from 'react';
import { supabase } from '../../../../lib/supabase';
import { X, Truck, Package, GitMerge } from 'lucide-react';
import { toast } from 'react-hot-toast';

interface Props {
  groupId: string;
  onClose: () => void;
  onResolved: () => void;
}

export const ShippingResolutionModal: React.FC<Props> = ({ groupId, onClose, onResolved }) => {
  const [loading, setLoading] = useState(false);

  const handleResolve = async (type: 'all-fedex' | 'all-regular' | 'keep-mixed') => {
    setLoading(true);
    try {
      if (type === 'all-fedex') {
        await supabase
          .from('picking_lists')
          .update({ shipping_type: 'fedex' })
          .eq('group_id', groupId);
      } else if (type === 'all-regular') {
        await supabase
          .from('picking_lists')
          .update({ shipping_type: 'regular' })
          .eq('group_id', groupId);
      }
      // if keep-mixed, we do nothing
      toast.success('Shipping type resolved!');
      onResolved();
    } catch (err) {
      console.error(err);
      toast.error('Failed to resolve shipping type');
    } finally {
      setLoading(false);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-4 border-b border-white/10 bg-white/5">
          <h2 className="text-lg font-black tracking-widest uppercase flex-1 text-center text-white">
            Resolve Shipping Type
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-xl transition-colors absolute right-4"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6">
          <p className="text-sm text-white/70 text-center mb-6">
            You are combining orders from <strong>different customers</strong> with{' '}
            <strong>mixed shipping types</strong> (FedEx and Regular). How would you like to handle
            the shipping type for this group?
          </p>

          <div className="flex flex-col gap-3">
            <button
              disabled={loading}
              onClick={() => handleResolve('all-regular')}
              className="flex items-center gap-3 p-4 rounded-xl border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition-colors text-left"
            >
              <Package size={24} className="shrink-0" />
              <div>
                <div className="font-bold uppercase tracking-wider text-sm">All Regular</div>
                <div className="text-xs opacity-70">
                  Convert all orders in this group to regular shipping.
                </div>
              </div>
            </button>

            <button
              disabled={loading}
              onClick={() => handleResolve('all-fedex')}
              className="flex items-center gap-3 p-4 rounded-xl border border-purple-500/30 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 transition-colors text-left"
            >
              <Truck size={24} className="shrink-0" />
              <div>
                <div className="font-bold uppercase tracking-wider text-sm">All FedEx</div>
                <div className="text-xs opacity-70">Convert all orders in this group to FedEx.</div>
              </div>
            </button>

            <button
              disabled={loading}
              onClick={() => handleResolve('keep-mixed')}
              className="flex items-center gap-3 p-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-white transition-colors text-left"
            >
              <GitMerge size={24} className="shrink-0" />
              <div>
                <div className="font-bold uppercase tracking-wider text-sm">Keep Mixed</div>
                <div className="text-xs opacity-70">
                  Leave each order with its original shipping type.
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
