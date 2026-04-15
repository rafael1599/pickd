import React, { useMemo } from 'react';
import jsPDF from 'jspdf';

export const TRANSPORT_COLORS: Record<string, { bg: string; text: string }> = {
  'R+L': { bg: '#006647', text: '#FFFFFF' },
  '2-DAY': { bg: '#003366', text: '#FFFFFF' },
  RIST: { bg: '#8B2500', text: '#FFFFFF' },
  TFORCE: { bg: '#0053A1', text: '#FFFFFF' },
  DAYLIGHT: { bg: '#006BB7', text: '#FFFFFF' },
  'PAV EXPRESS': { bg: '#6B6B6B', text: '#FFD200' },
  ESTES: { bg: '#FFD200', text: '#000000' },
};

interface LivePrintPreviewProps {
  orderNumber?: string;
  customerName: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  pallets: number | string;
  bikeCount: number;
  partCount: number;
  loadNumber: string;
  totalWeight: number;
  completedAt?: string;
  transportCompany?: string;
}

/** Build the BIKES/PARTS lines for labels */
function unitsLines(bikes: number, parts: number): string[] {
  const lines: string[] = [];
  if (bikes > 0) lines.push(`BIKES: ${bikes}`);
  if (parts > 0) lines.push(`PARTS: ${parts}`);
  if (lines.length === 0) lines.push('UNITS: 0');
  return lines;
}

export const LivePrintPreview: React.FC<LivePrintPreviewProps> = ({
  orderNumber,
  customerName,
  street,
  city,
  state,
  zip,
  pallets,
  bikeCount,
  partCount,
  loadNumber,
  totalWeight,
  completedAt,
  transportCompany,
}) => {
  const brandColors = transportCompany ? TRANSPORT_COLORS[transportCompany] : undefined;
  const palletCount = parseInt(pallets?.toString() || '1');
  const cityStateZip = `${city}, ${state} ${zip}`.toUpperCase().trim();
  const unitLines = useMemo(() => unitsLines(bikeCount, partCount), [bikeCount, partCount]);

  // Replicate PDF Scaling Logic from Production
  const fontSizePt = useMemo(() => {
    const margin = 5;
    const pageWidth = 297;
    const pageHeight = 210;
    const PT_TO_MM = 0.3528;
    const LINE_HEIGHT = 1.1;
    const maxWidth = pageWidth - margin * 2;
    const maxHeight = pageHeight - margin * 2;
    const thankYouMsg =
      'PLEASE COUNT YOUR SHIPMENT CAREFULLY THAT THERE ARE NO DAMAGES DUE TO SHIPPING. JAMIS BICYCLES THANKS YOU FOR YOUR ORDER.';

    const contentLines: string[] = [];
    contentLines.push(customerName.toUpperCase());
    if (street) contentLines.push(street.toUpperCase());
    if (city || state || zip) contentLines.push(cityStateZip);
    contentLines.push(''); // spacer
    if (orderNumber) contentLines.push(`ORDER #: ${orderNumber}`);
    contentLines.push(`PALLETS: ${palletCount}`);
    contentLines.push(...unitLines);
    contentLines.push(`LOAD: ${loadNumber || 'N/A'}`);
    contentLines.push(`WEIGHT: ${totalWeight > 0 ? `${totalWeight} LBS` : 'N/A'}`);
    contentLines.push(''); // spacer

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.setFont('helvetica', 'bold');

    let fontSize = 100;
    const minFontSize = 12;
    let fits = false;

    while (fontSize >= minFontSize && !fits) {
      doc.setFontSize(fontSize);
      doc.setLineHeightFactor(LINE_HEIGHT);
      let totalHeight = margin;

      for (const line of contentLines) {
        if (line === '') {
          totalHeight += fontSize * PT_TO_MM * 0.3;
        } else {
          const wrapped = doc.splitTextToSize(line, maxWidth);
          totalHeight += wrapped.length * (fontSize * PT_TO_MM * LINE_HEIGHT);
        }
      }

      const msgFontSize = fontSize * 0.7;
      doc.setFontSize(msgFontSize);
      const msgWrapped = doc.splitTextToSize(thankYouMsg, maxWidth);
      totalHeight += msgWrapped.length * (msgFontSize * PT_TO_MM * LINE_HEIGHT);

      if (totalHeight <= maxHeight) {
        fits = true;
      } else {
        fontSize -= 1;
      }
    }
    return fontSize;
  }, [
    customerName,
    street,
    city,
    state,
    zip,
    palletCount,
    unitLines,
    loadNumber,
    totalWeight,
    cityStateZip,
    orderNumber,
  ]);

  const pages = useMemo(() => {
    const p = [];
    for (let i = 0; i < palletCount; i++) {
      // INFO LABEL
      p.push(
        <div
          key={`info-${i}`}
          className="rounded-[20px] shadow-2xl overflow-hidden shrink-0 flex flex-col font-sans uppercase"
          style={{
            width: '297mm',
            height: '210mm',
            padding: '5mm',
            fontSize: `${fontSizePt}pt`,
            lineHeight: '1.1',
            fontWeight: 'bold',
            backgroundColor: brandColors?.bg ?? '#FFFFFF',
            color: brandColors?.text ?? '#000000',
          }}
        >
          <div className="font-black tracking-tighter" style={{ fontSize: 'inherit' }}>
            <p>{customerName.toUpperCase()}</p>
            {street && <p>{street.toUpperCase()}</p>}
            {(city || state || zip) && <p>{cityStateZip}</p>}
          </div>

          <div className="mt-[0.3em] font-black tracking-tighter" style={{ fontSize: 'inherit' }}>
            {orderNumber && <p>ORDER #: {orderNumber}</p>}
            <p>PALLETS: {palletCount}</p>
            {unitLines.map((line, idx) => (
              <p key={idx}>{line}</p>
            ))}
            <p>LOAD: {loadNumber || 'N/A'}</p>
            <p>WEIGHT: {totalWeight > 0 ? `${totalWeight} LBS` : 'N/A'}</p>
          </div>

          <div
            className="mt-auto font-bold uppercase"
            style={{ fontSize: `${fontSizePt * 0.7}pt` }}
          >
            <p>
              PLEASE COUNT YOUR SHIPMENT CAREFULLY THAT THERE ARE NO DAMAGES DUE TO SHIPPING. JAMIS
              BICYCLES THANKS YOU FOR YOUR ORDER.
            </p>
          </div>
        </div>
      );

      // PALLET NUMBER (Only rendered if more than one pallet exists)
      if (palletCount > 1) {
        p.push(
          <div
            key={`num-${i}`}
            className="rounded-[20px] shadow-2xl overflow-hidden shrink-0 flex items-center justify-center font-sans"
            style={{
              width: '297mm',
              height: '210mm',
              backgroundColor: brandColors?.bg ?? '#FFFFFF',
              color: brandColors?.text ?? '#000000',
            }}
          >
            <div className="flex flex-col items-center justify-center gap-0 w-full px-[5mm]">
              <span className="text-[8rem] font-black leading-none tracking-[0.3em] uppercase">
                PALLET
              </span>
              <h2
                className="font-black leading-none tracking-tighter uppercase w-full text-center"
                style={{ fontSize: '16rem', whiteSpace: 'nowrap' }}
              >
                {i + 1} of {palletCount}
              </h2>
            </div>
          </div>
        );
      }
    }
    return p;
  }, [
    customerName,
    street,
    city,
    state,
    zip,
    palletCount,
    unitLines,
    loadNumber,
    totalWeight,
    fontSizePt,
    cityStateZip,
    orderNumber,
    brandColors,
  ]);

  return (
    <div className="flex flex-col items-center w-full min-h-full pt-8 px-1 md:px-4 bg-transparent">
      {/* Standard scaling styles */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
                :root { --preview-scale: 0.28; }
                @media (min-width: 640px) { :root { --preview-scale: 0.32; } }
                @media (min-width: 1024px) { :root { --preview-scale: 0.38; } }
                @media (min-width: 1280px) { :root { --preview-scale: 0.45; } }
                @media (min-width: 1536px) { :root { --preview-scale: 0.52; } }
            `,
        }}
      />

      <div className="w-full mb-8 text-center shrink-0">
        <h2 className="text-3xl md:text-5xl font-[900] text-content tracking-tighter uppercase animate-soft-in">
          Order #{orderNumber}
        </h2>
        {completedAt && (
          <p className="text-muted text-sm font-bold mt-2 tracking-wide animate-soft-in">
            {new Date(completedAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
            {' · '}
            {new Date(completedAt).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
            })}
          </p>
        )}
      </div>

      <div className="w-full flex-1 flex justify-center pb-32">
        <div
          className="grid gap-x-12 gap-y-20 justify-center origin-top h-fit"
          style={{
            gridTemplateColumns:
              pages.length <= 1 ? '297mm' : window.innerWidth < 768 ? '297mm' : 'repeat(2, 297mm)',
            transform: 'scale(var(--preview-scale))',
          }}
        >
          {pages}
        </div>
      </div>
    </div>
  );
};

/** Export the units lines builder for use in PDF generation */
export { unitsLines };
