import { useNavigate } from 'react-router-dom';
import ExternalLink from 'lucide-react/dist/esm/icons/external-link';
import Pencil from 'lucide-react/dist/esm/icons/pencil';
import { useScratchAndDentBySku } from '../hooks/useScratchAndDentCatalog';

const CONDITION_LABEL: Record<string, string> = {
  new_unbuilt: 'New (Unbuilt)',
  new_built: 'New (Built)',
  ridden_demo: 'Ridden / Demo',
  returned: 'Returned',
  defective_frame: 'Defective Frame',
};

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

const formatPrice = (n: number | null | undefined) =>
  typeof n === 'number'
    ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
    : '—';

/** Some Excel rows store the link as "www.dropbox.com/..." without the scheme. */
const normalizeHref = (link: string) =>
  /^https?:\/\//i.test(link) ? link : `https://${link.replace(/^\/+/, '')}`;

export function ScratchAndDentSection({ sku }: { sku: string }) {
  const navigate = useNavigate();
  const { data: unit, isLoading } = useScratchAndDentBySku(sku);

  if (isLoading) {
    return (
      <div className="px-4 py-3 border-b border-subtle text-[10px] uppercase tracking-widest text-muted">
        Loading S/D details…
      </div>
    );
  }

  if (!unit) {
    return (
      <div className="px-4 py-3 border-b border-subtle">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-black text-muted uppercase tracking-widest">S/D</span>
          <button
            onClick={() => navigate(`/sd-catalog?action=create&sku=${encodeURIComponent(sku)}`)}
            className="px-3 py-1 rounded-lg text-[10px] font-bold bg-accent text-white active:scale-95 transition-all"
          >
            Register S/D info
          </button>
        </div>
      </div>
    );
  }

  const variant = unit.bike_variants;
  const product = variant?.products;
  const status = STATUS_BADGE[unit.status] ?? STATUS_BADGE.available;
  const sdPriceFmt = formatPrice(unit.sd_price);
  const stdPriceFmt = formatPrice(variant?.standard_price);
  const msrpFmt = formatPrice(variant?.msrp);

  return (
    <div className="px-4 py-3 border-b border-subtle space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black text-muted uppercase tracking-widest">S/D</span>
          <span
            className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border ${status.className}`}
          >
            {status.label}
          </span>
          <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full bg-surface text-content border border-subtle">
            {unit.category === 'demo' ? 'DEMO' : 'S/D'}
          </span>
        </div>
        <button
          onClick={() => navigate(`/sd-catalog?action=edit&sku=${encodeURIComponent(sku)}`)}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold text-muted hover:text-content active:scale-95 transition-all"
        >
          <Pencil size={11} />
          Edit
        </button>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
        <div>
          <div className="text-[9px] uppercase tracking-wider text-muted">Model</div>
          <div className="font-medium text-content">{product?.product_name ?? '—'}</div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-wider text-muted">Size / Color</div>
          <div className="font-medium text-content">
            {[variant?.size, variant?.color].filter(Boolean).join(' · ') || '—'}
          </div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-wider text-muted">Serial</div>
          <div className="font-mono text-[10.5px] text-content">{unit.serial_number ?? '—'}</div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-wider text-muted">Condition</div>
          <div className="font-medium text-content">
            {unit.condition ? CONDITION_LABEL[unit.condition] : '—'}
          </div>
        </div>
      </div>

      {unit.condition_description && (
        <div>
          <div className="text-[9px] uppercase tracking-wider text-muted">Notes</div>
          <div className="text-[11px] text-content leading-snug">{unit.condition_description}</div>
        </div>
      )}

      <div className="flex items-baseline gap-3 flex-wrap">
        <div>
          <div className="text-[9px] uppercase tracking-wider text-muted">S/D price</div>
          <div className="text-base font-black text-accent">{sdPriceFmt}</div>
        </div>
        {variant?.standard_price != null && (
          <div>
            <div className="text-[9px] uppercase tracking-wider text-muted">Standard</div>
            <div className="text-[11px] line-through text-muted">{stdPriceFmt}</div>
          </div>
        )}
        {variant?.msrp != null && (
          <div>
            <div className="text-[9px] uppercase tracking-wider text-muted">MSRP</div>
            <div className="text-[11px] line-through text-muted">{msrpFmt}</div>
          </div>
        )}
      </div>

      {unit.pdf_link && (
        <a
          href={normalizeHref(unit.pdf_link)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-surface text-accent border border-subtle hover:border-accent/50 active:scale-95 transition-all"
        >
          <ExternalLink size={12} />
          View photos PDF
        </a>
      )}
    </div>
  );
}
