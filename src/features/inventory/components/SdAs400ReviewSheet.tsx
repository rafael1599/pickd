/**
 * S/D · AS400 review (idea-257 P3): what to type in AS400 for the S/D on the
 * floor — numbers to CREATE, descriptions to UPDATE with the box's serial.
 * PickD cannot write AS400; this is the list for whoever does. Prints on 6×4
 * like History's AS400 Sync (button, or Cmd/Ctrl+P while open). «Done»
 * (`sd_as400_done`) hands the SKU back to the watchdog to read again, so a
 * fixed line goes away by itself and an unfixed one comes back.
 */
import { useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Printer, X } from 'lucide-react';
import toast from 'react-hot-toast';

import { supabase } from '../../../lib/supabase';
import { useScrollLock } from '../../../hooks/useScrollLock';
import { sdCode } from '../../../utils/sdCode';
import {
  generateSdAs400ReviewDoc,
  type SdAs400ReviewLine,
} from '../utils/generateSdAs400ReviewPdf';

export const SD_AS400_REVIEW_KEY = ['sd-as400-review'];

export function useSdAs400Review(enabled = true) {
  return useQuery({
    queryKey: SD_AS400_REVIEW_KEY,
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<SdAs400ReviewLine[]> => {
      const { data, error } = await supabase
        .from('v_sd_as400_review')
        .select(
          'sku, sd_number, item_name, serial_number, as400_description, as400_serial, action, reason'
        )
        .order('action')
        .order('sd_number', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as SdAs400ReviewLine[];
    },
  });
}

export function SdAs400ReviewSheet({ onClose }: { onClose: () => void }) {
  useScrollLock(true, onClose);
  const queryClient = useQueryClient();
  const { data: lines = [], isLoading } = useSdAs400Review();

  const print = useCallback(async () => {
    try {
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
      ]);
      const doc = generateSdAs400ReviewDoc(jsPDF, autoTable, lines);
      window.open(doc.output('bloburl'), '_blank');
    } catch (e) {
      console.error('AS400 review PDF failed:', e);
      toast.error('Could not build the AS400 review');
    }
  }, [lines]);

  // Cmd/Ctrl+P prints the 6×4 review, as in Ship.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!((e.ctrlKey || e.metaKey) && e.key === 'p')) return;
      e.preventDefault();
      void print();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [print]);

  const done = async (sku: string) => {
    const { error } = await supabase.rpc('sd_as400_done', { p_sku: sku });
    if (error) {
      toast.error(`Could not mark ${sku}: ${error.message}`);
      return;
    }
    queryClient.setQueryData<SdAs400ReviewLine[]>(SD_AS400_REVIEW_KEY, (old) =>
      (old ?? []).filter((l) => l.sku !== sku)
    );
    toast.success(`${sku} done · AS400 will be read again`);
  };

  const groups: { title: string; action: string }[] = [
    { title: 'Create in AS400', action: 'CREATE' },
    { title: 'Update description and serial', action: 'UPDATE' },
  ];

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-end md:items-stretch md:justify-end bg-main/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="S/D AS400 review"
        className="w-full md:w-[460px] max-h-[90vh] md:max-h-none md:h-full flex flex-col bg-surface border-t md:border-t-0 md:border-l border-subtle rounded-t-3xl md:rounded-none shadow-2xl animate-in slide-in-from-bottom md:slide-in-from-right duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 pt-4 pb-3 border-b border-subtle shrink-0">
          <h2
            className="text-xl font-black uppercase tracking-tighter text-content flex-1"
            style={{ fontFamily: 'var(--font-heading)' }}
          >
            AS400 review
            <span className="ml-2 text-accent tabular-nums">{lines.length}</span>
          </h2>
          <button
            onClick={() => void print()}
            disabled={isLoading}
            className="flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-accent px-2 py-1 rounded-lg hover:bg-card disabled:opacity-40"
          >
            <Printer size={16} /> 4×6
          </button>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-2 -mr-2 rounded-full text-muted hover:bg-card transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-32">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="animate-spin text-accent w-6 h-6 opacity-40" />
            </div>
          ) : lines.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">Nothing to change in AS400.</p>
          ) : (
            groups.map((g) => {
              const rows = lines.filter((l) => l.action === g.action);
              if (!rows.length) return null;
              return (
                <section key={g.action} className="pt-4">
                  <h3 className="text-[11px] font-black uppercase tracking-widest text-muted">
                    {g.title} · {rows.length}
                  </h3>
                  <ul className="mt-2 flex flex-col divide-y divide-subtle">
                    {rows.map((l) => (
                      <li key={`${l.action}-${l.sku}`} className="flex items-start gap-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <span className="font-mono text-sm font-bold text-content">
                              {l.sku}
                            </span>
                            {l.sd_number != null && (
                              <span className="font-mono text-xs font-bold text-orange-500">
                                #{sdCode(l.sd_number)}
                              </span>
                            )}
                            {l.reason && (
                              <span className="ml-auto shrink-0 text-[10px] font-bold uppercase tracking-wider text-muted">
                                {l.reason}
                              </span>
                            )}
                          </div>
                          <div className="truncate text-xs text-muted">
                            {g.action === 'CREATE'
                              ? (l.item_name ?? '—')
                              : `AS400: ${(l.as400_description ?? '').replace(/\s+/g, ' ')}`}
                          </div>
                          {l.serial_number && (
                            <div className="font-mono text-xs text-content">
                              Box serial {l.serial_number}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => void done(l.sku)}
                          aria-label={`Done in AS400: ${l.sku}`}
                          className="mt-0.5 flex h-9 shrink-0 items-center gap-1 rounded-xl border border-subtle px-2.5 text-[11px] font-black uppercase tracking-wider text-content active:scale-95"
                        >
                          <Check size={14} /> Done
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
