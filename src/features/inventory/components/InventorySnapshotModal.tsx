import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import X from 'lucide-react/dist/esm/icons/x';
import Layers from 'lucide-react/dist/esm/icons/layers';
import LinkIcon from 'lucide-react/dist/esm/icons/link';
import Check from 'lucide-react/dist/esm/icons/check';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';

import { useInventorySnapshot, type SnapshotItem } from '../hooks/useInventorySnapshot';
import { toast } from 'react-hot-toast';
import { SearchInput } from '../../../components/ui/SearchInput';
import { useScrollLock } from '../../../hooks/useScrollLock';

const naturalSort = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

export const InventorySnapshotModal = ({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) => {
  useScrollLock(isOpen, onClose);
  const { loading, data, fetchSnapshot } = useInventorySnapshot();
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [searchQuery, setSearchQuery] = useState('');

  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedMarkdown, setCopiedMarkdown] = useState(false);

  // Estados para la validación del link
  const [linkExists, setLinkExists] = useState(false);
  const [verifyingLink, setVerifyingLink] = useState(false);

  const R2_PUBLIC_DOMAIN = 'https://pub-1a61139939fa4f3ba21ee7909510985c.r2.dev';

  // 1. Lógica de Filtrado (Debe ir primero)
  const filteredData = useMemo(() => {
    const activeItems = data.filter((item) => {
      const qty = typeof item.quantity === 'number' ? item.quantity : Number(item.quantity);
      return !isNaN(qty) && qty > 0;
    });
    if (!searchQuery) return activeItems;
    const query = searchQuery.toLowerCase().trim();
    return activeItems.filter(
      (item) =>
        item.sku.toLowerCase().includes(query) ||
        item.location.toLowerCase().includes(query) ||
        item.warehouse.toLowerCase().includes(query)
    );
  }, [data, searchQuery]);

  // 2. Lógica de Agrupamiento (Debe ir antes de usarla en Markdown)
  const groupedData = useMemo(() => {
    const groups: Record<string, Record<string, SnapshotItem[]>> = {};
    filteredData.forEach((item) => {
      const wh = item.warehouse || 'UNKNOWN';
      const loc = item.location || 'GENERAL';
      if (!groups[wh]) groups[wh] = {};
      if (!groups[wh][loc]) groups[wh][loc] = [];
      groups[wh][loc].push(item);
    });
    const sortedWarehouses = Object.keys(groups).sort(naturalSort);
    const sortedGroups: Record<string, Record<string, SnapshotItem[]>> = {};
    sortedWarehouses.forEach((wh) => {
      const locations = groups[wh];
      sortedGroups[wh] = {};
      Object.keys(locations)
        .sort(naturalSort)
        .forEach((loc) => {
          sortedGroups[wh][loc] = locations[loc];
        });
    });
    return sortedGroups;
  }, [filteredData]);

  // 3. Lógica de Markdown (Usa groupedData)
  const markdownContent = useMemo(() => {
    if (!filteredData.length) return '';
    let md = `INVENTORY SNAPSHOT - ${selectedDate}\n`;
    md += `==========================================\n\n`;

    Object.entries(groupedData).forEach(([wh, locations]) => {
      md += `WAREHOUSE: ${wh.toUpperCase()}\n`;
      md += `------------------------------------------\n`;

      Object.entries(locations).forEach(([loc, items]) => {
        md += `\n[${loc}]\n`;
        items.forEach((item) => {
          const noteStr = item.item_name ? ` (${item.item_name})` : '';
          const displayQty = Math.max(0, item.quantity);
          if (displayQty > 0) {
            md += `- ${item.sku}${noteStr} | Qty: ${displayQty}\n`;
          }
        });
      });
      md += `\n\n`;
    });
    return md;
  }, [groupedData, selectedDate, filteredData]);

  // 4. Lógica de Links y Efectos
  const dailyLink = useMemo(() => {
    const [year, month, day] = selectedDate.split('-');
    const usDate = `${month}-${day}-${year}`;
    return `${R2_PUBLIC_DOMAIN}/inventory-snapshot-${usDate}.html`;
  }, [selectedDate, R2_PUBLIC_DOMAIN]);

  // Efecto para cargar datos y VERIFICAR si el link existe en R2
  useEffect(() => {
    if (!isOpen) return;

    // 1. Cargar datos de la DB para la previsualización
    fetchSnapshot(selectedDate);

    // 2. Verificación de archivo en Cloudflare
    const checkFile = async () => {
      setVerifyingLink(true);
      setLinkExists(false);
      try {
        // Hacemos una petición HEAD (solo para ver si existe, sin descargar todo)
        const response = await fetch(dailyLink, { method: 'HEAD' });
        setLinkExists(response.ok);
      } catch {
        setLinkExists(false);
      } finally {
        setVerifyingLink(false);
      }
    };

    checkFile();
  }, [isOpen, selectedDate, dailyLink, fetchSnapshot]);

  const handleCopyLink = () => {
    if (!linkExists) return;
    navigator.clipboard.writeText(dailyLink);
    toast.success('Shareable link copied to clipboard!');
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleCopyMarkdown = () => {
    navigator.clipboard.writeText(markdownContent);
    setCopiedMarkdown(true);
    toast.success('Inventory state copied to clipboard (Markdown)');
    setTimeout(() => setCopiedMarkdown(false), 2000);
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-main/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-4xl bg-surface border border-subtle rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-8 py-6 border-b border-subtle flex justify-between items-center bg-card">
          <div>
            <h2 className="text-2xl font-black uppercase tracking-tighter flex items-center gap-2">
              <Layers className="text-accent" /> Daily Snapshots
            </h2>
            <p className="text-[10px] text-muted font-bold uppercase tracking-widest mt-1">
              Select a date to see the inventory status for that specific day
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-main rounded-full transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="px-8 py-6 space-y-6 overflow-hidden flex flex-col flex-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] text-muted font-black uppercase tracking-widest pl-1">
                Audit Date
              </label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full bg-surface border border-subtle rounded-2xl py-3.5 px-4 text-xs font-bold focus:outline-none focus:border-accent text-content"
              />
            </div>
            <div className="sm:col-span-1 lg:col-span-2 space-y-2">
              <label className="text-[10px] text-muted font-black uppercase tracking-widest pl-1">
                Instant Search
              </label>
              <SearchInput
                variant="inline"
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search SKU, location or warehouse..."
                preferenceId="snapshot"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto space-y-8 scrollbar-hide">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 opacity-30">
                <Loader2 className="animate-spin mb-4" size={40} />
                <p className="text-xs font-black uppercase tracking-widest">Loading Live Data...</p>
              </div>
            ) : (
              Object.entries(groupedData).map(([wh, locations]) => (
                <div key={wh} className="space-y-4">
                  <h3 className="text-sm font-black uppercase tracking-[0.2em] border-l-4 border-accent pl-2">
                    {wh}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {Object.entries(locations).map(([loc, items]) => (
                      <div key={loc} className="bg-card/30 border border-subtle rounded-3xl p-5">
                        <div className="flex justify-between items-center mb-3">
                          <span className="text-[10px] font-black uppercase text-muted">
                            [ {loc} ]
                          </span>
                          <span className="text-[10px] font-bold text-accent">
                            {items.length} units
                          </span>
                        </div>
                        <div className="space-y-1">
                          {items.map((item) => (
                            <div key={item.sku} className="flex justify-between text-xs">
                              <span className="font-bold">{item.sku}</span>
                              <span className="font-black text-accent">{item.quantity}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="px-8 py-6 bg-card border-t border-subtle flex gap-4">
          <button
            onClick={handleCopyMarkdown}
            disabled={loading || !markdownContent}
            className={`flex-1 flex items-center justify-center gap-3 transition-all py-5 rounded-2xl text-xs font-black uppercase tracking-widest border border-subtle hover:border-accent/30 ${
              copiedMarkdown
                ? 'bg-green-500/10 text-green-500 border-green-500/20'
                : 'bg-surface text-content active:scale-95'
            }`}
          >
            {copiedMarkdown ? <Check size={18} /> : <Layers size={18} />}
            {copiedMarkdown ? 'Markdown Copied!' : 'Copy Markdown'}
          </button>

          {linkExists && (
            <button
              onClick={handleCopyLink}
              disabled={loading || verifyingLink}
              className={`flex-1 flex items-center justify-center gap-3 transition-all py-5 rounded-2xl text-xs font-black uppercase tracking-widest shadow-xl ${
                copiedLink
                  ? 'bg-green-500 text-white shadow-green-500/20'
                  : 'bg-content text-main active:scale-95 shadow-accent/20'
              }`}
            >
              {verifyingLink ? (
                <Loader2 className="animate-spin" size={18} />
              ) : copiedLink ? (
                <Check size={18} />
              ) : (
                <LinkIcon size={18} />
              )}

              {verifyingLink ? 'Verifying...' : copiedLink ? 'Link Copied!' : `Shareable Link`}
            </button>
          )}
        </div>
        {!linkExists && !verifyingLink && !loading && (
          <div className="pb-6 px-8 bg-card text-center">
            <p className="text-[9px] text-accent font-black uppercase tracking-widest animate-pulse">
              Wait for daily sync at 11:00 PM (NY Time)
            </p>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
