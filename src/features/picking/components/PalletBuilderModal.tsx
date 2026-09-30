/**
 * Armar una tarima a mano, o cambiar la que ya hay: la lista de las bicis de la
 * orden, una fila por caja, con marcadas las que van en esta tarima.
 *
 * Rafael, 28 sep 2026: «que el picker pueda agregar una nueva pallet y designar
 * las bicicletas que él quiera»; 29 sep 2026: «una lista simple de SKUs cuando
 * da click en un botón de edit de una pallet, para ver los que están
 * seleccionados para esa pallet específica, pudiendo deseleccionarlos y
 * seleccionar otros de la misma orden». Un toque marca o desmarca; lo que está
 * en otra tarima dice en cuál, y marcarlo lo trae aquí.
 *
 * Lo mismo en Double Check y en Ship: qué se escribe lo decide
 * `applyPalletSelection` (`pallets/palletUnits.ts`), que el que abre el modal
 * llama con lo que éste devuelve. Sólo bicis: las partes viajan encima de una
 * tarima, no la forman.
 */
import React, { useMemo, useState } from 'react';
import Check from 'lucide-react/dist/esm/icons/check';
import { ModalOverlay } from '../../../components/ui/ModalOverlay';
import type { PalletUnit } from '../pallets/palletUnits';

export interface PalletBuilderModalProps {
  /** «Pallet 3» — la posición que tiene, o «New pallet 6». */
  title: string;
  /** Todas las cajas de la orden, cada una en la tarima donde está ahora. */
  units: PalletUnit[];
  /** El ordinal de la tarima que se arma (`pallet.id`). */
  target: number;
  onSave: (selected: PalletUnit[]) => void;
  /** Sólo si ya estaba armada a mano: deshace la tarima y sus bicis vuelven al reparto. */
  onRemove?: () => void;
  onClose: () => void;
}

export const PalletBuilderModal: React.FC<PalletBuilderModalProps> = ({
  title,
  units,
  target,
  onSave,
  onRemove,
  onClose,
}) => {
  const [picked, setPicked] = useState<Set<number>>(
    () => new Set(units.flatMap((u, i) => (u.fromPallet === target ? [i] : [])))
  );

  // Las de esta tarima primero, después el resto; dentro, por SKU, para que
  // las cajas iguales queden juntas.
  const order = useMemo(
    () =>
      units
        .map((u, i) => ({ u, i }))
        .sort(
          (a, b) =>
            Number(b.u.fromPallet === target) - Number(a.u.fromPallet === target) ||
            a.u.sku.localeCompare(b.u.sku) ||
            a.i - b.i
        ),
    [units, target]
  );

  const toggle = (i: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const save = () => {
    onSave(units.filter((_, i) => picked.has(i)));
    onClose();
  };

  return (
    <ModalOverlay
      onClose={onClose}
      maxWidth="md"
      zIndex={250}
      className="p-0 overflow-hidden flex flex-col max-h-[calc(100dvh-2rem)]"
    >
      <div className="p-4 border-b border-subtle flex items-center justify-between gap-3 shrink-0">
        <h3 className="text-sm font-black uppercase tracking-[0.2em] text-content">{title}</h3>
        <span className="text-2xl font-black tabular-nums text-blue-400">
          {picked.size} <span className="text-[10px] tracking-widest text-muted">BIKES</span>
        </span>
      </div>

      <div className="p-2 overflow-y-auto flex-1 min-h-0">
        {units.length === 0 && (
          <p className="text-xs text-muted text-center py-6">No bikes on this order.</p>
        )}
        {order.map(({ u, i }) => {
          const on = picked.has(i);
          const here = u.fromPallet === target;
          return (
            <button
              key={i}
              type="button"
              onClick={() => toggle(i)}
              aria-pressed={on}
              className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                on ? 'bg-blue-500/10' : 'hover:bg-content/5'
              }`}
            >
              <span
                className={`h-6 w-6 shrink-0 rounded-md border flex items-center justify-center ${
                  on ? 'bg-blue-500 border-blue-500 text-white' : 'border-subtle'
                }`}
              >
                {on && <Check size={14} strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="font-black text-content tabular-nums">{u.sku}</span>
                  {u.isKids && (
                    <span className="text-[9px] font-black uppercase tracking-widest text-emerald-400">
                      Kids
                    </span>
                  )}
                </span>
                <span className="block text-[11px] text-muted truncate">
                  {[u.itemName, u.location].filter(Boolean).join(' · ')}
                </span>
              </span>
              {!here && (
                <span
                  className={`shrink-0 text-[10px] font-black uppercase tracking-widest tabular-nums ${
                    on ? 'text-blue-400' : 'text-muted'
                  }`}
                >
                  {on ? `from ${u.fromLabel}` : `on ${u.fromLabel}`}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="p-3 border-t border-subtle flex items-center gap-2 shrink-0">
        {onRemove && (
          <button
            type="button"
            onClick={() => {
              onRemove();
              onClose();
            }}
            className="px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest text-red-400 border border-red-500/30 active:scale-95"
          >
            Back to auto
          </button>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-widest text-muted"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          className="px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest text-white bg-blue-600 active:scale-95"
        >
          Save pallet
        </button>
      </div>
    </ModalOverlay>
  );
};
