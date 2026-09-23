/**
 * One SKU of the batch pile (PRD §7). Figures, not sentences: the SKU, what it
 * is, how many cartons, and where the rest of that stock already lives.
 *
 * What the operator can do here is exactly what the card needs: pick an amber
 * reading, type a red one, correct the count, delete a photo, flip BIKE/PART on
 * a SKU the catalogue does not have yet, and take the card out of the batch.
 */
import React, { useState } from 'react';
import X from 'lucide-react/dist/esm/icons/x';
import Pencil from 'lucide-react/dist/esm/icons/pencil';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import {
  cardProblem,
  cardUnits,
  effectiveIsBike,
  type BatchAction,
  type BatchCard,
  type BatchPhoto,
  type CardProblem,
} from '../utils/labelBatch';
import { displaySize } from '../../../utils/size';
import { DraftFieldRow } from './DraftFieldRow';

interface LabelBatchCardProps {
  card: BatchCard;
  photos: BatchPhoto[];
  thumbnails: Record<string, string>;
  bikes: boolean;
  dispatch: (action: BatchAction) => void;
  onRemovePhoto: (photoId: string) => void;
  onRemoveCard: (cardId: string) => void;
}

const RED: CardProblem[] = ['no_sku', 'needs_model', 'needs_size', 'no_units', 'lookup_failed'];
const AMBER: CardProblem[] = ['choose_model', 'choose_size'];

const PROBLEM_LINE: Record<CardProblem, string> = {
  no_sku: 'The label gave no SKU — type it',
  looking_up: 'Checking the catalogue…',
  lookup_failed: 'Could not check the catalogue',
  needs_model: 'New SKU — it needs a model',
  needs_size: 'New SKU — it needs a size',
  choose_model: 'Confirm the model — tap the right one',
  choose_size: 'Confirm the size — tap the right one',
  no_units: '0 units — delete the card or set a count',
};

export const LabelBatchCard: React.FC<LabelBatchCardProps> = ({
  card,
  photos,
  thumbnails,
  bikes,
  dispatch,
  onRemovePhoto,
  onRemoveCard,
}) => {
  const [skuText, setSkuText] = useState('');
  const [editingUnits, setEditingUnits] = useState(false);
  const [unitsText, setUnitsText] = useState('');
  const [editingFields, setEditingFields] = useState(false);

  const problem = cardProblem(card, photos);
  const units = cardUnits(card, photos);
  const isNew = card.catalog?.isNew ?? false;
  const isBike = effectiveIsBike(card, bikes);
  // The catalogue decides the type of a SKU it has; the label only flags a doubt
  // on one it does not (the PRD's PART chip).
  const typeConflict = isNew && card.labelSaysPart && isBike;
  const bridge =
    card.catalog && card.sku && card.catalog.canonicalSku !== card.sku
      ? `${card.sku} → ${card.catalog.canonicalSku}`
      : null;

  const tone =
    problem && RED.includes(problem)
      ? 'border-red-500/40 bg-red-500/5'
      : (problem && AMBER.includes(problem)) || units.unproven || typeConflict
        ? 'border-amber-500/40 bg-amber-500/5'
        : problem === 'looking_up'
          ? 'border-subtle bg-card'
          : 'border-emerald-500/30 bg-emerald-500/5';

  // An existing SKU is shown as the catalogue knows it; a new one as its label reads.
  const described =
    card.catalog && !isNew
      ? [
          card.catalog.model,
          displaySize(card.catalog.size, card.catalog.isBike),
          card.catalog.color,
        ]
      : [card.model.value, displaySize(card.size.value, isBike), card.color.value];
  const description = described.filter(Boolean).join(' · ');

  const commitSku = () => {
    const value = skuText.trim();
    if (!value) return;
    dispatch({ type: 'cardSkuTyped', cardId: card.id, sku: value, typed: true });
    setSkuText('');
  };

  const commitUnits = () => {
    setEditingUnits(false);
    const value = unitsText.trim();
    if (value === '') return;
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0)
      dispatch({ type: 'cardUnitsTyped', cardId: card.id, units: n });
  };

  return (
    <div className={`relative rounded-2xl border p-3 ${tone}`}>
      <button
        onClick={() => onRemoveCard(card.id)}
        aria-label="Take this card out of the batch"
        className="absolute right-1.5 top-1.5 rounded-full p-1.5 text-muted active:scale-90"
      >
        <X size={16} />
      </button>

      <div className="flex items-start justify-between gap-3 pr-7">
        <div className="min-w-0 flex-1">
          {card.sku ? (
            <div className="flex items-center gap-2">
              <span className="truncate font-mono text-base font-black text-content">
                {card.catalog?.canonicalSku ?? card.sku}
              </span>
              {isNew && (
                <span className="shrink-0 rounded-md bg-accent/15 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-accent">
                  NEW
                </span>
              )}
              {card.skuSource === 'hand' && (
                <Pencil size={12} className="shrink-0 text-muted" aria-label="Typed by hand" />
              )}
            </div>
          ) : card.skuOptions.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {card.skuOptions.map((sku) => (
                <button
                  key={sku}
                  onClick={() =>
                    dispatch({ type: 'cardSkuTyped', cardId: card.id, sku, typed: false })
                  }
                  className="rounded-full border border-amber-500/40 bg-card px-3 py-1 font-mono text-sm font-bold text-content active:scale-95"
                >
                  {sku}
                </button>
              ))}
            </div>
          ) : (
            <input
              value={skuText}
              onChange={(e) => setSkuText(e.target.value)}
              onBlur={commitSku}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitSku();
              }}
              placeholder="SKU"
              autoCapitalize="characters"
              className="w-full rounded-lg border border-red-500/40 bg-card px-2 py-1.5 font-mono text-base font-bold uppercase text-content placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          )}
          {bridge && <p className="mt-0.5 font-mono text-[11px] text-muted">{bridge}</p>}
          {(description || isNew) && (
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
              <p className="truncate text-xs font-bold uppercase text-muted">
                {description || '—'}
              </p>
              {isNew && (
                <button
                  onClick={() => setEditingFields((v) => !v)}
                  aria-label={editingFields ? 'Done editing' : 'Edit model, size and colour'}
                  className={`shrink-0 rounded p-0.5 active:scale-90 ${editingFields ? 'text-accent' : 'text-muted'}`}
                >
                  <Pencil size={12} />
                </button>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 text-right">
          {editingUnits ? (
            <input
              autoFocus
              inputMode="numeric"
              value={unitsText}
              onChange={(e) => setUnitsText(e.target.value.replace(/\D/g, ''))}
              onBlur={commitUnits}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitUnits();
              }}
              className="w-14 rounded-lg border border-subtle bg-card px-1 py-0.5 text-right text-2xl font-black text-content focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          ) : (
            <button
              onClick={() => {
                setUnitsText(String(units.units));
                setEditingUnits(true);
              }}
              aria-label="Set the count by hand"
              className="flex items-baseline gap-1 text-2xl font-black leading-none text-content active:scale-95"
            >
              {units.units}
              {units.unproven && <span className="text-sm text-amber-400">?</span>}
              {units.typed && <Pencil size={12} className="text-muted" />}
            </button>
          )}
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted">units</p>
        </div>
      </div>

      {/* A new SKU is where the label's fields matter: they become the catalogue
          row. Shown: what needs a decision (a red model or size blocks the card,
          PRD Q1; any amber). The pencil opens all three, to correct a read that
          came back green but wrong — the way `model = 'T'` got in. */}
      {isNew && (
        <div className="mt-2 space-y-1.5">
          {(['model', 'size', 'color'] as const)
            .filter(
              (key) =>
                editingFields ||
                card[key].status === 'uncertain' ||
                (key !== 'color' && card[key].status === 'missing')
            )
            .map((key) => (
              <DraftFieldRow
                key={`${key}-${editingFields ? 'edit' : 'view'}`}
                label={key}
                field={card[key]}
                render={(v) => (v ? String(v) : '—')}
                forceInput={editingFields}
                onChoose={(option) =>
                  dispatch({
                    type: 'cardFieldSet',
                    cardId: card.id,
                    field: key,
                    value: option,
                    typed: false,
                  })
                }
                onType={(text) =>
                  dispatch({
                    type: 'cardFieldSet',
                    cardId: card.id,
                    field: key,
                    value: text,
                    typed: true,
                  })
                }
              />
            ))}
        </div>
      )}

      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {card.photoIds.map((id) => (
            <div key={id} className="relative h-12 w-12 shrink-0">
              {thumbnails[id] ? (
                <img
                  src={thumbnails[id]}
                  alt=""
                  className="h-12 w-12 rounded-lg border border-subtle object-cover"
                />
              ) : (
                <div className="h-12 w-12 rounded-lg border border-subtle bg-card" />
              )}
              {units.repeatPhotoIds.includes(id) && (
                <span className="absolute bottom-0.5 left-0.5 rounded bg-black/70 px-1 text-[11px] font-black text-white">
                  =
                </span>
              )}
              <button
                onClick={() => onRemovePhoto(id)}
                aria-label="Delete this photo"
                className="absolute -right-1.5 -top-1.5 rounded-full bg-black/80 p-0.5 text-white active:scale-90"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          {isNew && (
            <button
              onClick={() => dispatch({ type: 'cardTypeToggled', cardId: card.id })}
              className={`rounded-full border px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest active:scale-95 ${
                typeConflict ? 'border-amber-500/50 text-amber-400' : 'border-subtle text-muted'
              }`}
            >
              {typeConflict ? 'PART?' : isBike ? 'BIKE' : 'PART'}
            </button>
          )}
          {card.catalog && !isNew && (
            <p className="text-[11px] font-bold uppercase text-muted">
              IN STOCK {card.catalog.existingQty}
              {card.catalog.topLocation ? ` · ${card.catalog.topLocation}` : ''}
            </p>
          )}
        </div>
      </div>

      {problem && problem !== 'looking_up' && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <p
            className={`text-[11px] font-bold ${RED.includes(problem) ? 'text-red-400' : 'text-amber-400'}`}
          >
            {PROBLEM_LINE[problem]}
            {problem === 'lookup_failed' && card.catalogError ? ` (${card.catalogError})` : ''}
          </p>
          {problem === 'lookup_failed' && (
            <button
              onClick={() => dispatch({ type: 'catalogRetry', cardId: card.id })}
              className="flex items-center gap-1 text-[11px] font-black uppercase text-content active:scale-95"
            >
              <RefreshCw size={12} /> Retry
            </button>
          )}
        </div>
      )}
      {problem === 'looking_up' && (
        <p className="mt-2 text-[11px] font-bold text-muted">{PROBLEM_LINE.looking_up}</p>
      )}
    </div>
  );
};
