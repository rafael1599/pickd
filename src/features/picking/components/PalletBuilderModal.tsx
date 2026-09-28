/**
 * Armar una tarima a mano (Rafael, 28 sep 2026: «que en el mismo double check
 * el picker pueda agregar una nueva pallet y designar las bicicletas que él
 * quiera a esa nueva pallet»).
 *
 * El picker elige cuántas de cada línea van en la tarima; lo elegido se guarda
 * en `pallet_dims[].items` y el motor (`planPallets`) la aparta primero y
 * reparte el resto alrededor — así la ven igual Double Check, Ship y el
 * carrito. Sólo bicis: las partes viajan encima de una tarima, no la forman.
 */
import React, { useMemo, useState } from 'react';
import { ModalOverlay } from '../../../components/ui/ModalOverlay';
import type { PalletItemPick } from '../../../utils/palletDims';

/** Una línea que se puede poner en la tarima. */
export interface PalletBuilderLine {
  sku: string;
  location: string | null;
  itemName?: string | null;
  /** Cuántas hay para esta tarima: las de la orden menos las de otras tarimas a mano. */
  available: number;
  isKids: boolean;
}

export interface PalletBuilderModalProps {
  /** «Pallet 6» — la posición que tendrá, o la que tiene si se está editando. */
  title: string;
  lines: PalletBuilderLine[];
  /** Lo que ya lleva, al editar una tarima a mano. */
  initial?: PalletItemPick[];
  onConfirm: (picks: PalletItemPick[]) => void;
  /** Sólo al editar: deshace la tarima y sus bicis vuelven al reparto. */
  onRemove?: () => void;
  onClose: () => void;
}

const keyOf = (sku: string, location: string | null | undefined) => `${sku}|${location ?? ''}`;

export const PalletBuilderModal: React.FC<PalletBuilderModalProps> = ({
  title,
  lines,
  initial = [],
  onConfirm,
  onRemove,
  onClose,
}) => {
  const [qty, setQty] = useState<Record<string, number>>(() => {
    const start: Record<string, number> = {};
    for (const pick of initial) start[keyOf(pick.sku, pick.location)] = pick.qty;
    return start;
  });

  const total = useMemo(() => Object.values(qty).reduce((sum, n) => sum + n, 0), [qty]);

  const set = (line: PalletBuilderLine, next: number) =>
    setQty((prev) => ({
      ...prev,
      [keyOf(line.sku, line.location)]: Math.max(0, Math.min(line.available, next)),
    }));

  const confirm = () => {
    const picks: PalletItemPick[] = lines
      .map((line) => ({
        sku: line.sku,
        location: line.location,
        qty: qty[keyOf(line.sku, line.location)] ?? 0,
      }))
      .filter((pick) => pick.qty > 0);
    onConfirm(picks);
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
          {total} <span className="text-[10px] tracking-widest text-muted">BIKES</span>
        </span>
      </div>

      <div className="p-3 space-y-2 overflow-y-auto flex-1 min-h-0">
        {lines.length === 0 && (
          <p className="text-xs text-muted text-center py-6">No bikes left to put on a pallet.</p>
        )}
        {lines.map((line) => {
          const n = qty[keyOf(line.sku, line.location)] ?? 0;
          return (
            <div
              key={keyOf(line.sku, line.location)}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${
                n > 0 ? 'border-blue-500/40 bg-blue-500/5' : 'border-subtle bg-card'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-black text-content tabular-nums">{line.sku}</span>
                  {line.isKids && (
                    <span className="text-[9px] font-black uppercase tracking-widest text-emerald-400">
                      Kids
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-muted truncate">
                  {[line.location, line.itemName].filter(Boolean).join(' · ')}
                </div>
              </div>
              <button
                type="button"
                onClick={() => set(line, n - 1)}
                disabled={n === 0}
                aria-label={`One ${line.sku} less`}
                className="h-9 w-9 rounded-lg border border-subtle text-lg font-black text-content disabled:opacity-30 active:scale-95"
              >
                –
              </button>
              <span className="w-12 text-center text-xl font-black tabular-nums text-blue-400">
                {n}
                <span className="block text-[9px] font-bold text-muted">of {line.available}</span>
              </span>
              <button
                type="button"
                onClick={() => set(line, n + 1)}
                disabled={n >= line.available}
                aria-label={`One more ${line.sku}`}
                className="h-9 w-9 rounded-lg border border-subtle text-lg font-black text-content disabled:opacity-30 active:scale-95"
              >
                +
              </button>
            </div>
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
            Remove pallet
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
          onClick={confirm}
          disabled={total === 0 && !onRemove}
          className="px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest text-white bg-blue-600 disabled:opacity-40 active:scale-95"
        >
          Save pallet
        </button>
      </div>
    </ModalOverlay>
  );
};
