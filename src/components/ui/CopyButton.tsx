import React from 'react';
import Copy from 'lucide-react/dist/esm/icons/copy';
import toast from 'react-hot-toast';

/**
 * What a copy button will copy, lit up while the pointer is on the button: a
 * faint green, just enough to set it apart from the data around it (Rafael, 29
 * sep 2026). Put `group/copy` on the row that holds both, and this on the value.
 */
export const COPY_TARGET =
  'rounded-lg transition-colors duration-150 group-has-[[data-copy]:hover]/copy:bg-emerald-500/10 group-has-[[data-copy]:focus-visible]/copy:bg-emerald-500/10';

/**
 * Copy-to-clipboard icon button with a toast. Lived inside ShipOrderCard until
 * the FedEx recipient chip needed the same gesture in DoubleCheckView; the
 * behaviour (stop propagation, ignore blanks, toast on success/failure) is
 * unchanged.
 */
export const CopyButton: React.FC<{ value: string; label: string; size?: number }> = ({
  value,
  label,
  size = 13,
}) => {
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!value.trim()) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error('Could not copy');
    }
  };
  return (
    <button
      type="button"
      data-copy
      onClick={handleCopy}
      title={`Copy ${label}`}
      aria-label={`Copy ${label}`}
      className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-muted hover:text-accent transition-colors duration-150 active:scale-90"
    >
      <Copy size={size} />
    </button>
  );
};
