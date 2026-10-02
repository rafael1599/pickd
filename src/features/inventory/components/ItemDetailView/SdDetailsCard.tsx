/**
 * What a S/D unit is sold with, beyond its name and serial: the kind of bike,
 * its condition and what's wrong with it, the three prices and the spec sheet.
 * Shown only while the S/D switch is on; the values live on sku_metadata.
 *
 * S/D price stays in Product Information (it is the item's price for any item);
 * this card holds everything else.
 */
import React from 'react';

// Same lists as the S/D catalogue editor (scratch-and-dent feature). Copied, not
// imported — features don't import each other. If one changes, change the other.
export const SD_CATEGORY_OPTIONS = [
  'mountain',
  'gravel',
  'road',
  'cruiser',
  'urban',
  'hybrid',
  'kids',
  'parts',
  'other',
] as const;

export const SD_CONDITION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'new_unbuilt', label: 'New · unbuilt' },
  { value: 'new_built', label: 'New · built' },
  { value: 'ridden_demo', label: 'Ridden / demo' },
  { value: 'returned', label: 'Returned' },
  { value: 'defective_frame', label: 'Defective frame' },
];

// Whether it can be sold (sku_metadata.sd_for_sale, 20261002155859). A notice
// for the S/D Excel and Sheet; it blocks nothing. A bike that becomes S/D starts
// at not_yet. Same list as sd_sheet_options() (labels) — change both.
export const SD_FOR_SALE_OPTIONS: Array<{ value: string; label: string; on: string }> = [
  { value: 'yes', label: 'Yes', on: 'bg-emerald-500/20 border-emerald-500/50 text-emerald-200' },
  { value: 'not_yet', label: 'Not yet', on: 'bg-amber-500/20 border-amber-500/50 text-amber-200' },
  { value: 'no', label: 'No', on: 'bg-red-500/20 border-red-500/50 text-red-200' },
];

// A value already stored that the lists don't know (legacy `used`, `new`) is
// offered too, so opening the card never hides or drops it.
const withCurrent = <T extends { value: string; label: string }>(opts: T[], current: string) =>
  current && !opts.some((o) => o.value === current)
    ? [...opts, { value: current, label: current } as T]
    : opts;

export interface SdDetailsValues {
  category: string;
  condition: string;
  conditionDescription: string;
  forSale: string;
  msrp: number | null;
  standardPrice: number | null;
  pdfLink: string;
}

interface Props {
  values: SdDetailsValues;
  isEditing: boolean;
  onChange: <K extends keyof SdDetailsValues>(key: K, value: SdDetailsValues[K]) => void;
}

const inputClass =
  'bg-[#0F1115] border border-[#2A2F36] rounded-lg px-2.5 py-1 text-white text-xs font-medium focus:outline-none focus:border-emerald-500/40';
const labelClass = 'text-white/40 text-xs font-medium uppercase tracking-wider';

const toNumber = (raw: string) => (raw.trim() === '' ? null : Number(raw));

export const SdDetailsCard: React.FC<Props> = ({ values, isEditing, onChange }) => {
  const categories = withCurrent(
    SD_CATEGORY_OPTIONS.map((c) => ({ value: c, label: c })),
    values.category
  );
  const conditions = withCurrent(SD_CONDITION_OPTIONS, values.condition);

  const money = (key: 'msrp' | 'standardPrice', label: string) => {
    const v = values[key];
    return (
      <div className="flex items-center justify-between py-1 border-t border-[#2A2F36]/50">
        <span className={labelClass}>{label}</span>
        {isEditing || v == null ? (
          <input
            id={`sd-${key}`}
            type="number"
            inputMode="decimal"
            value={v ?? ''}
            onChange={(e) => onChange(key, toNumber(e.target.value))}
            placeholder="0.00"
            className={`${inputClass} text-right w-32`}
          />
        ) : (
          <span className="text-white font-medium font-mono">${v.toFixed(2)}</span>
        )}
      </div>
    );
  };

  return (
    <div className="bg-[#161920] border border-amber-500/30 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between border-b border-[#2A2F36] pb-3">
        <h2 className="text-sm font-semibold text-amber-300 uppercase tracking-wider">
          S/D details
        </h2>
      </div>

      <div className="space-y-3 text-sm">
        <div className="flex items-center justify-between gap-3 py-1">
          <span className={labelClass}>For sale</span>
          <div className="flex gap-1.5">
            {SD_FOR_SALE_OPTIONS.map((o) => {
              // Empty only on a bike being registered: it starts at Not yet.
              const on = (values.forSale || 'not_yet') === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={on}
                  disabled={!isEditing && !on}
                  onClick={() => onChange('forSale', o.value)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                    on ? o.on : 'bg-[#0F1115] border-[#2A2F36] text-white/50 disabled:opacity-40'
                  }`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 py-1 border-t border-[#2A2F36]/50">
          <span className={labelClass}>Category</span>
          {isEditing || !values.category ? (
            <select
              id="sd-category"
              value={values.category}
              onChange={(e) => onChange('category', e.target.value)}
              className={`${inputClass} w-40 capitalize`}
            >
              <option value="">—</option>
              {categories.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-white font-medium capitalize">{values.category}</span>
          )}
        </div>

        <div className="py-1 border-t border-[#2A2F36]/50 space-y-2">
          <span className={`${labelClass} block pt-2`}>Condition</span>
          <div className="flex flex-wrap gap-1.5">
            {conditions.map((c) => {
              const on = values.condition === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  disabled={!isEditing && !!values.condition && !on}
                  onClick={() => onChange('condition', on ? '' : c.value)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                    on
                      ? 'bg-amber-500/20 border-amber-500/50 text-amber-200'
                      : 'bg-[#0F1115] border-[#2A2F36] text-white/50 disabled:opacity-40'
                  }`}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="py-1 border-t border-[#2A2F36]/50 space-y-2">
          <label htmlFor="sd-condition-description" className={`${labelClass} block pt-2`}>
            Condition description
          </label>
          {isEditing || !values.conditionDescription ? (
            <textarea
              id="sd-condition-description"
              rows={2}
              value={values.conditionDescription}
              onChange={(e) => onChange('conditionDescription', e.target.value)}
              placeholder="Scratches on top tube, missing saddle…"
              className={`${inputClass} w-full resize-y py-2`}
            />
          ) : (
            <p className="text-white/90 text-xs leading-relaxed">{values.conditionDescription}</p>
          )}
        </div>

        {money('msrp', 'MSRP')}
        {money('standardPrice', 'Standard price')}

        <div className="flex items-center justify-between gap-3 py-1 border-t border-[#2A2F36]/50">
          <span className={labelClass}>PDF link</span>
          {isEditing || !values.pdfLink ? (
            <input
              id="sd-pdf-link"
              type="url"
              value={values.pdfLink}
              onChange={(e) => onChange('pdfLink', e.target.value)}
              placeholder="https://…"
              className={`${inputClass} flex-1 min-w-0 max-w-64`}
            />
          ) : (
            <a
              href={values.pdfLink}
              target="_blank"
              rel="noreferrer"
              className="text-emerald-400 text-xs font-medium underline truncate min-w-0"
            >
              Open PDF
            </a>
          )}
        </div>
      </div>
    </div>
  );
};
