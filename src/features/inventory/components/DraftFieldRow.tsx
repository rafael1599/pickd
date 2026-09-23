/**
 * One field of a label reading, painted the way the operator already knows it:
 * green read, amber «pick one», red «the label does not say».
 *
 * Shared by the single-box sheet (`LabelScanSheet`) and the batch pile
 * (`LabelBatchScreen`) — one component, so the two never disagree about what a
 * colour means. The batch also lets a red field be typed right there
 * (`onType`); the single-box sheet sends it to the add form instead.
 */
import React, { useState } from 'react';
import Check from 'lucide-react/dist/esm/icons/check';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import HelpCircle from 'lucide-react/dist/esm/icons/help-circle';
import type { DraftField } from '../utils/labelToSkuDraft';

interface DraftFieldRowProps<T> {
  label: string;
  field: DraftField<T>;
  render: (value: T | null) => string;
  onChoose: (option: T) => void;
  /** Given: a missing field gets an input instead of the hint. */
  onType?: (text: string) => void;
  /** With `onType`: an input even for a read value, prefilled — to correct a wrong read. */
  forceInput?: boolean;
  missingHint?: string;
  children?: React.ReactNode;
}

const fieldTone = (status: DraftField<unknown>['status']): string =>
  status === 'found'
    ? 'border-emerald-500/30 bg-emerald-500/5'
    : status === 'uncertain'
      ? 'border-amber-500/40 bg-amber-500/5'
      : 'border-red-500/30 bg-red-500/5';

export function DraftFieldRow<T>({
  label,
  field,
  render,
  onChoose,
  onType,
  forceInput = false,
  missingHint,
  children,
}: DraftFieldRowProps<T>) {
  const [text, setText] = useState(() =>
    forceInput && field.value !== null ? String(field.value) : ''
  );
  const commit = () => {
    const value = text.trim();
    if (!value || !onType) return;
    if (forceInput && value === String(field.value ?? '')) return;
    onType(value);
    if (!forceInput) setText('');
  };
  const showInput = !!onType && (field.status === 'missing' || forceInput);

  return (
    <div className={`rounded-xl border px-3 py-2 ${fieldTone(field.status)}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted">{label}</span>
        {showInput ? (
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
            }}
            placeholder="type it"
            autoCapitalize="characters"
            className="min-w-0 flex-1 rounded-lg border border-red-500/30 bg-card px-2 py-1 text-right text-sm font-bold uppercase text-content placeholder:normal-case placeholder:font-normal placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        ) : (
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-bold text-content">{render(field.value)}</span>
            {field.status === 'found' && <Check size={14} className="shrink-0 text-emerald-400" />}
            {field.status === 'uncertain' && (
              <HelpCircle size={14} className="shrink-0 text-amber-400" />
            )}
            {field.status === 'missing' && (
              <AlertTriangle size={14} className="shrink-0 text-red-400" />
            )}
          </div>
        )}
      </div>

      {field.status === 'uncertain' && field.options && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {field.options.map((option, i) => (
            <button
              key={i}
              onClick={() => onChoose(option)}
              className="rounded-full border border-amber-500/40 bg-card px-3 py-1 text-xs font-bold text-content active:scale-95"
            >
              {render(option)}
            </button>
          ))}
        </div>
      )}

      {field.status === 'missing' && !onType && missingHint && (
        <p className="mt-1 text-[11px] text-red-400/80">{missingHint}</p>
      )}

      {children}
    </div>
  );
}
