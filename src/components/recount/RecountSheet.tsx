import React, { useState, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import X from 'lucide-react/dist/esm/icons/x';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import { supabase } from '../../lib/supabase';
import { feedbackService } from '../../services/feedback.service';
import { submitRecount } from '../../services/recount.service';
import { invalidateRecountAndInventoryQueries } from '../../hooks/useOpenRecounts';
import type { SubmitRecountResult } from '../../schemas/recount.schema';
import { cardThumbUrl } from '../../features/inventory/utils/stockCard';

const HEADING: React.CSSProperties = { fontFamily: 'var(--font-heading)' };

export interface RecountSheetProps {
  sku: string;
  warehouse: string;
  location: string;
  listId?: string;
  reason?: string;
  itemName?: string | null;
  onDone?: (result: SubmitRecountResult) => void;
  onSkip?: () => void;
  onClose: () => void;
}

export const RecountSheet: React.FC<RecountSheetProps> = ({
  sku,
  warehouse,
  location,
  listId,
  reason,
  itemName: initialItemName,
  onDone,
  onSkip,
  onClose,
}) => {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [countText, setCountText] = useState('0');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitRecountResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch metadata (photo, bike flag, name)
  const { data: skuMeta } = useQuery({
    queryKey: ['recount-meta', sku],
    queryFn: async () => {
      const { data } = await supabase
        .from('sku_metadata')
        .select('model, image_url, is_bike')
        .eq('sku', sku)
        .maybeSingle();
      return data;
    },
    staleTime: 60_000,
  });

  const isBike = skuMeta?.is_bike !== false;
  const thumb = cardThumbUrl(skuMeta?.image_url);
  const name = initialItemName || skuMeta?.model || '';

  const parsedCount = parseInt(countText, 10);
  const count = Number.isNaN(parsedCount) ? 0 : Math.max(0, parsedCount);

  useEffect(() => {
    // Auto-focus input on mount
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleIncrement = () => {
    setCountText(String(count + 1));
  };

  const handleDecrement = () => {
    setCountText(String(Math.max(0, count - 1)));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/[^0-9]/g, '');
    setCountText(val);
  };

  const handleSkip = () => {
    onSkip?.();
    onClose();
  };

  const handleSave = async () => {
    if (isSubmitting || result) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await submitRecount(sku, warehouse, location, count, listId ?? null);
      setResult(res);
      invalidateRecountAndInventoryQueries(queryClient);

      if (res.result === 'matched') {
        feedbackService.success();
      } else if (res.result === 'applied') {
        feedbackService.success();
      } else if (res.result === 'second_count') {
        feedbackService.warning();
      }
    } catch (err: unknown) {
      feedbackService.error();
      const message =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message: unknown }).message)
            : 'Error submitting recount';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (result || error) {
        handleDone();
      } else {
        void handleSave();
      }
    }
  };

  const handleDone = () => {
    if (result) {
      onDone?.(result);
    }
    onClose();
  };

  const question = listId ? 'How many are left here?' : 'How many are here?';

  const renderResultLine = () => {
    if (error) {
      return (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-center text-sm font-bold text-red-400">
          {error}
        </div>
      );
    }

    if (!result) return null;

    if (result.result === 'matched') {
      return (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-center text-sm font-bold text-emerald-400">
          Matches · {result.counted}
        </div>
      );
    }

    if (result.result === 'applied') {
      const deltaSign = result.delta > 0 ? `+${result.delta}` : `−${Math.abs(result.delta)}`;
      return (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-center text-sm font-bold text-emerald-400">
          Was {result.system} · now {result.counted} ({deltaSign})
        </div>
      );
    }

    if (result.result === 'second_count') {
      return (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-center text-sm font-bold text-amber-400">
          Off by {Math.abs(result.delta)} — another person will recount it
        </div>
      );
    }

    return null;
  };

  return (
    <div
      className="fixed inset-0 z-[190] flex justify-center bg-black/60"
      data-testid="recount-sheet"
      onClick={handleSkip}
    >
      <div
        className="flex h-full w-full max-w-md flex-col bg-[#0c0d12] text-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 pb-2.5 pt-[max(0.875rem,env(safe-area-inset-top))]">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#2A2F36] bg-[#161920]">
            {thumb ? (
              <img src={thumb} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-xl">{isBike ? '🚲' : '⚙︎'}</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-2xl font-black leading-none tracking-tight" style={HEADING}>
              {sku}
            </div>
            {name && (
              <div className="mt-1 truncate text-[11.5px] font-bold uppercase text-white/45">
                {name}
              </div>
            )}
            <div
              className="mt-0.5 text-xs font-black uppercase tracking-tight text-accent"
              style={HEADING}
            >
              {location || 'NO LOCATION'}
            </div>
          </div>
          <button
            type="button"
            onClick={handleSkip}
            aria-label="Close"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#2A2F36] text-white/50 active:scale-95"
          >
            <X size={18} />
          </button>
        </div>

        {/* Reason */}
        {reason && (
          <div className="mx-4 mt-1 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-300">
            <span className="opacity-70">Reason: </span>
            {reason}
          </div>
        )}

        {/* Main Content Area */}
        <div className="flex flex-1 flex-col justify-center px-4 py-6">
          {!result && !error ? (
            <div className="flex flex-col items-center">
              <p className="text-center text-lg font-black tracking-tight text-white/90">
                {question}
              </p>

              {/* Number Input & Stepper */}
              <div className="my-8 flex items-center justify-center gap-4">
                <button
                  type="button"
                  onClick={handleDecrement}
                  disabled={isSubmitting || count <= 0}
                  className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#2A2F36] bg-[#161920] text-3xl font-bold text-white transition-all active:scale-90 disabled:opacity-30"
                  aria-label="Decrease"
                >
                  −
                </button>

                <input
                  ref={inputRef}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={countText}
                  disabled={isSubmitting}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  className="h-20 w-36 rounded-2xl border-2 border-[#2A2F36] bg-[#161920] text-center text-4xl font-black tabular-nums text-white focus:border-accent focus:outline-none"
                  aria-label="Count"
                  style={HEADING}
                />

                <button
                  type="button"
                  onClick={handleIncrement}
                  disabled={isSubmitting}
                  className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#2A2F36] bg-[#161920] text-3xl font-bold text-white transition-all active:scale-90 disabled:opacity-30"
                  aria-label="Increase"
                >
                  +
                </button>
              </div>
            </div>
          ) : (
            <div className="my-auto py-6">{renderResultLine()}</div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="border-t border-[#1C2028] p-4">
          {!result && !error ? (
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleSkip}
                disabled={isSubmitting}
                className="flex-1 h-12 rounded-xl border border-[#2A2F36] bg-[#161920] text-xs font-black uppercase tracking-wider text-white/70 transition-all active:scale-95"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSubmitting || countText.trim() === ''}
                className="flex-1 h-12 rounded-xl bg-accent text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-accent/20 transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : 'Save'}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleDone}
              autoFocus
              className="w-full h-12 rounded-xl bg-accent text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-accent/20 transition-all active:scale-95"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
