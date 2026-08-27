import React from 'react';
import Copy from 'lucide-react/dist/esm/icons/copy';
import toast from 'react-hot-toast';

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
      onClick={handleCopy}
      title={`Copy ${label}`}
      aria-label={`Copy ${label}`}
      className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-muted hover:text-accent transition-colors duration-150 active:scale-90"
    >
      <Copy size={size} />
    </button>
  );
};
