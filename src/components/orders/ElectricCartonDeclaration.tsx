/**
 * The e-bike's own carton, in the language of the four big numbers.
 *
 * Audit Source asks for a battery bike to be declared separately from the
 * pallet it rides in (idea-167). Rafael, 2026-08-27: the station does not
 * want a sentence, it wants what it types — "1 carton, 1 Hudson E1, 78.6
 * lbs" — so this is one row of figures per electric SKU, styled like Pallets
 * / Bikes / Parts / Weight above it and one size smaller so those four stay
 * the loudest. A FedEx order adds the carton size in the same shape; a
 * regular one does not need it. The dot pulses until the order ships
 * (motion-safe). A missing weight or an unmeasured carton is an amber "?",
 * the same mark the Lbs column uses.
 *
 * The amber ElectricBikeWarning above is the lithium label ("mark the
 * cartons"); this is the data entry. Both stay.
 */
import { CopyButton } from '../ui/CopyButton';
import {
  electricCartonClipboard,
  formatCartonDims,
  formatLbs,
  type ElectricCarton,
} from './electricCartons';

interface ElectricCartonDeclarationProps {
  cartons: ElectricCarton[];
  /** True while the order is not shipped yet — the dot pulses. */
  pulse: boolean;
  /** FedEx wants the carton size; Audit Source does not. */
  showDims: boolean;
}

const Figure: React.FC<{
  value: string | number;
  label: string;
  title?: string;
  missing?: boolean;
  small?: boolean;
}> = ({ value, label, title, missing = false, small = false }) => (
  <div className="flex flex-col gap-1 min-w-0" title={title}>
    <span
      className={`font-heading font-bold leading-none ${small ? 'text-3xl' : 'text-5xl'} ${
        missing ? 'text-amber-500' : 'text-sky-400'
      }`}
    >
      {value}
    </span>
    <span className="text-[10px] font-black uppercase tracking-widest text-muted truncate">
      {label}
    </span>
  </div>
);

export const ElectricCartonDeclaration: React.FC<ElectricCartonDeclarationProps> = ({
  cartons,
  pulse,
  showDims,
}) => {
  if (cartons.length === 0) return null;

  return (
    <div
      role="note"
      className="w-full pt-4 border-t border-dashed border-subtle flex flex-col gap-4"
    >
      <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-sky-400">
        <span className="relative flex shrink-0 h-2 w-2">
          {pulse && (
            <span className="absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75 motion-safe:animate-ping" />
          )}
          <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-500" />
        </span>
        E-bike — own carton
      </span>

      {cartons.map((carton) => (
        <div key={carton.sku} className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <Figure value={carton.units} label={carton.units === 1 ? 'Carton' : 'Cartons'} />
          <Figure value={carton.units} label={carton.model} title={carton.name ?? carton.sku} />
          <Figure
            value={carton.weightLbs == null ? '?' : formatLbs(carton.weightLbs)}
            label={carton.units === 1 ? 'Lbs' : 'Lbs each'}
            missing={carton.weightLbs == null}
            title={carton.weightLbs == null ? 'No weight on file for this bike' : undefined}
          />
          {showDims && (
            <Figure
              value={carton.dims ? formatCartonDims(carton.dims) : '?'}
              label="In"
              small
              missing={!carton.dims}
              title={
                carton.dims
                  ? 'Carton, whole inches rounded up (L × H × W)'
                  : 'Carton not measured yet'
              }
            />
          )}
          <div className="pb-4">
            <CopyButton
              value={electricCartonClipboard(carton, showDims)}
              label={`E-bike carton ${carton.sku}`}
            />
          </div>
        </div>
      ))}
    </div>
  );
};
