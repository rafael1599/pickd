/**
 * The door: AS400 captures Bay 2 has published, brought into Pickd with a tap.
 *
 * Each row carries the same facts a board card carries — FedEx or regular from
 * autoClassifyShippingType, pallets from calculatePalletsWithBikeAwareness,
 * bikes and parts from the is_bike flags the watchdog embedded — so what the
 * operator sees here is what they will see on the board a few seconds after
 * tapping. Rafael, 2026-09-08: the data must already be in Pickd; the tap only
 * validates it.
 *
 * ── Why this screen ignores the app's theme ─────────────────────────────────
 * It is a window onto the AS400, so it looks like the AS400: phosphor green on
 * black, monospace, uppercase field labels, in light mode and dark alike
 * (Rafael, 2026-09-09). Same reasoning as ManualFigure, which paints FedEx Ship
 * Manager in FSM's own colours because it is a picture of somebody else's
 * software. That carries ManualFigure's rule with it: **every colour here is
 * explicit**, never inherited — a token would repaint half of it white on white.
 *
 * Green is the terminal. **Purple is the only other colour a capture can be,
 * and it means FedEx** — no badge, no label, just the colour, because on a
 * screen where everything is green the one purple row is unmissable and a badge
 * would be a second way of saying it. Amber is a hold, red is the way out.
 *
 * The order number keeps the board's treatment: the last three digits big and
 * bright, the prefix dim. It is what anybody reads a number by around here.
 */
import { useEffect, useMemo, useState } from 'react';
import X from 'lucide-react/dist/esm/icons/x';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import { useDebounce } from '../../../../hooks/useDebounce';
import { noteTone, readOrderNote } from '../../../../utils/orderNoteSignals';
import {
  heldCaptures,
  holdCaptures,
  inFlightCaptures,
  isRequestable,
  isWatcherAlive,
  pendingCaptures,
  summarize,
  useAs400CaptureSearch,
  useAs400Door,
  useCancelRequest,
  useDismissCapture,
  useRequestCapture,
  useWatcherHeartbeat,
  type DoorCapture,
} from '../../hooks/useAs400Door';
import toast from 'react-hot-toast';

/** P1 phosphor, and the three colours allowed to interrupt it. */
const C = {
  bg: '#050a06',
  panel: '#0a1410',
  line: '#1c3325',
  green: '#5ef08a',
  dim: '#3f8f5f',
  faint: '#2b5c3d',
  purple: '#c084fc',
  amber: '#e8a04a',
  red: '#f87171',
} as const;

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/** What a searched row is, when it is not one of the four the list shows. */
const STATE_LABELS: Record<string, string> = {
  archived: 'AGED OUT OF THE LIST',
  junk: 'DISMISSED',
  sent: 'ALREADY IN PICKD',
};

const HOLD_LABELS: Record<string, string> = {
  total_mismatch: 'LOST PAGE — RE-CAPTURE ON BAY 2',
  waiting_locked: 'WAITING FOR INVENTORY IN PICKD',
  no_customer: 'NO CUSTOMER ON THE CAPTURE',
  stale: 'NOBODY BROUGHT IT IN',
  error: 'SEND FAILED',
};

function age(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (min < 60) return `${min}M`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h}H`;
  return `${Math.round(h / 24)}D`;
}

/** `CUSTOMER  SHREWSBURY BICYCLES` — a 5250 screen is label + value, in columns. */
function Field({
  label,
  value,
  color = C.green,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span style={{ color: C.faint }} className="text-[10px] tracking-widest">
        {label}
      </span>
      <b style={{ color }} className="text-sm font-bold tabular-nums">
        {value}
      </b>
    </span>
  );
}

function TermButton({
  children,
  onClick,
  disabled,
  color = C.green,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  color?: string;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{ color, borderColor: color, fontFamily: MONO }}
      className="px-3 py-1 text-xs font-bold tracking-widest border rounded-sm
                 hover:brightness-150 active:scale-[0.98] transition-all
                 disabled:opacity-30 disabled:cursor-not-allowed
                 focus:outline-none focus-visible:ring-1 focus-visible:ring-current"
    >
      {children}
    </button>
  );
}

function CaptureCard({
  row,
  canAct,
  onBring,
  onCancel,
  onDismiss,
  busy,
}: {
  row: DoorCapture;
  canAct: boolean;
  onBring: () => void;
  onCancel: () => void;
  onDismiss: () => void;
  busy: boolean;
}) {
  const s = useMemo(() => summarize(row), [row]);
  // The whole row takes the carrier's colour. On a green screen the purple ones
  // are the FedEx ones, and that is the entire legend.
  const tone = s.lane === 'fedex' ? C.purple : C.green;
  const inFlight = row.status === 'requested' || row.status === 'sending';
  const done = row.status === 'sent';
  // An office hold is waiting on purpose: the pipeline's "nobody brought it in"
  // and "aged out" say nothing true about it, so they give way to its label.
  const officeHold = row.hold ?? null;
  const held = row.status === 'held' && !officeHold;
  const requestable = isRequestable(row);
  const head = row.order_number.slice(0, -3);
  const tail = row.order_number.slice(-3);
  // The Order Comments, unless they are only billing ("FF NET 60").
  const comment =
    row.order_comments && noteTone(readOrderNote(row.order_comments)) ? row.order_comments : null;

  return (
    <div
      style={{ background: C.panel, borderColor: C.line, borderLeftColor: tone, fontFamily: MONO }}
      className="border border-l-4 rounded-sm px-3 py-2.5"
    >
      <div className="flex items-baseline gap-2">
        <span className="leading-none">
          <span style={{ color: C.faint }} className="text-base">
            {head}
          </span>
          <span style={{ color: tone }} className="text-2xl font-black">
            {tail}
          </span>
        </span>
        {row.total_mismatch && (
          <span style={{ color: C.amber }} className="text-[10px] font-black tracking-widest">
            ⚠ TOTAL
          </span>
        )}
        <span style={{ color: C.faint }} className="ml-auto text-xs tabular-nums">
          {age(row.captured_at)}
        </span>
      </div>

      <div style={{ color: C.green }} className="mt-1 text-sm font-bold truncate">
        {row.customer ?? '—'}
      </div>
      {row.ship_to && row.ship_to !== row.customer && (
        <div style={{ color: C.dim }} className="text-xs truncate">
          &gt; {row.ship_to}
        </div>
      )}
      {(officeHold || comment) && (
        <div
          style={{ color: officeHold ? C.amber : C.dim }}
          className="mt-1 text-xs truncate"
          title={row.order_comments ?? undefined}
        >
          {officeHold && (
            <b className="font-black tracking-widest">
              {officeHold === 'HOLD' ? 'HOLD' : `HOLD · ${officeHold}`}
              {comment ? ' · ' : ''}
            </b>
          )}
          {comment}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <Field label="PLT" value={String(s.pallets)} color={tone} />
        <Field label="BIKE" value={String(s.bikes)} color={tone} />
        <Field label="PART" value={String(s.parts)} color={tone} />
        <Field label="UNIT" value={String(s.units)} color={C.dim} />
      </div>

      {STATE_LABELS[row.status] && !(officeHold && row.status === 'archived') && (
        <div style={{ color: C.faint }} className="mt-2 text-[10px] tracking-widest">
          {STATE_LABELS[row.status]}
        </div>
      )}
      {held && (
        <div style={{ color: C.amber }} className="mt-2 text-[10px] tracking-widest">
          {HOLD_LABELS[row.hold_reason ?? ''] ?? row.hold_reason}
          {row.last_error && (
            <span style={{ color: C.faint }} className="block tracking-normal truncate">
              {row.last_error}
            </span>
          )}
        </div>
      )}

      <div className="mt-2.5 flex items-center gap-2">
        {done ? (
          <span style={{ color: C.green }} className="text-xs font-bold tracking-widest">
            ✓ ON THE BOARD
          </span>
        ) : inFlight ? (
          <>
            <span
              style={{ color: C.green }}
              className="inline-flex items-center gap-1.5 text-xs font-bold tracking-widest"
            >
              <Loader2 size={13} className="animate-spin" />
              {row.status === 'sending' ? 'SENDING' : 'REQUESTED'} {age(row.requested_at)}
            </span>
            <span className="ml-auto">
              <TermButton onClick={onCancel} disabled={busy} color={C.dim}>
                CANCEL
              </TermButton>
            </span>
          </>
        ) : (
          <>
            <TermButton
              onClick={onBring}
              disabled={!canAct || !requestable || busy}
              color={tone}
              title={
                !canAct
                  ? 'Bay 2 is offline'
                  : !requestable
                    ? 'Needs a re-capture on Bay 2'
                    : 'Bring this order onto the board'
              }
            >
              ▸ BRING IN
            </TermButton>
            <span className="ml-auto">
              <TermButton onClick={onDismiss} disabled={busy} color={C.faint} title="Hide it">
                DISMISS
              </TermButton>
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export function As400DoorModal({ onClose }: { onClose: () => void }) {
  const door = useAs400Door();
  const heartbeat = useWatcherHeartbeat();
  const request = useRequestCapture();
  const cancel = useCancelRequest();
  const dismiss = useDismissCapture();
  const [showHeld, setShowHeld] = useState(false);
  const [showHolds, setShowHolds] = useState(false);
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, 250);
  const search = useAs400CaptureSearch(debounced);
  const searching = debounced.trim().length >= 2;

  // A full takeover has no backdrop left to tap, so Escape is the other way out.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rows = door.data ?? [];
  const pending = pendingCaptures(rows);
  const inFlight = inFlightCaptures(rows);
  const holds = holdCaptures(rows);
  const held = heldCaptures(rows);
  const alive = isWatcherAlive(heartbeat.data);
  const busy = request.isPending || cancel.isPending || dismiss.isPending;

  const bring = async (n: string) => {
    try {
      const ok = await request.mutateAsync(n);
      if (ok) toast.success(`#${n} requested — Bay 2 is sending it`);
      else toast('Somebody got there first, or it can no longer be brought in.', { icon: '↺' });
    } catch (e) {
      toast.error(`Could not request #${n}: ${(e as Error).message}`);
    }
  };
  const takeBack = async (n: string) => {
    try {
      const ok = await cancel.mutateAsync(n);
      if (!ok) toast('Only the requester or an admin can cancel it.', { icon: '🔒' });
    } catch (e) {
      toast.error(`Could not cancel #${n}: ${(e as Error).message}`);
    }
  };
  const drop = async (n: string) => {
    try {
      const ok = await dismiss.mutateAsync(n);
      if (ok) toast.success(`#${n} dismissed`);
    } catch (e) {
      toast.error(`Could not dismiss #${n}: ${(e as Error).message}`);
    }
  };

  const seen = heartbeat.data?.seen_at
    ? new Date(heartbeat.data.seen_at).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  const card = (row: DoorCapture) => (
    <CaptureCard
      key={row.order_number}
      row={row}
      canAct={alive}
      busy={busy}
      onBring={() => bring(row.order_number)}
      onCancel={() => takeBack(row.order_number)}
      onDismiss={() => drop(row.order_number)}
    />
  );

  return (
    <div
      style={{ background: C.bg, fontFamily: MONO }}
      className="fixed inset-0 z-[120] flex flex-col"
      role="dialog"
      aria-label="AS400 captures"
    >
      {/* Scanlines. Barely there — enough to read as a screen, not enough to
          fight the text. pointer-events-none so it never eats a tap. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, rgba(0,0,0,.6) 0px, rgba(0,0,0,.6) 1px, transparent 1px, transparent 3px)',
        }}
      />

      <div className="relative flex-1 min-h-0 flex flex-col w-full md:max-w-2xl md:mx-auto">
        <div
          style={{ borderColor: C.line }}
          className="flex items-center justify-between gap-3 px-4 py-3 border-b"
        >
          <div className="min-w-0">
            {/* The 5250 spaces its titles out; so does this one. */}
            <h2
              style={{ color: C.green }}
              className="text-xs md:text-sm font-black tracking-[0.35em] whitespace-nowrap"
            >
              A S 4 0 0 &nbsp; C A P T U R E S
            </h2>
            <p style={{ color: C.faint }} className="mt-1 text-[10px] tracking-widest">
              {pending.length} WAITING
              {holds.length > 0 && ` · ${holds.length} HOLD`}
              {inFlight.length > 0 && ` · ${inFlight.length} ON THE WAY`}
              {held.length > 0 && ` · ${held.length} STUCK`}
              {' · '}
              <span style={{ color: alive ? C.green : C.amber }}>
                {alive ? 'BAY 2 ONLINE' : seen ? `BAY 2 LAST SEEN ${seen}` : 'BAY 2 OFFLINE'}
              </span>
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ color: C.red }}
            className="shrink-0 p-2 rounded-sm hover:bg-red-500/10 active:scale-95 transition-all
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
            aria-label="Close"
          >
            <X size={32} strokeWidth={3} />
          </button>
        </div>

        {!alive && !heartbeat.isLoading && (
          <div
            style={{ color: C.amber, borderColor: C.line }}
            className="px-4 py-2 text-[11px] tracking-wide border-b"
          >
            ⚠ BAY 2 IS NOT ANSWERING — requests will wait until it is back.
          </div>
        )}

        {/* The terminal's own prompt, not the app's search bar. */}
        <div
          style={{ borderColor: C.line }}
          className="flex items-center gap-2 px-4 py-2.5 border-b"
        >
          <span style={{ color: C.dim }} className="text-sm font-black">
            &gt;
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ORDER NUMBER — LAST 3 DIGITS IS ENOUGH"
            inputMode="numeric"
            autoFocus
            spellCheck={false}
            style={{ color: C.green, fontFamily: MONO, caretColor: C.green }}
            className="flex-1 min-w-0 bg-transparent border-0 outline-none text-sm tracking-widest
                       placeholder:text-[10px] placeholder:tracking-widest"
          />
          {query && (
            <TermButton onClick={() => setQuery('')} color={C.faint}>
              CLR
            </TermButton>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          {searching ? (
            <>
              {search.isLoading && (
                <p style={{ color: C.dim }} className="text-xs tracking-widest text-center py-6">
                  SEARCHING…
                </p>
              )}
              {!search.isLoading && (search.data ?? []).length === 0 && (
                <p style={{ color: C.dim }} className="text-xs tracking-wide text-center py-6">
                  NO CAPTURE MATCHING “{debounced}”.
                  <span style={{ color: C.faint }} className="block mt-1">
                    The scanner may not have reached it yet.
                  </span>
                </p>
              )}
              {(search.data ?? []).map(card)}
            </>
          ) : (
            <>
              {door.isLoading && (
                <p style={{ color: C.dim }} className="text-xs tracking-widest text-center py-6">
                  LOADING…
                </p>
              )}
              {door.isError && (
                <p style={{ color: C.red }} className="text-xs tracking-wide text-center py-6">
                  COULD NOT LOAD THE CAPTURES.
                </p>
              )}
              {!door.isLoading && pending.length === 0 && inFlight.length === 0 && (
                <p style={{ color: C.dim }} className="text-xs tracking-wide text-center py-6">
                  NOTHING WAITING.
                  <span style={{ color: C.faint }} className="block mt-1">
                    New captures appear here as the scanner finds them.
                  </span>
                </p>
              )}
              {inFlight.map(card)}
              {pending.map(card)}

              {/* The office's holds: waiting on purpose (adds, Renegades, a
                  confirmation), so they never age out and never count as waiting. */}
              {holds.length > 0 && (
                <div className="pt-2">
                  <button
                    onClick={() => setShowHolds((v) => !v)}
                    style={{ color: C.amber }}
                    className="w-full text-left text-[10px] font-black tracking-widest py-1"
                  >
                    {showHolds ? '▾' : '▸'} HOLD ({holds.length})
                  </button>
                  {showHolds && <div className="space-y-2.5 mt-2">{holds.map(card)}</div>}
                </div>
              )}

              {/* Stuck in the pipeline — a lost page, no customer, nobody brought
                  it in. Named apart so "hold" means one thing on this screen. */}
              {held.length > 0 && (
                <div className="pt-2">
                  <button
                    onClick={() => setShowHeld((v) => !v)}
                    style={{ color: C.dim }}
                    className="w-full text-left text-[10px] font-black tracking-widest py-1"
                  >
                    {showHeld ? '▾' : '▸'} STUCK ({held.length})
                  </button>
                  {showHeld && <div className="space-y-2.5 mt-2">{held.map(card)}</div>}
                </div>
              )}
            </>
          )}
        </div>

        {/* The legend every 5250 screen carries at the foot. */}
        <div
          style={{ color: C.faint, borderColor: C.line }}
          className="px-4 py-2 border-t text-[10px] tracking-widest flex items-center gap-4"
        >
          <span>
            <span style={{ color: C.purple }}>■</span> FEDEX
          </span>
          <span>
            <span style={{ color: C.green }}>■</span> TRUCK
          </span>
          <span className="ml-auto">ESC EXIT</span>
        </div>
      </div>
    </div>
  );
}
