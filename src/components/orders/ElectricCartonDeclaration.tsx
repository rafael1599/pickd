/**
 * "This e-bike is its own carton in Audit Source" — under the four numbers.
 *
 * Audit Source asks for a battery bike to be declared separately from the
 * pallet it rides in (idea-167). The amber ElectricBikeWarning above says
 * "mark the cartons" for the lithium label; this one says what to type: one
 * line per electric SKU with count, weight and carton size, and a copy button
 * that hands all of it over at once. Blue, not amber, because it is a data
 * entry, not a hazard step; the dot pulses only while the order is still in
 * the building (motion-safe — a reduced-motion setting turns it off).
 *
 * A missing weight or an unmeasured carton shows as an amber "?", the same
 * mark the Lbs column uses: the station sees the gap before Audit Source does.
 */
import BatteryCharging from 'lucide-react/dist/esm/icons/battery-charging';
import { CopyButton } from '../ui/CopyButton';
import {
  electricCartonClipboard,
  electricCartonParts,
  totalElectricCartonUnits,
  type ElectricCarton,
} from './electricCartons';

interface ElectricCartonDeclarationProps {
  cartons: ElectricCarton[];
  /** True while the order is not shipped yet — the dot pulses. */
  pulse: boolean;
}

const Missing: React.FC<{ title: string }> = ({ title }) => (
  <span className="text-amber-500 font-black" title={title}>
    ?
  </span>
);

export const ElectricCartonDeclaration: React.FC<ElectricCartonDeclarationProps> = ({
  cartons,
  pulse,
}) => {
  if (cartons.length === 0) return null;
  const units = totalElectricCartonUnits(cartons);
  const one = units === 1;

  return (
    <div
      role="note"
      className="w-full rounded-2xl border border-sky-500/40 border-l-4 border-l-sky-500 bg-sky-500/10 px-3 py-2.5 flex flex-col gap-2"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="relative flex shrink-0 h-2.5 w-2.5">
          {pulse && (
            <span className="absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75 motion-safe:animate-ping" />
          )}
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-sky-500" />
        </span>
        <BatteryCharging size={18} className="shrink-0 text-sky-400" />
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-tight text-sky-400">
            {units} {one ? 'e-bike' : 'e-bikes'} to declare as{' '}
            {one ? 'a separate carton' : 'separate cartons'}
          </p>
          <p className="text-[11px] font-semibold text-sky-400/70">
            Audit Source wants it as its own carton, outside the pallet — even when it rides inside
          </p>
        </div>
      </div>

      <ul className="flex flex-col gap-1.5">
        {cartons.map((carton) => {
          const parts = electricCartonParts(carton);
          return (
            <li
              key={carton.sku}
              className="flex items-center justify-between gap-3 rounded-xl bg-main/40 px-2.5 py-1.5"
            >
              <span className="min-w-0 flex flex-wrap items-baseline gap-x-2 text-xs font-mono text-content">
                <span className="font-black truncate" title={carton.sku}>
                  {parts.what}
                </span>
                <span className="text-muted">·</span>
                <span className="font-semibold">
                  {parts.weight ?? <Missing title="No weight on file for this bike" />}
                </span>
                <span className="text-muted">·</span>
                <span className="font-semibold">
                  {parts.dims ?? <Missing title="Carton not measured yet" />}
                </span>
                <span className="text-[10px] text-muted/80">{carton.sku}</span>
              </span>
              <CopyButton
                value={electricCartonClipboard(carton)}
                label={`E-bike carton ${carton.sku}`}
                size={14}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
};
