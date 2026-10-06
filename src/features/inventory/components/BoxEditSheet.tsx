/**
 * The short sheets of editing a row's boxes from the Stock card (idea-253,
 * docs/design/stock-card-edit.html frames 3–5): a number, the square letters
 * (move / split), a new group, and the confirmation before saving. They only
 * stage changes; the confirmation is the one place that writes.
 */
import { useState } from 'react';
import Check from 'lucide-react/dist/esm/icons/check';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import type { DistributionItem } from '../../../schemas/inventory.schema';
import { mismatchLabel, SQUARE_CAP, type SquareChange } from '../utils/squareEdit';

export type BoxEditSheetSpec =
  | {
      kind: 'number';
      /** `G · TOWER · UNITS EACH` */
      title: string;
      value: number;
      /** Count can go to 0 (removes the group); units each can't. */
      min: 0 | 1;
      onCommit: (n: number) => void;
    }
  | {
      kind: 'letters';
      /** `ROW 31` */
      row: string;
      letters: string[];
      current: string;
      group: DistributionItem;
      onMove: (letter: string) => void;
      /** One box out of the group; returns the box that came out. */
      onSplit: () => DistributionItem;
    }
  | {
      kind: 'add';
      row: string;
      letters: string[];
      square: string | null;
      onAdd: (group: DistributionItem) => void;
    }
  | {
      kind: 'confirm';
      sku: string;
      location: string;
      changes: SquareChange[];
      boxes: number;
      quantity: number;
      mismatch: number;
      over: SquareChange[];
      onConfirm: () => Promise<void>;
    };

const TYPE_WORD: Record<DistributionItem['type'], string> = {
  TOWER: 'tower',
  LINE: 'line',
  PALLET: 'pallet',
  OTHER: 'other',
};

const label = 'font-mono text-[10.5px] font-bold uppercase tracking-[0.14em] text-white/45';

export function BoxEditSheet({ spec, onClose }: { spec: BoxEditSheetSpec; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[190] flex items-end justify-center bg-black/55"
      onClick={onClose}
      data-testid="box-edit-sheet"
    >
      <div
        className="flex w-full max-w-[430px] flex-col gap-3 rounded-t-2xl border border-b-0 border-[#2A2F36] bg-[#161920] px-4 pb-[max(1.1rem,env(safe-area-inset-bottom))] pt-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto h-1 w-10 rounded-full bg-white/15" />
        {spec.kind === 'number' && <NumberSheet spec={spec} onClose={onClose} />}
        {spec.kind === 'letters' && <LettersSheet spec={spec} onClose={onClose} />}
        {spec.kind === 'add' && <AddSheet spec={spec} onClose={onClose} />}
        {spec.kind === 'confirm' && <ConfirmSheet spec={spec} onClose={onClose} />}
      </div>
    </div>
  );
}

function NumberSheet({
  spec,
  onClose,
}: {
  spec: Extract<BoxEditSheetSpec, { kind: 'number' }>;
  onClose: () => void;
}) {
  const [text, setText] = useState(String(spec.value));
  const n = Number(text);
  const ok = text.trim() !== '' && Number.isInteger(n) && n >= spec.min && n <= 9999;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        spec.onCommit(n);
        onClose();
      }}
    >
      <span className={label}>{spec.title}</span>
      <div className="flex items-baseline gap-3 rounded-xl border-2 border-amber-400 bg-[#0F1115] px-4 py-2">
        <input
          autoFocus
          aria-label={spec.title}
          inputMode="numeric"
          pattern="[0-9]*"
          value={text}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setText(e.target.value.replace(/\D/g, ''))}
          className="w-full min-w-0 bg-transparent text-center font-mono text-4xl font-black text-white outline-none"
        />
        <span className="shrink-0 font-mono text-xs text-white/40">was {spec.value}</span>
      </div>
      {spec.min === 0 && n === 0 && text !== '' && (
        <span className="text-center text-xs text-amber-300">0 removes this group</span>
      )}
      <button
        type="submit"
        disabled={!ok}
        className="h-12 rounded-xl bg-amber-400 font-bold text-[#3b2400] disabled:opacity-40"
      >
        OK
      </button>
    </form>
  );
}

function LettersSheet({
  spec,
  onClose,
}: {
  spec: Extract<BoxEditSheetSpec, { kind: 'letters' }>;
  onClose: () => void;
}) {
  // After Split, the letters move the box that came out.
  const [group, setGroup] = useState(spec.group);
  const [split, setSplit] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <span className={label}>
        {spec.row} · move {group.count}×{group.units_each} {TYPE_WORD[group.type]}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {spec.letters.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => {
              if (l !== spec.current || split) spec.onMove(l);
              onClose();
            }}
            className={`h-11 w-11 rounded-lg border font-mono text-lg font-black ${
              l === spec.current
                ? 'border-amber-400 bg-amber-400 text-[#3b2400]'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
            }`}
          >
            {l}
          </button>
        ))}
      </div>
      {!split && group.count > 1 && (
        <button
          type="button"
          onClick={() => {
            const out = spec.onSplit();
            setGroup(out);
            setSplit(true);
          }}
          className="h-11 rounded-xl border border-[#2A2F36] bg-[#0F1115] font-mono text-sm font-bold text-white/80"
        >
          Split {group.count}×{group.units_each} → {group.count - 1}×{group.units_each} + 1×
          {group.units_each}
        </button>
      )}
      {split && (
        <span className="text-center text-xs text-white/50">Now tap where the box goes</span>
      )}
    </div>
  );
}

function AddSheet({
  spec,
  onClose,
}: {
  spec: Extract<BoxEditSheetSpec, { kind: 'add' }>;
  onClose: () => void;
}) {
  const [type, setType] = useState<DistributionItem['type']>('TOWER');
  const [count, setCount] = useState('1');
  const [each, setEach] = useState('30');
  const [square, setSquare] = useState(spec.square);
  const c = Number(count);
  const e = Number(each);
  const ok = c > 0 && e > 0 && (spec.letters.length === 0 || !!square);
  const input =
    'w-full min-w-0 rounded-xl border border-[#2A2F36] bg-[#0F1115] p-3 text-center font-mono text-2xl font-black text-white focus:border-amber-400 focus:outline-none';
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (!ok) return;
        spec.onAdd({ type, count: c, units_each: e, ...(square ? { square } : {}) });
        onClose();
      }}
    >
      <span className={label}>{spec.row} · add boxes</span>
      <div className="grid grid-cols-3 gap-1.5">
        {(['TOWER', 'LINE', 'PALLET'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setType(t);
              setEach(t === 'LINE' ? '5' : '30');
            }}
            className={`h-10 rounded-lg border text-sm font-bold capitalize ${
              type === t
                ? 'border-white bg-white text-[#111214]'
                : 'border-[#2A2F36] bg-[#0F1115] text-white/70'
            }`}
          >
            {TYPE_WORD[t]}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          aria-label="How many"
          inputMode="numeric"
          value={count}
          onFocus={(ev) => ev.target.select()}
          onChange={(ev) => setCount(ev.target.value.replace(/\D/g, ''))}
          className={input}
        />
        <span className="font-mono text-xl text-white/40">×</span>
        <input
          aria-label="Units each"
          inputMode="numeric"
          value={each}
          onFocus={(ev) => ev.target.select()}
          onChange={(ev) => setEach(ev.target.value.replace(/\D/g, ''))}
          className={input}
        />
      </div>
      {spec.letters.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {spec.letters.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setSquare(l)}
              className={`h-10 w-10 rounded-lg border font-mono text-base font-black ${
                square === l
                  ? 'border-amber-400 bg-amber-400 text-[#3b2400]'
                  : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      )}
      <button
        type="submit"
        disabled={!ok}
        className="h-12 rounded-xl bg-amber-400 font-bold text-[#3b2400] disabled:opacity-40"
      >
        Add {c || 0}×{e || 0}
        {square ? ` in ${square}` : ''}
      </button>
    </form>
  );
}

function ConfirmSheet({
  spec,
  onClose,
}: {
  spec: Extract<BoxEditSheetSpec, { kind: 'confirm' }>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const warn = mismatchLabel(spec.mismatch);
  return (
    <div className="flex flex-col gap-2">
      <span className={label}>
        {spec.sku} · {spec.location}
      </span>
      <div className="flex flex-col divide-y divide-[#2A2F36] rounded-xl border border-[#2A2F36] bg-[#0F1115]">
        {spec.changes.map((ch) => (
          <div key={ch.square} className="flex items-center justify-between px-3 py-2 font-mono">
            <span className="font-black text-white">{ch.square || '—'}</span>
            <span className="text-sm">
              <span className="text-white/45 line-through">{ch.before}</span>
              <span className="text-white/45"> → </span>
              <span className="font-black text-amber-300">{ch.after}</span>
            </span>
          </div>
        ))}
      </div>
      <div
        className={`flex items-center justify-between px-1 font-mono text-sm font-bold ${warn ? 'text-amber-300' : 'text-white/80'}`}
      >
        <span>
          Boxes {spec.boxes} · Qty {spec.quantity}
          {warn ? ` · ${warn}` : ''}
        </span>
        {!warn && <Check size={16} className="text-emerald-400" />}
      </div>
      {spec.over.map((o) => (
        <div key={o.square} className="px-1 font-mono text-sm font-bold text-amber-300">
          {o.square} {o.after} &gt; {SQUARE_CAP}
        </div>
      ))}
      <div className="mt-1 flex gap-2">
        <button
          type="button"
          onClick={onClose}
          className="h-12 flex-1 rounded-xl border border-[#2A2F36] bg-[#0F1115] font-bold text-white/70"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await spec.onConfirm();
            } finally {
              setBusy(false);
            }
          }}
          className="flex h-12 flex-[1.6] items-center justify-center rounded-xl bg-emerald-400 font-bold text-[#06281a] disabled:opacity-60"
        >
          {busy ? <Loader2 size={18} className="animate-spin" /> : 'Confirm'}
        </button>
      </div>
    </div>
  );
}
