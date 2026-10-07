/**
 * Mark as S/D on a SKU with more than one unit (idea-257 P2): one unit leaves
 * under its own SKU. Which one: a free 01- number (Rafael, 7 Oct 2026:
 * «proponer 5 sku libres según la data de pickd y as400»), or else its serial,
 * or else SD + its #. The serial is asked either way — it is the box's.
 *
 * Free numbers come from `sd_free_skus`: first the never-used ones AS400
 * confirmed it lacks (the watchdog's `sd_sku_probes`), then sold S/D numbers
 * with nothing in PickD or AS400, gone longest first — taking one of those
 * archives the bike that last had it.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { supabase } from '../../../../lib/supabase';

interface FreeSku {
  sku: string;
  kind: string;
  as400_read_at: string | null;
  last_out: string | null;
  as400_description: string | null;
}

const month = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }).toUpperCase()
    : '';

export function SdSplitSheet({
  sku,
  totalUnits,
  onCancel,
  onDone,
}: {
  sku: string;
  totalUnits: number;
  onCancel: () => void;
  onDone: (choice: { serial: string; newSku: string | null }) => void;
}) {
  const [serial, setSerial] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const { data: free = [], isLoading } = useQuery({
    queryKey: ['sd-free-skus'],
    staleTime: 30_000,
    queryFn: async (): Promise<FreeSku[]> => {
      const { data, error } = await supabase.rpc('sd_free_skus', { p_limit: 5 });
      if (error) throw error;
      return (data ?? []) as FreeSku[];
    },
  });

  const target = picked ?? (serial.trim() ? serial.trim().toUpperCase() : 'SD + its #');

  return (
    <div
      className="fixed inset-0 z-[190] flex items-end justify-center bg-black/55"
      onClick={onCancel}
    >
      <form
        className="flex max-h-[90vh] w-full max-w-[430px] flex-col gap-3 overflow-y-auto rounded-t-2xl border border-b-0 border-[#2A2F36] bg-[#161920] px-4 pb-[max(1.1rem,env(safe-area-inset-bottom))] pt-4"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onDone({ serial: serial.trim().toUpperCase(), newSku: picked });
        }}
      >
        <span className="text-[10.5px] uppercase tracking-[0.14em] text-white/45">
          Mark as S/D · 1 of {totalUnits} leaves {sku}
        </span>

        <span className="text-[10.5px] uppercase tracking-[0.14em] text-white/45">
          Free 01- numbers
        </span>
        <div className="flex flex-col gap-1.5">
          {isLoading && <span className="text-xs text-white/40">Looking…</span>}
          {!isLoading && free.length === 0 && (
            <span className="text-xs text-white/40">None free in PickD and AS400.</span>
          )}
          {free.map((f) => {
            const on = picked === f.sku;
            return (
              <button
                key={f.sku}
                type="button"
                onClick={() => setPicked(on ? null : f.sku)}
                className={`flex flex-col items-start rounded-xl border px-3 py-2 text-left ${
                  on ? 'border-orange-400 bg-orange-500/10' : 'border-[#2A2F36] bg-[#0F1115]'
                }`}
              >
                <span className="font-mono text-base font-bold text-white">{f.sku}</span>
                <span className="w-full truncate font-mono text-[10.5px] text-white/40">
                  {f.kind === 'never_used'
                    ? `never used · not in AS400 (checked ${month(f.as400_read_at)})`
                    : `out ${month(f.last_out)} · was ${f.as400_description?.replace(/\s+/g, ' ') ?? '—'}`}
                </span>
              </button>
            );
          })}
        </div>

        <label
          htmlFor="sd-split-serial"
          className="text-[10.5px] uppercase tracking-[0.14em] text-white/45"
        >
          Serial on the box
        </label>
        <input
          id="sd-split-serial"
          value={serial}
          onChange={(e) => setSerial(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          className="w-full rounded-xl border border-white bg-[#0F1115] p-3.5 font-mono text-xl font-bold uppercase text-white focus:outline-none"
        />
        <span className="text-xs text-white/45">
          New SKU: <span className="font-mono font-bold text-white">{target}</span>, linked to {sku}
          ; the other {totalUnits - 1} stay new.
          {picked && free.find((f) => f.sku === picked)?.kind === 'never_used'
            ? ' Create it in AS400 with this number.'
            : picked
              ? ' The bike that had this number goes to its history; update it in AS400.'
              : ''}
        </span>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-[#2A2F36] py-3 font-semibold text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="flex-1 rounded-xl bg-white py-3 font-semibold text-[#0F1115]"
          >
            Mark S/D
          </button>
        </div>
      </form>
    </div>
  );
}
