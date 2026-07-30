// The setup checklist for one block.
//
// Replaces the greyed-out Recalculate button as the way the screen reports a
// missing precondition: each input is listed with its current value and, when
// something is off, the exact next action. Blockers open the list on their own
// — a warning or an all-clear stays folded so a working plan keeps the space.

import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Loader2,
  XCircle,
} from 'lucide-react';
import type { ReadinessCheck } from '../../hooks/useBlockReadiness';

interface BlockReadinessPanelProps {
  blockId: string;
  checks: ReadinessCheck[];
  /**
   * Whether the list starts unfolded. The caller keys this component on the
   * same condition, so a blocker appearing later remounts the panel and opens
   * it instead of staying hidden behind a fold closed for an earlier state.
   */
  defaultOpen: boolean;
  onGoToNoMovers?: () => void;
}

// Light surface inside a dark-rooted app: every one of these fixes its own text
// colour, or it inherits white and disappears.
const ICONS: Record<ReadinessCheck['status'], React.ReactNode> = {
  ok: <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />,
  warning: <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />,
  blocked: <XCircle className="w-4 h-4 text-rose-600 shrink-0" />,
  loading: <Loader2 className="w-4 h-4 text-slate-400 animate-spin shrink-0" />,
};

export const BlockReadinessPanel: React.FC<BlockReadinessPanelProps> = ({
  blockId,
  checks,
  defaultOpen,
  onGoToNoMovers,
}) => {
  const blocked = checks.filter((c) => c.status === 'blocked');
  const warnings = checks.filter((c) => c.status === 'warning');
  const [open, setOpen] = useState(defaultOpen);

  const tone =
    blocked.length > 0
      ? { border: 'border-rose-200', bg: 'bg-rose-50', title: 'text-rose-800' }
      : warnings.length > 0
        ? { border: 'border-amber-200', bg: 'bg-amber-50', title: 'text-amber-800' }
        : { border: 'border-slate-200', bg: 'bg-slate-50', title: 'text-slate-700' };

  const summary =
    blocked.length > 0
      ? `Block ${blockId} can't be planned yet`
      : warnings.length > 0
        ? `Block ${blockId} · ${warnings.length} thing${warnings.length === 1 ? '' : 's'} to know`
        : `Block ${blockId} setup is complete`;

  const showGoToNoMovers = onGoToNoMovers && [...blocked, ...warnings].some((c) => c.goToNoMovers);

  return (
    <div className={`print:hidden rounded-xl border ${tone.border} ${tone.bg} text-slate-800`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        {ICONS[blocked.length > 0 ? 'blocked' : warnings.length > 0 ? 'warning' : 'ok']}
        <span className={`text-sm font-bold ${tone.title}`}>{summary}</span>
        <ChevronDown
          className={`ml-auto w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="px-3 pb-3">
          <ul className="rounded-lg border border-white/70 bg-white divide-y divide-slate-100">
            {checks.map((check) => (
              <li key={check.id} className="flex items-start gap-2.5 px-3 py-2.5">
                <span className="mt-0.5">{ICONS[check.status]}</span>
                <div className="min-w-0">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    {check.label}
                  </div>
                  <div className="text-sm text-slate-800 break-words">{check.detail}</div>
                  {check.fix && (
                    <div
                      className={`text-xs mt-1 break-words ${
                        check.status === 'blocked' ? 'text-rose-700' : 'text-amber-700'
                      }`}
                    >
                      {check.fix}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {showGoToNoMovers && (
            <button
              onClick={onGoToNoMovers}
              className="mt-2.5 flex items-center gap-1.5 px-3 h-9 rounded-lg bg-slate-800 text-white font-semibold text-xs tracking-wide hover:bg-slate-900 active:scale-95 transition-all"
            >
              <span>Open the No-movers tab for block {blockId}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
