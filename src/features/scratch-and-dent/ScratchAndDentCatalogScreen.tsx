import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ExternalLink from 'lucide-react/dist/esm/icons/external-link';
import Search from 'lucide-react/dist/esm/icons/search';
import {
  useScratchAndDentCatalog,
  useScratchAndDentFilterOptions,
} from './hooks/useScratchAndDentCatalog';
import type { BikeUnitWithCatalog } from '../../schemas/products.schema';
import { ScratchAndDentEditorSheet } from './components/ScratchAndDentEditorSheet';
import { SDQuickIntakeModal } from './components/SDQuickIntakeModal';

const STATUS_TABS: { value: 'available' | 'sold' | 'reserved' | 'retired'; label: string }[] = [
  { value: 'available', label: 'Available' },
  { value: 'reserved', label: 'Reserved' },
  { value: 'sold', label: 'Sold' },
  { value: 'retired', label: 'Retired' },
];

const formatPrice = (n: number | null | undefined) =>
  typeof n === 'number'
    ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 })
    : '—';

const normalizeHref = (link: string) =>
  /^https?:\/\//i.test(link) ? link : `https://${link.replace(/^\/+/, '')}`;

function CatalogCard({ unit }: { unit: BikeUnitWithCatalog }) {
  const variant = unit.bike_variants;
  const product = variant?.products;
  return (
    <div className="bg-surface border border-subtle rounded-2xl overflow-hidden flex flex-col hover:border-accent/40 transition-colors">
      <div className="aspect-square bg-neutral-900/40 flex items-center justify-center text-muted text-[10px] uppercase tracking-widest">
        {/* Placeholder — fotos viven en el PDF de Dropbox por ahora */}
        Photos in PDF
      </div>
      <div className="p-3 flex-1 flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full bg-neutral-800/40 text-content border border-subtle">
            {unit.category === 'demo' ? 'DEMO' : 'S/D'}
          </span>
          <span className="font-mono text-[10px] text-muted">{unit.sku}</span>
        </div>
        <div className="font-bold text-sm text-content leading-tight">
          {product?.product_name ?? '—'}
        </div>
        <div className="text-[10px] text-muted">
          {[variant?.size, variant?.color].filter(Boolean).join(' · ') || '—'}
        </div>
        {unit.condition_description && (
          <p className="text-[10.5px] text-muted leading-snug line-clamp-2">
            {unit.condition_description}
          </p>
        )}
        <div className="flex items-baseline gap-2 mt-auto pt-2">
          <span className="text-base font-black text-accent">{formatPrice(unit.sd_price)}</span>
          {variant?.msrp != null && (
            <span className="text-[10px] line-through text-muted">{formatPrice(variant.msrp)}</span>
          )}
        </div>
        {unit.pdf_link && (
          <a
            href={normalizeHref(unit.pdf_link)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] font-bold text-accent hover:underline"
          >
            <ExternalLink size={11} />
            View photos PDF
          </a>
        )}
      </div>
    </div>
  );
}

export function ScratchAndDentCatalogScreen() {
  const [searchParams, setSearchParams] = useSearchParams();
  const action = searchParams.get('action');
  const skuFromUrl = searchParams.get('sku');

  const [statusFilter, setStatusFilter] = useState<'available' | 'sold' | 'reserved' | 'retired'>(
    'available'
  );
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'sd' | 'demo'>('all');
  const [productFilter, setProductFilter] = useState<string>('');
  const [sizeFilter, setSizeFilter] = useState<string>('');
  const [colorFilter, setColorFilter] = useState<string>('');
  const [search, setSearch] = useState('');

  const { data: options } = useScratchAndDentFilterOptions();
  const { data, isLoading } = useScratchAndDentCatalog({
    status: statusFilter,
    category: categoryFilter === 'all' ? undefined : categoryFilter,
    productId: productFilter || undefined,
    size: sizeFilter || undefined,
    color: colorFilter || undefined,
    search: search || undefined,
  });

  const isEditorOpen = action === 'create' || action === 'edit';
  const [quickIntakeOpen, setQuickIntakeOpen] = useState(false);

  const closeEditor = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('action');
    next.delete('sku');
    setSearchParams(next, { replace: true });
  };

  const grouped = useMemo(() => data ?? [], [data]);

  return (
    <div className="min-h-[calc(100vh-84px)] bg-main">
      <div className="max-w-7xl mx-auto px-4 py-4 space-y-4">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-content">S/D Catalog</h1>
            <p className="text-[11px] text-muted">
              {grouped.length} {grouped.length === 1 ? 'unit' : 'units'} · scratch & dent / demo
              bikes
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setQuickIntakeOpen(true)}
              className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-accent text-white active:scale-95 transition-all"
            >
              + Quick Intake
            </button>
            <button
              onClick={() => setSearchParams({ action: 'create' }, { replace: true })}
              className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-card text-muted border border-subtle active:scale-95 transition-all"
            >
              + Full Editor
            </button>
          </div>
        </div>

        {/* Status tabs */}
        <div className="flex items-center gap-1 border-b border-subtle">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={`px-3 py-2 text-[11px] font-bold uppercase tracking-wider border-b-2 transition-colors ${
                statusFilter === tab.value
                  ? 'border-accent text-accent'
                  : 'border-transparent text-muted hover:text-content'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Filters row */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-surface border border-subtle text-[11px]">
            <Search size={12} className="text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="SKU, serial, condition…"
              className="bg-transparent outline-none w-44 text-content placeholder:text-muted"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as 'all' | 'sd' | 'demo')}
            className="px-2 py-1.5 rounded-lg bg-surface border border-subtle text-[11px] text-content"
          >
            <option value="all">All categories</option>
            <option value="sd">S/D</option>
            <option value="demo">Demo</option>
          </select>
          <select
            value={productFilter}
            onChange={(e) => setProductFilter(e.target.value)}
            className="px-2 py-1.5 rounded-lg bg-surface border border-subtle text-[11px] text-content max-w-[200px]"
          >
            <option value="">All models</option>
            {options?.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.product_name}
              </option>
            ))}
          </select>
          <select
            value={sizeFilter}
            onChange={(e) => setSizeFilter(e.target.value)}
            className="px-2 py-1.5 rounded-lg bg-surface border border-subtle text-[11px] text-content"
          >
            <option value="">All sizes</option>
            {options?.sizes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={colorFilter}
            onChange={(e) => setColorFilter(e.target.value)}
            className="px-2 py-1.5 rounded-lg bg-surface border border-subtle text-[11px] text-content"
          >
            <option value="">All colors</option>
            {options?.colors.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {/* Grid */}
        {isLoading ? (
          <div className="text-center text-muted text-sm py-12">Loading…</div>
        ) : grouped.length === 0 ? (
          <div className="text-center text-muted text-sm py-12">No units match your filters.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {grouped.map((unit) => (
              <CatalogCard key={unit.id} unit={unit} />
            ))}
          </div>
        )}
      </div>

      {isEditorOpen && (
        <ScratchAndDentEditorSheet
          mode={action === 'edit' ? 'edit' : 'create'}
          sku={skuFromUrl}
          onClose={closeEditor}
        />
      )}

      <SDQuickIntakeModal open={quickIntakeOpen} onClose={() => setQuickIntakeOpen(false)} />
    </div>
  );
}
