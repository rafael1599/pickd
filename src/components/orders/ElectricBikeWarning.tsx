/**
 * "This order has e-bikes in it — mark the cartons."
 *
 * Sits in the Ship card's carrier block, next to the Daylight reminder and the
 * out-of-zone PAV banner, because all three are things that have to happen
 * before the truck arrives rather than after.
 *
 * Amber rather than red: the Daylight reminder is red because the truck does
 * not roll at all until that text goes out. This one is a step in shipping the
 * order, not a blocker on it, and two identical red banners stacked on one card
 * teach the operator to read neither.
 *
 * It owns no logic of its own: which SKUs count as electric is
 * `utils/electricBikes.ts`, whether the banner shows at all is ShipOrderCard,
 * and where the manual button goes is `components/manuals/ManualLinkButton`.
 */
import BatteryWarning from 'lucide-react/dist/esm/icons/battery-warning';
import X from 'lucide-react/dist/esm/icons/x';
import { totalElectricUnits, type ElectricBikeLine } from '../../utils/electricBikes';
import { ManualLinkButton } from '../manuals/ManualLinkButton';

interface ElectricBikeWarningProps {
  /** Electric bikes on the order, one entry per SKU, units already summed. */
  lines: ElectricBikeLine[];
  /** Hide it for this order, for this session. */
  onDismiss: () => void;
}

export const ElectricBikeWarning: React.FC<ElectricBikeWarningProps> = ({ lines, onDismiss }) => {
  if (lines.length === 0) return null;

  const units = totalElectricUnits(lines);

  return (
    <div
      role="alert"
      className="flex flex-col gap-2 px-3 py-2.5 bg-amber-500/10 border border-amber-500/40 rounded-2xl w-full"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="relative flex shrink-0 h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75 animate-ping" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-600" />
          </span>
          <BatteryWarning size={18} className="shrink-0 text-amber-500" />
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-tight text-amber-500">
              Lithium battery label &mdash; {units} {units === 1 ? 'e-bike' : 'e-bikes'}
            </p>
            <p className="text-[11px] font-semibold text-amber-500/70">
              Mark the cartons before the carrier takes them
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onDismiss}
          title="Close warning"
          aria-label="Close warning"
          className="shrink-0 p-1 rounded-lg text-muted hover:text-content hover:bg-subtle transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* The SKUs are the actionable half: which boxes on the pallet to mark.
          Names truncate, SKUs never do — the label goes on by SKU. The manual
          button rides the same row so it reads as part of the instruction
          rather than as a second thing to decide about. */}
      <div className="flex flex-wrap items-center gap-1.5 pl-[26px]">
        <ManualLinkButton slug="fedex-hazmat-ebikes" label="How to ship e-bikes" tone="amber" />
        {lines.map((line) => (
          <span
            key={line.sku}
            title={line.name ?? undefined}
            className="inline-flex items-center gap-1.5 max-w-full px-2 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30"
          >
            <span className="text-[11px] font-black tracking-tight text-amber-600 shrink-0">
              {line.sku}
            </span>
            {line.name && (
              <span className="text-[10px] font-semibold text-amber-600/70 truncate">
                {line.name}
              </span>
            )}
            <span className="text-[10px] font-black text-amber-600 shrink-0">
              &times;{line.units}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
};
