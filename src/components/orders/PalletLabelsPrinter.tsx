import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../hooks/useScrollLock';
import Printer from 'lucide-react/dist/esm/icons/printer';
import FileText from 'lucide-react/dist/esm/icons/file-text';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import MapPin from 'lucide-react/dist/esm/icons/map-pin';
import Hash from 'lucide-react/dist/esm/icons/hash';
import { usePickingSession } from '../../context/PickingContext';
import toast from 'react-hot-toast';

interface CustomerInfo {
  id?: string;
  name?: string;
  street?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  [key: string]: string | undefined;
}

interface PalletLabelsPrinterProps {
  onClose: () => void;
  order?: {
    order_number?: string;
    pallets_qty?: number;
    load_number?: string;
    items?: { sku: string; pickingQty?: number }[];
    customer_details?: CustomerInfo;
    customer?: CustomerInfo;
    [key: string]: unknown;
  };
}

export const PalletLabelsPrinter = ({ onClose, order }: PalletLabelsPrinterProps) => {
  useScrollLock(true, onClose);
  // Try to get context, but don't fail if we're just viewing history and not in a session
  // Actually, hooks can't be conditional. Assuming we are in a provider since this is a protected route.
  const {
    customer: contextCustomer,
    orderNumber: contextOrderNumber,
    loadNumber: contextLoadNumber,
    setLoadNumber: setContextLoadNumber,
    updateCustomerDetails,
    cartItems,
  } = usePickingSession();

  // Determine Mode
  const isHistoryMode = !!order;

  // Effective Values
  const customer: CustomerInfo | null = isHistoryMode
    ? order.customer_details || order.customer || {} // Fallback if customer object missing
    : (contextCustomer as CustomerInfo | null);

  const orderNumber = isHistoryMode ? order.order_number : contextOrderNumber;
  const loadNumberFromSource = isHistoryMode ? order.load_number || '' : contextLoadNumber;

  const pallets = isHistoryMode
    ? order.pallets_qty || 1
    : Math.max(1, Math.ceil(cartItems.reduce((acc, item) => acc + (item.pickingQty || 0), 0) / 10));

  const [isGenerating, setIsGenerating] = useState(false);
  const [loadNumber, setLocalLoadNumber] = useState(loadNumberFromSource || '');

  // Address sub-form state
  const [street, setStreet] = useState(customer?.street || '');
  const [city, setCity] = useState(customer?.city || '');
  const [state, setState] = useState(customer?.state || '');
  const [zip, setZip] = useState(customer?.zip_code || '');

  const hasAddress = Boolean(street && city);

  const generateAndPrintPDF = async () => {
    if (!loadNumber.trim()) {
      toast.error('Load Number is required for professional labels');
      return;
    }

    setIsGenerating(true);
    try {
      // 1. Persist changes IS ONLY FOR ACTIVE SESSIONS
      if (!isHistoryMode && customer?.id) {
        const needsUpdate =
          street !== customer.street ||
          city !== customer.city ||
          state !== customer.state ||
          zip !== customer.zip_code;
        if (needsUpdate) {
          await updateCustomerDetails(customer.id, {
            street: street.trim() || null,
            city: city.trim() || null,
            state: state.trim() || null,
            zip_code: zip.trim() || null,
          });
        }
      }

      if (!isHistoryMode && loadNumber !== contextLoadNumber) {
        setContextLoadNumber(loadNumber);
      }

      const { default: jsPDF } = await import('jspdf');

      // Create PDF in 6x4 inches landscape
      const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'in',
        format: [6, 4],
      });

      const customerName = (customer?.name || 'GENERIC CUSTOMER').toUpperCase();
      const hasAddress = street && city;

      for (let i = 0; i < pallets; i++) {
        // --- PAGE A: COMPANY INFO ---
        if (i > 0) doc.addPage([6, 4], 'landscape');

        if (hasAddress) {
          // PROFESSIONAL LAYOUT (Two-column style or Header style)
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(28);
          const nameLines = doc.splitTextToSize(customerName, 5.5);
          doc.text(nameLines, 0.5, 0.8);

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(18);
          doc.text(`${street}`, 0.5, 1.4);
          doc.text(`${city}, ${state} ${zip}`, 0.5, 1.7);

          // Separator line
          doc.setLineWidth(0.05);
          doc.line(0.5, 2.1, 5.5, 2.1);

          // PO / LOAD INFO
          doc.setFontSize(14);
          doc.text(`ORDER #: ${orderNumber || 'N/A'}`, 0.5, 2.5);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(32);
          doc.text(`LOAD: ${loadNumber}`, 0.5, 3.2);

          doc.setFontSize(12);
          doc.text(`DATE: ${new Date().toLocaleDateString()}`, 0.5, 3.7);
        } else {
          // SIMPLE LAYOUT (Centered large name)
          let fontSize = 70;
          if (customerName.length > 20) fontSize = 50;
          if (customerName.length > 35) fontSize = 35;

          doc.setFont('helvetica', 'bold');
          doc.setFontSize(fontSize);
          const customerLines = doc.splitTextToSize(customerName, 5.5);
          const textHeight = (customerLines.length * fontSize) / 72;
          doc.text(customerLines, 3, 2.0 - textHeight / 2, { align: 'center' });

          doc.setFontSize(24);
          doc.text(`LOAD: ${loadNumber}`, 3, 3.5, { align: 'center' });
        }

        // --- PAGE B: NUMBERING ---
        doc.addPage([6, 4], 'landscape');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(110);
        const textNum = `${i + 1} OF ${pallets}`;
        const numWidth = doc.getTextWidth(textNum);
        doc.text(textNum, (6 - numWidth) / 2, 2.3);

        // Small Load # at bottom of numbering page for reference
        doc.setFontSize(12);
        doc.text(`LOAD: ${loadNumber}`, 3, 3.8, { align: 'center' });
      }

      const blob = doc.output('bloburl');
      window.open(blob, '_blank');
      onClose();
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast.error('Failed to generate PDF');
    } finally {
      setIsGenerating(false);
    }
  };

  const content = (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-zinc-950/80 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-[2.5rem] p-8 shadow-2xl overflow-hidden relative">
        <div className="absolute top-0 left-0 w-full h-1 bg-accent/20">
          <div className="h-full bg-accent w-full origin-left animate-pulse" />
        </div>

        <div className="text-center space-y-5">
          <div className="flex items-center justify-between mb-2">
            <div className="w-12 h-12 bg-accent/10 rounded-2xl flex items-center justify-center border border-accent/20 text-accent">
              <FileText size={24} />
            </div>
            <div className="text-right">
              <h2 className="text-xl font-black text-white uppercase tracking-tight italic leading-none">
                Label <span className="text-accent not-italic">PDF</span>
              </h2>
              <p className="text-[8px] text-zinc-500 font-bold uppercase tracking-[0.2em]">
                {pallets} Pallets ({pallets * 2} labels)
              </p>
            </div>
          </div>

          <div className="space-y-4 text-left">
            {/* Load Number Section */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-[9px] text-zinc-500 font-black uppercase tracking-widest pl-1">
                <Hash size={10} /> Load Number
              </label>
              <input
                type="text"
                value={loadNumber}
                onChange={(e) => setLocalLoadNumber(e.target.value.toUpperCase())}
                placeholder="E.G. LOAD-1234"
                className="w-full h-12 bg-zinc-800 border border-zinc-700 rounded-xl px-4 text-white text-sm font-bold focus:outline-none focus:border-accent transition-colors uppercase"
              />
            </div>

            {/* Customer Info Section / Address Completion */}
            <div className="space-y-3 p-4 bg-zinc-800/30 rounded-2xl border border-zinc-700/50">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[9px] text-zinc-500 font-black uppercase tracking-widest">
                  Destination
                </p>
                <p className="text-accent text-[8px] font-black uppercase px-2 py-0.5 bg-accent/10 rounded-full border border-accent/10">
                  {isHistoryMode
                    ? 'Read Only'
                    : hasAddress
                      ? 'Verified Address'
                      : 'Missing Details'}
                </p>
              </div>

              <p className="text-white font-bold text-sm mb-3 px-1">
                {customer?.name || 'GENERIC CUSTOMER'}
              </p>

              <div className={`space-y-2 ${isHistoryMode ? 'opacity-50 pointer-events-none' : ''}`}>
                <div className="relative">
                  <MapPin size={14} className="absolute left-3 top-3.5 text-zinc-500" />
                  <input
                    type="text"
                    placeholder="Street Address"
                    value={street}
                    onChange={(e) => setStreet(e.target.value)}
                    className="w-full h-10 bg-zinc-900 border border-transparent rounded-lg pl-9 pr-3 text-xs text-zinc-300 focus:border-accent/30 transition-all"
                    disabled={isHistoryMode}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="City"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="w-full h-10 bg-zinc-900 border border-transparent rounded-lg px-3 text-xs text-zinc-300 focus:border-accent/30 transition-all"
                    disabled={isHistoryMode}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="ST"
                      value={state}
                      maxLength={2}
                      onChange={(e) => setState(e.target.value.toUpperCase())}
                      className="w-full h-10 bg-zinc-900 border border-transparent rounded-lg px-3 text-xs text-zinc-300 focus:border-accent/30 transition-all text-center"
                      disabled={isHistoryMode}
                    />
                    <input
                      type="text"
                      placeholder="Zip"
                      value={zip}
                      onChange={(e) => setZip(e.target.value)}
                      className="w-full h-10 bg-zinc-900 border border-transparent rounded-lg px-3 text-xs text-zinc-300 focus:border-accent/30 transition-all"
                      disabled={isHistoryMode}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 pt-2">
            <button
              onClick={generateAndPrintPDF}
              disabled={isGenerating || !loadNumber.trim()}
              className="w-full h-14 bg-accent text-white rounded-2xl flex items-center justify-center gap-3 text-xs font-black uppercase tracking-widest shadow-xl shadow-accent/20 active:scale-95 transition-all disabled:opacity-30 disabled:grayscale"
            >
              {isGenerating ? (
                <Loader2 className="animate-spin" size={18} />
              ) : (
                <Printer size={18} />
              )}
              {isGenerating ? 'Generating...' : 'Open PDF to Print'}
            </button>

            <button
              onClick={onClose}
              className="w-full h-10 text-zinc-500 hover:text-white text-[10px] font-black uppercase tracking-widest transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
};
