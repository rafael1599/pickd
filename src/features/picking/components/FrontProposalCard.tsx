/**
 * Lo que vio una foto del frente de una tarima, bajo esa tarima en Double Check
 * (idea-245, F1; `docs/prds/pallet-box-inference.md` §4 y §7).
 *
 * La foto ya se guardó en la tarima cuando se pudo (`applied`): es lo más nuevo
 * que se sabe de ella (Rafael, 2 oct 2026). La tarjeta dice qué cambió y deja
 * contestar lo único que la foto no puede saber — si las cajas que no se ven
 * están —. Sin botones de confirmar: el lápiz de siempre corrige lo demás.
 *
 * - Niveles de arriba abajo, como se ve la tarima; ▬ = acostada.
 * - `+ SKU from #3`: la foto la trajo de otra tarima.
 * - `? SKU [✓] [✗]`: estaba y no se ve (strap, otra caja, etiqueta al otro lado).
 * - Sin tarima segura (empate o nada en común) pide elegirla; si alguien editó
 *   esa tarima después de la foto, la foto no pisa la edición y ofrece APPLY.
 */
import Camera from 'lucide-react/dist/esm/icons/camera';
import Check from 'lucide-react/dist/esm/icons/check';
import X from 'lucide-react/dist/esm/icons/x';
import type { FrontBox } from '../pallets/frontRead';
import type { FrontCase } from '../pallets/frontApply';

export interface FrontCardMissing {
  sku: string;
  location: string | null;
  answer?: 'present' | 'absent';
}

export interface FrontCardModel {
  id: string;
  photoId: string;
  takenAt: number;
  frontCase: FrontCase;
  /** La tarima, o `null` mientras el picker no la elija. */
  pallet: number | null;
  candidates: number[];
  boxes: FrontBox[];
  moved: { sku: string; fromLabel: string }[];
  missing: FrontCardMissing[];
  notInOrder: number;
  /** Los SKUs leídos que no son de la orden, para nombrarlos (#881828). */
  notInOrderSkus?: string[];
  applied: boolean;
}

interface Props {
  card: FrontCardModel;
  /** «#3» de una tarima, como la enseña la pantalla. */
  labelOf: (pallet: number) => string;
  /** Las tarimas que se pueden elegir cuando la foto no sabe cuál es. */
  choices: number[];
  canEdit: boolean;
  onChoose: (pallet: number) => void;
  onApply: () => void;
  onAnswer: (index: number, present: boolean) => void;
  onDismiss: () => void;
}

const time = (ms: number) =>
  new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

export function FrontProposalCard({
  card,
  labelOf,
  choices,
  canEdit,
  onChoose,
  onApply,
  onAnswer,
  onDismiss,
}: Props) {
  const levels = [
    ...new Set(card.boxes.filter((b) => b.level != null).map((b) => b.level as number)),
  ].sort((a, b) => b - a);
  const flat = card.boxes.filter((b) => b.level == null);
  const waiting = card.pallet == null;
  const tone = waiting || !card.applied ? 'border-amber-500/40' : 'border-emerald-500/40';

  return (
    <div className={`mb-3 rounded-xl border ${tone} bg-card/60 px-3 py-2 text-xs`}>
      <div className="flex items-center gap-2">
        <Camera size={12} className="shrink-0 text-muted" />
        <span className="font-black uppercase tracking-widest text-muted">
          Front {time(card.takenAt)}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Hide"
          className="p-1 text-muted/60 active:scale-95"
        >
          <X size={12} />
        </button>
      </div>

      {waiting && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="font-black uppercase tracking-widest text-amber-400">Pallet ?</span>
          {choices.map((p) => (
            <button
              key={p}
              type="button"
              disabled={!canEdit}
              onClick={() => onChoose(p)}
              className="rounded-full border border-amber-500/40 px-2.5 py-1 font-black text-amber-300 active:scale-95 disabled:opacity-40"
            >
              {labelOf(p)}
            </button>
          ))}
        </div>
      )}

      <div className="mt-1.5 flex flex-col gap-1 font-mono">
        {flat.length > 0 && (
          <div className="flex flex-wrap gap-x-3">
            <span className="w-4 shrink-0 text-muted">▬</span>
            {flat.map((b, i) => (
              <span key={`f${i}`} className="whitespace-nowrap">
                {b.sku}
              </span>
            ))}
          </div>
        )}
        {levels.map((lv) => (
          <div key={lv} className="flex flex-wrap gap-x-3">
            <span className="w-4 shrink-0 text-muted">{lv + 1}</span>
            {card.boxes
              .filter((b) => b.level === lv)
              .map((b, i) => (
                <span key={i} className="whitespace-nowrap">
                  {b.sku}
                </span>
              ))}
          </div>
        ))}
      </div>

      {!waiting && card.moved.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-0.5 font-mono text-sky-300">
          {card.moved.map((m, i) => (
            <span key={i} className="whitespace-nowrap">
              + {m.sku} <span className="text-muted">from {m.fromLabel}</span>
            </span>
          ))}
        </div>
      )}

      {!waiting && card.applied && card.missing.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1">
          {card.missing.map((m, i) => (
            <div key={i} className="flex items-center gap-2 font-mono">
              <span
                className={`flex-1 whitespace-nowrap ${
                  m.answer === 'absent'
                    ? 'text-muted line-through'
                    : m.answer === 'present'
                      ? 'text-content'
                      : 'text-amber-400'
                }`}
              >
                ? {m.sku}
              </span>
              {m.answer == null && canEdit && (
                <>
                  <button
                    type="button"
                    onClick={() => onAnswer(i, true)}
                    aria-label={`${m.sku} is on this pallet`}
                    className="rounded-md border border-emerald-500/40 p-1 text-emerald-400 active:scale-95"
                  >
                    <Check size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onAnswer(i, false)}
                    aria-label={`${m.sku} is not on this pallet`}
                    className="rounded-md border border-red-500/40 p-1 text-red-400 active:scale-95"
                  >
                    <X size={12} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {card.notInOrder > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className="font-black uppercase tracking-widest text-red-400">
            Not in order {card.notInOrder}
          </span>
          {[...new Set(card.notInOrderSkus ?? [])].map((sku) => {
            const n = (card.notInOrderSkus ?? []).filter((s) => s === sku).length;
            return (
              <span key={sku} className="whitespace-nowrap font-mono text-red-300">
                {sku}
                {n > 1 ? ` ×${n}` : ''}
              </span>
            );
          })}
        </div>
      )}

      {!waiting && !card.applied && canEdit && (
        <button
          type="button"
          onClick={onApply}
          className="mt-2 w-full rounded-lg border border-amber-500/40 py-1.5 font-black uppercase tracking-widest text-amber-300 active:scale-95"
        >
          Apply
        </button>
      )}
    </div>
  );
}
