/**
 * The door: AS400 captures Bay 2 has published, brought into Pickd with a tap.
 *
 * Each row is drawn with the same rule as the board's own cards — FedEx or
 * regular from `autoClassifyShippingType`, pallets from
 * `calculatePalletsWithBikeAwareness`, bikes and parts from the flags the
 * watchdog embedded — so what the operator sees here is what they will see on
 * the board a few seconds after tapping. Rafael, 2026-09-08: the data must
 * already be in Pickd; the tap only validates it.
 *
 * A held row says why and, when the reason is one a person can clear (stale,
 * waiting for inventory), still offers the tap. A lost page (total_mismatch)
 * does not: sending it would create a wrong picking list, and the only fix is a
 * re-capture on Bay 2.
 *
 * When Bay 2 has not been heard from in a minute the tap is disabled, because a
 * request nobody is there to execute should not look like it is being worked
 * on.
 */
import { useMemo, useState } from 'react';
import X from 'lucide-react/dist/esm/icons/x';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import ArrowDownToLine from 'lucide-react/dist/esm/icons/arrow-down-to-line';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import WifiOff from 'lucide-react/dist/esm/icons/wifi-off';
import toast from 'react-hot-toast';
import {
  heldCaptures,
  inFlightCaptures,
  isRequestable,
  isWatcherAlive,
  pendingCaptures,
  summarize,
  useAs400Door,
  useCancelRequest,
  useDismissCapture,
  useRequestCapture,
  useWatcherHeartbeat,
  type DoorCapture,
} from '../../hooks/useAs400Door';

const HOLD_LABELS: Record<string, string> = {
  total_mismatch: 'Lost page — re-capture on Bay 2',
  waiting_locked: 'Waiting for inventory in Pickd',
  no_customer: 'No customer on the capture',
  stale: 'Nobody brought it in',
  error: 'Send failed',
};

const LANE = {
  fedex: { stripe: 'bg-purple-500/70', badge: 'bg-purple-500', text: 'FDX' },
  regular: { stripe: 'bg-emerald-500/70', badge: 'bg-emerald-500', text: 'TRK' },
} as const;

function age(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

function OrderNumber({ n }: { n: string }) {
  const head = n.slice(0, -3);
  const tail = n.slice(-3);
  return (
    <span className="font-mono tabular-nums">
      <span className="text-muted">{head}</span>
      <span className="text-content font-black text-lg">{tail}</span>
    </span>
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
  const lane = LANE[s.lane];
  const inFlight = row.status === 'requested' || row.status === 'sending';
  const held = row.status === 'held';
  const requestable = isRequestable(row);

  return (
    <div className="relative flex gap-3 rounded-2xl bg-surface border border-subtle overflow-hidden">
      <div className={`w-1.5 shrink-0 ${lane.stripe}`} />
      <div className="flex-1 min-w-0 py-3 pr-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <OrderNumber n={row.order_number} />
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-black text-white ${lane.badge}`}
              >
                {lane.text}
              </span>
              {row.total_mismatch && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-amber-500 text-white">
                  ⚠ TOTAL
                </span>
              )}
            </div>
            <div className="text-sm font-bold text-content truncate">{row.customer ?? '—'}</div>
            {row.ship_to && row.ship_to !== row.customer && (
              <div className="text-xs text-muted truncate">→ {row.ship_to}</div>
            )}
          </div>
          <div className="text-[11px] text-muted whitespace-nowrap">{age(row.captured_at)} ago</div>
        </div>

        <div className="mt-2 flex items-baseline gap-3 text-xs text-muted tabular-nums">
          <span>
            <b className="text-content">{s.pallets}</b> {s.pallets === 1 ? 'pallet' : 'pallets'}
          </span>
          <span>
            <b className="text-content">{s.bikes}</b> bikes
          </span>
          <span>
            <b className="text-content">{s.parts}</b> parts
          </span>
          <span className="ml-auto">{s.units} units</span>
        </div>

        {held && (
          <div className="mt-2 text-xs text-amber-500 font-semibold">
            {HOLD_LABELS[row.hold_reason ?? ''] ?? row.hold_reason}
            {row.last_error && (
              <span className="block text-muted font-normal truncate">{row.last_error}</span>
            )}
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          {inFlight ? (
            <>
              <span className="inline-flex items-center gap-1.5 text-xs text-sky-500 font-bold">
                <Loader2 size={14} className="animate-spin" />
                {row.status === 'sending' ? 'Sending…' : 'Requested'} · {age(row.requested_at)}
              </span>
              <button
                onClick={onCancel}
                disabled={busy}
                className="ml-auto text-xs px-2.5 py-1 rounded-lg border border-subtle text-muted hover:text-content disabled:opacity-50"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onBring}
                disabled={!canAct || !requestable || busy}
                title={
                  !canAct
                    ? 'Bay 2 is offline'
                    : !requestable
                      ? 'Needs a re-capture on Bay 2'
                      : 'Bring this order onto the board'
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-accent text-white text-xs font-bold
                           disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition-all
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <ArrowDownToLine size={14} />
                Bring in
              </button>
              <button
                onClick={onDismiss}
                disabled={busy}
                title="Never offer this capture again"
                className="ml-auto inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-subtle text-muted hover:text-red-500 hover:border-red-500/40 disabled:opacity-50"
              >
                <Trash2 size={13} />
                Dismiss
              </button>
            </>
          )}
        </div>
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

  const rows = door.data ?? [];
  const pending = pendingCaptures(rows);
  const inFlight = inFlightCaptures(rows);
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

  return (
    // A full takeover on solid `bg-main`, like the board underneath it — not a
    // sheet over a dimmed backdrop. Rafael, 2026-09-09: the board behind must
    // not show through.
    <div
      className="fixed inset-0 z-[120] flex flex-col bg-main"
      role="dialog"
      aria-label="AS400 captures"
    >
      <div className="flex-1 min-h-0 flex flex-col w-full md:max-w-2xl md:mx-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-subtle">
          <div>
            <h2 className="text-base font-black text-content uppercase tracking-tight">
              From the AS400
            </h2>
            <p className="text-[11px] text-muted">
              {pending.length} waiting
              {inFlight.length > 0 && ` · ${inFlight.length} on the way`}
              {held.length > 0 && ` · ${held.length} held`}
            </p>
          </div>
          {/* Big and red on purpose: this is a full takeover, so the way out
              has to be the most obvious thing on screen. */}
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-red-500 hover:bg-red-500/10 active:scale-95 transition-all
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            aria-label="Close"
          >
            <X size={32} strokeWidth={3} />
          </button>
        </div>

        {!alive && !heartbeat.isLoading && (
          <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 text-amber-500 text-xs font-semibold border-b border-amber-500/20">
            <WifiOff size={14} />
            {seen
              ? `Bay 2 has not been heard from since ${seen}`
              : 'Bay 2 has not been heard from yet'}{' '}
            — requests will wait until it is back.
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {door.isLoading && <p className="text-sm text-muted text-center py-6">Loading…</p>}
          {door.isError && (
            <p className="text-sm text-red-500 text-center py-6">Could not load the captures.</p>
          )}

          {!door.isLoading && pending.length === 0 && inFlight.length === 0 && (
            <p className="text-sm text-muted text-center py-6">
              Nothing waiting. New captures show up here as the scanner finds them.
            </p>
          )}

          {inFlight.map((row) => (
            <CaptureCard
              key={row.order_number}
              row={row}
              canAct={alive}
              busy={busy}
              onBring={() => bring(row.order_number)}
              onCancel={() => takeBack(row.order_number)}
              onDismiss={() => drop(row.order_number)}
            />
          ))}
          {pending.map((row) => (
            <CaptureCard
              key={row.order_number}
              row={row}
              canAct={alive}
              busy={busy}
              onBring={() => bring(row.order_number)}
              onCancel={() => takeBack(row.order_number)}
              onDismiss={() => drop(row.order_number)}
            />
          ))}

          {held.length > 0 && (
            <div className="pt-2">
              <button
                onClick={() => setShowHeld((v) => !v)}
                className="w-full flex items-center gap-2 text-xs font-bold text-amber-500 uppercase tracking-wide py-1"
              >
                <ChevronDown
                  size={14}
                  className={`transition-transform ${showHeld ? '' : '-rotate-90'}`}
                />
                Held ({held.length})
              </button>
              {showHeld && (
                <div className="space-y-3 mt-2">
                  {held.map((row) => (
                    <CaptureCard
                      key={row.order_number}
                      row={row}
                      canAct={alive}
                      busy={busy}
                      onBring={() => bring(row.order_number)}
                      onCancel={() => takeBack(row.order_number)}
                      onDismiss={() => drop(row.order_number)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
