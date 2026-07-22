import React from 'react';
import X from 'lucide-react/dist/esm/icons/x';
import type { OrderWithRelations } from '../../../types';

interface CombineSuggestionBannerProps {
  candidate: OrderWithRelations;
  isAccepting: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}

export const CombineSuggestionBanner: React.FC<CombineSuggestionBannerProps> = ({
  candidate,
  isAccepting,
  onAccept,
  onDismiss,
}) => {
  return (
    <div className="mx-1 mt-2 flex items-center justify-between gap-2 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2">
      <p className="text-[11px] font-bold text-content/80 leading-tight">
        This customer also has order <span className="font-black">#{candidate.order_number}</span>{' '}
        pending — combine them?
      </p>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={onAccept}
          disabled={isAccepting}
          className="px-2.5 py-1 rounded-lg bg-accent text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-50"
        >
          {isAccepting ? 'Combining…' : 'Combine'}
        </button>
        <button
          onClick={onDismiss}
          className="p-1 text-muted hover:text-content transition-colors"
          title="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};
