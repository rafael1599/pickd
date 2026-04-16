import { createPortal } from 'react-dom';
import X from 'lucide-react/dist/esm/icons/x';
import Pencil from 'lucide-react/dist/esm/icons/pencil';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import { useScrollLock } from '../../../hooks/useScrollLock';

export interface SubOrderOption {
  id: string;
  order_number: string | null;
  itemCount: number;
  totalQty: number;
}

type ModalVariant = 'edit' | 'danger';

interface SelectSubOrderModalProps {
  subOrders: SubOrderOption[];
  onSelect: (listId: string, orderNumber: string | null) => void;
  onCancel: () => void;
  /** Controls title icon + accent colors. Defaults to 'edit'. */
  variant?: ModalVariant;
  /** Header title — defaults depend on variant. */
  title?: string;
  /** Centered hint under the title — defaults depend on variant. */
  hint?: string;
}

const VARIANTS = {
  edit: {
    Icon: Pencil,
    title: 'Edit Which Order?',
    hint: 'Pick one sub-order to modify',
    iconClass: 'text-accent',
    rowHover: 'hover:border-accent/40 hover:bg-accent/5',
    badgeClass: 'text-accent bg-accent/10 border-accent/20',
  },
  danger: {
    Icon: Trash2,
    title: 'Cancel Which Order?',
    hint: 'Pick one sub-order to cancel',
    iconClass: 'text-red-400',
    rowHover: 'hover:border-red-500/40 hover:bg-red-500/5',
    badgeClass: 'text-red-400 bg-red-500/10 border-red-500/20',
  },
} as const;

export const SelectSubOrderModal: React.FC<SelectSubOrderModalProps> = ({
  subOrders,
  onSelect,
  onCancel,
  variant = 'edit',
  title,
  hint,
}) => {
  useScrollLock(true, onCancel);
  const v = VARIANTS[variant];
  const Icon = v.Icon;

  return createPortal(
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-main/60 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onCancel}
    >
      <div
        className="bg-surface border border-subtle rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-subtle flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon size={14} className={v.iconClass} />
            <h3 className="text-base font-black text-content uppercase tracking-tight">
              {title ?? v.title}
            </h3>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 -mr-1.5 text-muted hover:text-content transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-2 max-h-[60vh] overflow-y-auto">
          <p className="text-[10px] text-muted/70 font-bold uppercase tracking-widest text-center mb-3">
            {hint ?? v.hint}
          </p>

          {subOrders.map((sub) => (
            <button
              key={sub.id}
              onClick={() => onSelect(sub.id, sub.order_number)}
              className={`w-full flex items-center justify-between gap-3 p-4 rounded-xl border border-subtle bg-card transition-all active:scale-[0.98] text-left ${v.rowHover}`}
            >
              <div className="flex flex-col gap-1 min-w-0 flex-1">
                <span
                  className={`text-xs font-mono font-black tracking-widest px-2 py-0.5 rounded border self-start ${v.badgeClass}`}
                >
                  #{sub.order_number || sub.id.slice(-6).toUpperCase()}
                </span>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-[10px] font-black text-muted/70 uppercase tracking-widest">
                    {sub.itemCount} SKU{sub.itemCount !== 1 ? 's' : ''}
                  </span>
                  <span className="text-[10px] text-muted/30">|</span>
                  <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">
                    {sub.totalQty} Units
                  </span>
                </div>
              </div>
              <ChevronRight size={16} className="text-muted/40 shrink-0" />
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
};
