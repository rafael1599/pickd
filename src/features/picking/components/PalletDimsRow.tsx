/**
 * Cuánto mide este pallet — tres campos junto al botón de la foto.
 *
 * El operador acaba de envolverlo y lo tiene delante: es el único momento en
 * que alguien puede medirlo. Lo que teclea aquí lo lee la estación en Ship y lo
 * pasa al portal del carrier (`docs/prds/ship-pallet-dimensions.md`).
 *
 * **No parte de campos vacíos.** Debajo, en gris, va la medida calculada del
 * armado real (`estimatePallet`), así que teclear es corregir. La cifra
 * calculada va como `placeholder` y **nunca** como `value`: prellenar-y-guardar
 * es lo que declaró a FedEx cartones que nadie midió, y por eso existe
 * `dimensions_verified`. Un campo vacío significa «nadie lo midió», que es un
 * hecho que hay que poder guardar.
 */
import { useState } from 'react';
import {
  dimensionSource,
  isStale,
  sanitizeInches,
  type PalletDimsEntry,
  type PalletEstimate,
} from '../../../utils/palletDims';

type Axis = 'length_in' | 'width_in' | 'height_in';

interface PalletDimsRowProps {
  palletId: number;
  /** Cajas declaradas ahora mismo — la huella con la que se sella la medida. */
  boxes: number;
  estimate: PalletEstimate | null;
  entry?: PalletDimsEntry;
  disabled?: boolean;
  onChange: (axis: Axis, value: number | null) => void;
}

const AXES: { axis: Axis; label: string; of: (e: PalletEstimate) => number }[] = [
  { axis: 'length_in', label: 'L', of: (e) => e.length },
  { axis: 'width_in', label: 'W', of: (e) => e.width },
  { axis: 'height_in', label: 'H', of: (e) => e.height },
];

export const PalletDimsRow: React.FC<PalletDimsRowProps> = ({
  palletId,
  boxes,
  estimate,
  entry,
  disabled = false,
  onChange,
}) => {
  /**
   * Lo tecleado **mientras** se teclea, y nada más: fuera del foco el campo lee
   * la fila guardada. Así no hay dos verdades que sincronizar — un efecto que
   * resembrara el borrador se pisaría con lo que llega por realtime y encadena
   * renders.
   */
  const [typing, setTyping] = useState<{ axis: Axis; text: string } | null>(null);

  const saved = (axis: Axis): string => {
    const value = entry?.[axis];
    return value != null ? String(value) : '';
  };
  const shown = (axis: Axis): string => (typing?.axis === axis ? typing.text : saved(axis));

  const source = dimensionSource(entry);
  const stale = isStale(entry, boxes);

  const commit = (axis: Axis, raw: string) => {
    // Lo que no es una medida usable no se guarda, y el campo vuelve a enseñar
    // lo que hay en la fila en vez de quedarse con un número que nadie aceptó.
    const value = sanitizeInches(raw);
    setTyping(null);
    if (value !== (entry?.[axis] ?? null)) onChange(axis, value);
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-[10px] font-black uppercase tracking-widest text-muted/70 shrink-0">
        Size
      </span>

      {AXES.map(({ axis, label, of }, i) => (
        <div key={axis} className="flex items-center gap-2 shrink-0">
          {i > 0 && <span className="text-muted/40 text-xs font-bold">×</span>}
          <div className="relative">
            <input
              type="text"
              inputMode="decimal"
              disabled={disabled}
              aria-label={`Pallet ${palletId} ${label}`}
              value={shown(axis)}
              placeholder={estimate ? String(Math.ceil(of(estimate))) : '—'}
              onChange={(e) => setTyping({ axis, text: e.target.value })}
              onBlur={(e) => commit(axis, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              className={`w-14 rounded-lg border px-1.5 py-1 text-center text-[13px] font-black tabular-nums bg-card focus:outline-none disabled:opacity-50 ${
                shown(axis)
                  ? stale
                    ? 'border-amber-500/50 text-amber-400'
                    : 'border-emerald-500/40 text-emerald-400'
                  : 'border-subtle text-muted placeholder:text-muted/50'
              }`}
            />
            <span className="absolute -top-1.5 left-1.5 px-1 bg-main text-[8px] font-black uppercase tracking-widest text-muted/60">
              {label}
            </span>
          </div>
        </div>
      ))}

      <span className="text-[10px] font-black uppercase tracking-widest text-muted/70 shrink-0">
        In
      </span>

      {/* De qué está hecha la cifra de al lado: el armado, el peso, y lo que
          falta por medir. Se dice, no se esconde. */}
      {estimate && (
        <span className="text-[10px] font-bold text-muted/60 tabular-nums ml-auto text-right leading-tight">
          {source === 'computed' ? 'Est.' : source === 'partial' ? 'Part. est.' : 'Measured'} ·{' '}
          {Math.round(estimate.weightLbs)} lbs
          {estimate.unmeasured > 0 && (
            <span className="text-amber-500">
              {' '}
              · {estimate.unmeasured} of {estimate.boxes} box
              {estimate.boxes === 1 ? '' : 'es'} unmeasured
            </span>
          )}
          {stale && <span className="text-amber-500"> · measured at {entry?.units} boxes</span>}
        </span>
      )}
    </div>
  );
};
