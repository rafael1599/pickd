import React from 'react';
import { CopyButton } from '../../../components/ui/CopyButton';
import { useFedexRecipient } from '../hooks/useFedexRecipient';
import {
  FEDEX_RECIPIENT_BADGE,
  FEDEX_RECIPIENT_HINT,
  type FedexRecipientKind,
} from '../utils/fedexRecipient';

const BADGE_CLASS: Record<FedexRecipientKind, string> = {
  in_fedex: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  unsynced: 'bg-purple-500/15 text-purple-400 border-purple-500/20',
  one_off: 'bg-amber-500/15 text-amber-500 border-amber-500/20',
  no_id: 'bg-surface text-muted border-subtle',
};

interface Props {
  listId: string | null;
  /** Badge + id only, no hint line (the DoubleCheck header has no room for prose). */
  compact?: boolean;
}

/**
 * The FedEx Recipient ID for an order, with a copy button and the one thing to
 * do with it in FedEx Ship Manager. Renders nothing until the data is here so a
 * card never flashes "No FedEx ID" for a dealer that has one.
 */
export const FedexRecipientChip: React.FC<Props> = ({ listId, compact = false }) => {
  const { data } = useFedexRecipient(listId);
  if (!data) return null;

  const { kind, id } = data;
  return (
    <div className="flex flex-col gap-0.5 min-w-0" data-testid="fedex-recipient-chip">
      <div className="flex items-center gap-1.5 min-w-0">
        <span
          className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md border ${BADGE_CLASS[kind]}`}
        >
          {FEDEX_RECIPIENT_BADGE[kind]}
        </span>
        {id && (
          <>
            <span
              className="font-mono text-sm font-semibold text-content tracking-wide truncate"
              title="FedEx Recipient ID"
            >
              {id}
            </span>
            <CopyButton value={id} label="FedEx Recipient ID" />
          </>
        )}
      </div>
      {!compact && <p className="text-xs text-muted leading-snug">{FEDEX_RECIPIENT_HINT[kind]}</p>}
    </div>
  );
};
