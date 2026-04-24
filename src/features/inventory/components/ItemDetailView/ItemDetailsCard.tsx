import { useState } from 'react';
import Pencil from 'lucide-react/dist/esm/icons/pencil';
import Check from 'lucide-react/dist/esm/icons/check';
import X from 'lucide-react/dist/esm/icons/x';
import ExternalLink from 'lucide-react/dist/esm/icons/external-link';
import { useScratchAndDentBySku } from '../../../scratch-and-dent/hooks/useScratchAndDentCatalog';

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  available: {
    label: 'Available',
    className: 'bg-green-500/10 text-green-500 border-green-500/30',
  },
  reserved: { label: 'Reserved', className: 'bg-amber-500/10 text-amber-500 border-amber-500/30' },
  sold: { label: 'Sold', className: 'bg-neutral-600/20 text-muted border-neutral-600/40' },
  transferred: {
    label: 'Transferred',
    className: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  },
  retired: { label: 'Retired', className: 'bg-red-500/10 text-red-400 border-red-500/30' },
};

const CONDITION_LABEL_LEGACY: Record<string, string> = {
  new_unbuilt: 'New (Unbuilt)',
  new_built: 'New (Built)',
  ridden_demo: 'Ridden / Demo',
  returned: 'Returned',
  defective_frame: 'Defective Frame',
};

const CONDITION_OPTIONS = [
  { value: 'new', label: 'New' },
  { value: 'used', label: 'Used' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'refurbished', label: 'Refurbished' },
];

const prettyCondition = (v: string | null | undefined) => {
  if (!v) return '—';
  if (CONDITION_LABEL_LEGACY[v]) return CONDITION_LABEL_LEGACY[v];
  return v.charAt(0).toUpperCase() + v.slice(1);
};

const formatPrice = (n: number | null | undefined) =>
  typeof n === 'number'
    ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
    : '—';

/** Some Excel rows store the link as "www.dropbox.com/..." without the scheme. */
const normalizeHref = (link: string) =>
  /^https?:\/\//i.test(link) ? link : `https://${link.replace(/^\/+/, '')}`;

interface Props {
  sku: string;
  isScratchDent: boolean;
  // Form values (controlled by parent)
  serial: string;
  price: number | null;
  condition: string;
  conditionDescription: string;
  pdfLink: string;
  // Setters — parent owns state
  setSerial: (v: string) => void;
  setPrice: (v: number | null) => void;
  setCondition: (v: string) => void;
  setConditionDescription: (v: string) => void;
  setPdfLink: (v: string) => void;
}

/**
 * Universal item details card — pretty read view + inline edit mode.
 *
 * Read mode: grid of populated fields (serial, price, condition, notes, PDF).
 * Edit mode: same layout, inputs in place. Values are controlled by the parent
 * form so changes are tracked by the main dirty-check and persisted on the
 * parent's Save.
 *
 * For S/D units (is_scratch_dent=true) we additionally read bike_variants /
 * products via useScratchAndDentBySku and render Model / Size/Color / Status
 * read-only. Those live in a separate relational model; deeper editing of
 * catalog structure is out of scope for this card.
 */
export function ItemDetailsCard({
  sku,
  isScratchDent,
  serial,
  price,
  condition,
  conditionDescription,
  pdfLink,
  setSerial,
  setPrice,
  setCondition,
  setConditionDescription,
  setPdfLink,
}: Props) {
  const [isEditing, setIsEditing] = useState(false);
  // Snapshot taken when entering edit mode so Cancel can revert without
  // touching the parent dirty-check more than necessary.
  const [snapshot, setSnapshot] = useState<{
    serial: string;
    price: number | null;
    condition: string;
    conditionDescription: string;
    pdfLink: string;
  } | null>(null);

  // S/D catalog data — only fetched when is_scratch_dent (the hook internally
  // short-circuits on a null sku, but passing null is still the cleaner path).
  const { data: sdUnit } = useScratchAndDentBySku(isScratchDent ? sku : null);

  const variant = sdUnit?.bike_variants ?? null;
  const product = variant?.products ?? null;
  const status = sdUnit?.status ? (STATUS_BADGE[sdUnit.status] ?? STATUS_BADGE.available) : null;

  const startEdit = () => {
    setSnapshot({
      serial,
      price,
      condition,
      conditionDescription,
      pdfLink,
    });
    setIsEditing(true);
  };

  const cancelEdit = () => {
    if (snapshot) {
      setSerial(snapshot.serial);
      setPrice(snapshot.price);
      setCondition(snapshot.condition);
      setConditionDescription(snapshot.conditionDescription);
      setPdfLink(snapshot.pdfLink);
    }
    setIsEditing(false);
    setSnapshot(null);
  };

  const confirmEdit = () => {
    // Values are already in parent state via setters. Just exit edit mode;
    // persistence happens on the parent's main Save.
    setIsEditing(false);
    setSnapshot(null);
  };

  const hasAnyValue =
    !!serial || price != null || !!condition || !!conditionDescription || !!pdfLink || !!sdUnit;

  if (!isEditing && !hasAnyValue) {
    return (
      <div className="px-4 py-3 border-b border-subtle">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-black text-muted uppercase tracking-widest">
            Details
          </span>
          <button
            type="button"
            onClick={startEdit}
            className="px-3 py-1 rounded-lg text-[10px] font-bold bg-accent text-white active:scale-95 transition-all"
          >
            Add details
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 border-b border-subtle space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-black text-muted uppercase tracking-widest">
            {isScratchDent ? 'S/D' : 'Details'}
          </span>
          {status && (
            <span
              className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border ${status.className}`}
            >
              {status.label}
            </span>
          )}
          {sdUnit && (
            <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full bg-surface text-content border border-subtle">
              {sdUnit.category === 'demo' ? 'DEMO' : 'S/D'}
            </span>
          )}
        </div>
        {isEditing ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={cancelEdit}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold text-muted hover:text-content active:scale-95 transition-all"
            >
              <X size={11} />
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmEdit}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-accent/20 text-accent hover:bg-accent/30 active:scale-95 transition-all"
            >
              <Check size={11} />
              Done
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={startEdit}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold text-muted hover:text-content active:scale-95 transition-all"
          >
            <Pencil size={11} />
            Edit
          </button>
        )}
      </div>

      {/* Bike-catalog fields — read-only, only for S/D items */}
      {sdUnit && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
          <ReadCell label="Model" value={product?.product_name ?? '—'} />
          <ReadCell
            label="Size / Color"
            value={[variant?.size, variant?.color].filter(Boolean).join(' · ') || '—'}
          />
        </div>
      )}

      {/* Universal fields — serial + condition (editable) */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
        <div>
          <div className="text-[9px] uppercase tracking-wider text-muted">Serial</div>
          {isEditing ? (
            <input
              type="text"
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              placeholder="Optional"
              className="card-input font-mono text-[10.5px]"
            />
          ) : (
            <div className="font-mono text-[10.5px] text-content">{serial || '—'}</div>
          )}
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-wider text-muted">Condition</div>
          {isEditing ? (
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              className="card-input"
            >
              <option value="">—</option>
              {CONDITION_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
              {condition && !CONDITION_OPTIONS.some((c) => c.value === condition) && (
                <option value={condition}>{prettyCondition(condition)} (legacy)</option>
              )}
            </select>
          ) : (
            <div className="font-medium text-content">{prettyCondition(condition)}</div>
          )}
        </div>
      </div>

      {/* Notes */}
      {(isEditing || conditionDescription) && (
        <div>
          <div className="text-[9px] uppercase tracking-wider text-muted">Notes</div>
          {isEditing ? (
            <textarea
              value={conditionDescription}
              onChange={(e) => setConditionDescription(e.target.value)}
              rows={2}
              placeholder="Optional description"
              className="card-input resize-none"
            />
          ) : (
            <div className="text-[11px] text-content leading-snug">{conditionDescription}</div>
          )}
        </div>
      )}

      {/* Pricing row — editable "Price"; S/D shows the trio read-only */}
      <div className="flex items-baseline gap-3 flex-wrap">
        <div>
          <div className="text-[9px] uppercase tracking-wider text-muted">
            {isScratchDent ? 'S/D price' : 'Price'}
          </div>
          {isEditing ? (
            <div className="relative inline-block">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted text-xs pointer-events-none">
                $
              </span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={price ?? ''}
                onChange={(e) => setPrice(e.target.value === '' ? null : Number(e.target.value))}
                placeholder="0.00"
                className="card-input pl-7 w-32"
              />
            </div>
          ) : (
            <div className="text-base font-black text-accent">{formatPrice(price)}</div>
          )}
        </div>
        {/* Read-only S/D catalog prices (Standard / MSRP) */}
        {!isEditing && variant?.standard_price != null && (
          <div>
            <div className="text-[9px] uppercase tracking-wider text-muted">Standard</div>
            <div className="text-[11px] line-through text-muted">
              {formatPrice(variant.standard_price)}
            </div>
          </div>
        )}
        {!isEditing && variant?.msrp != null && (
          <div>
            <div className="text-[9px] uppercase tracking-wider text-muted">MSRP</div>
            <div className="text-[11px] line-through text-muted">{formatPrice(variant.msrp)}</div>
          </div>
        )}
      </div>

      {/* PDF link — in read mode it's a button; in edit mode it's a text input */}
      {isEditing ? (
        <div>
          <div className="text-[9px] uppercase tracking-wider text-muted">PDF link</div>
          <input
            type="text"
            value={pdfLink}
            onChange={(e) => setPdfLink(e.target.value)}
            placeholder="https://…"
            className="card-input"
          />
        </div>
      ) : (
        pdfLink && (
          <a
            href={normalizeHref(pdfLink)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-surface text-accent border border-subtle hover:border-accent/50 active:scale-95 transition-all"
          >
            <ExternalLink size={12} />
            {isScratchDent ? 'View photos PDF' : 'Open document'}
          </a>
        )
      )}

      <style>{`
        .card-input {
          width: 100%;
          padding: 0.35rem 0.5rem;
          border-radius: 0.4rem;
          background-color: rgba(0,0,0,0.25);
          border: 1px solid rgba(255,255,255,0.1);
          font-size: 11px;
          color: var(--color-content, #fff);
          outline: none;
          margin-top: 2px;
        }
        .card-input:focus { border-color: var(--accent, #f59e0b); }
      `}</style>
    </div>
  );
}

function ReadCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-muted">{label}</div>
      <div className="font-medium text-content">{value}</div>
    </div>
  );
}
