import type { OrderRow } from '../hooks/useOrdersOfDay';
import { transportLogoSrc } from '../../../components/orders/transportLogos';

/** Escapes the five HTML-significant characters for safe interpolation. */
function esc(value: string | number | null | undefined): string {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** `Jul 8, 2026` style date (or em-dash when unparseable). */
function formatDate(source: string | null | undefined): string {
  if (!source) return '—';
  const d = new Date(source);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** `Jul 8 · 12:48 PM` style timestamp (or em-dash when unparseable). */
function formatDateTime(source: string | null | undefined): string {
  if (!source) return '—';
  const d = new Date(source);
  if (Number.isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

/**
 * Opens a new window with a clean, black-and-white packing slip for the given
 * order and triggers the browser print dialog. Fully synchronous — reads only
 * from `order` (in-app notes are intentionally excluded, they'd require an
 * async fetch). `opts` carries the pre-computed bikes/parts split.
 */
export function printOrderDetail(order: OrderRow, opts: { bikes: number; parts: number }): void {
  const win = window.open('', '_blank');
  if (win === null) return;

  const orderNumber = order.order_number || order.id.slice(-6);

  const cityLine = [order.customer?.city, order.customer?.state, order.customer?.zip_code]
    .filter(Boolean)
    .join(', ');

  const summaryParts: string[] = [];
  if ((order.pallets_qty ?? 0) > 0) summaryParts.push(`Pallets: ${order.pallets_qty}`);
  if (opts.bikes > 0) summaryParts.push(`Bikes: ${opts.bikes}`);
  if (opts.parts > 0) summaryParts.push(`Parts: ${opts.parts}`);
  if ((order.total_weight_lbs ?? 0) > 0) summaryParts.push(`Weight: ${order.total_weight_lbs} lbs`);

  // Transport: prefer the carrier logo (absolute URL — a new window has no base
  // URL to resolve a root-relative path). Falls back to the plain name.
  const logoPath = transportLogoSrc(order.transport_company);

  const summaryPieces = summaryParts.map(esc);
  const summaryHtml = summaryPieces.length
    ? `<div class="summary">${summaryPieces.join('  •  ')}</div>`
    : '';

  const photos = order.pallet_photos ?? [];
  const photosHtml = photos.length
    ? `<div class="block"><h2>Photos</h2><div class="photos">${photos
        .map((url) => `<img src="${esc(url)}" alt="" />`)
        .join('')}</div></div>`
    : '';

  const rows = (order.items ?? [])
    .map((item) => {
      const qty = item.pickingQty ?? 0;
      const sku = item.sku || item.raw_sku || '—';
      const desc = item.description || item.item_name || '—';
      const location = item.location || '—';
      const sublocation = (item.sublocation ?? []).join('') || '—';
      return `<tr>
        <td class="qty">${esc(qty)}</td>
        <td class="mono">${esc(sku)}</td>
        <td>${esc(desc)}</td>
        <td class="mono">${esc(location)}</td>
        <td class="mono">${esc(sublocation)}</td>
      </tr>`;
    })
    .join('');

  const metaRows: string[] = [
    `<div><strong>Order date:</strong> ${esc(formatDate(order.source_order_date))}</div>`,
    `<div><strong>Completed:</strong> ${esc(formatDateTime(order.updated_at))}</div>`,
  ];
  if (order.load_number)
    metaRows.push(`<div><strong>Load #:</strong> ${esc(order.load_number)}</div>`);
  if (order.user?.full_name)
    metaRows.push(`<div><strong>Picked by:</strong> ${esc(order.user.full_name)}</div>`);
  if (order.checker?.full_name)
    metaRows.push(`<div><strong>Checked by:</strong> ${esc(order.checker.full_name)}</div>`);

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Order #${esc(orderNumber)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #000;
      background: #fff;
      margin: 32px;
      font-size: 13px;
      line-height: 1.4;
    }
    h1 { font-size: 22px; margin: 0 0 16px; text-transform: uppercase; letter-spacing: 0.5px; }
    h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #555; margin: 20px 0 6px; }
    .block { margin-bottom: 8px; }
    .block div { margin-bottom: 2px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
    .header .block { margin-bottom: 8px; }
    .details { text-align: right; }
    .details h2 { margin-top: 0; }
    .summary { font-weight: bold; margin: 8px 0 4px; }
    .summary .tlogo { height: 22px; vertical-align: middle; }
    .carrier-logo { display: flex; align-items: center; justify-content: center; align-self: center; flex: 1; text-align: center; }
    .pdf-tlogo { height: 80px; width: auto; object-fit: contain; }
    .carrier-logo.text-fallback { font-size: 24px; font-weight: bold; text-transform: uppercase; color: #333; }
    .notes { border: 1px solid #000; padding: 8px 10px; white-space: pre-wrap; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #ccc; vertical-align: top; }
    th { border-bottom: 2px solid #000; text-transform: uppercase; font-size: 10px; letter-spacing: 1px; }
    .qty { text-align: right; width: 48px; font-variant-numeric: tabular-nums; }
    .mono { font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; }
    .photos { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .photos img { width: 100%; height: 280px; object-fit: cover; border: 1px solid #ccc; }
    @media print {
      body { margin: 0; }
      @page { margin: 16mm; }
    }
  </style>
</head>
<body>
  <h1>Order #${esc(orderNumber)}</h1>

  <div class="header">
    <div class="block ship-to">
      <h2>Ship To</h2>
      <div><strong>${esc(order.customer?.name || '—')}</strong></div>
      ${order.customer?.street ? `<div>${esc(order.customer.street)}</div>` : ''}
      ${cityLine ? `<div>${esc(cityLine)}</div>` : ''}
      ${order.customer?.phone ? `<div>${esc(order.customer.phone)}</div>` : ''}
    </div>

    ${
      order.transport_company
        ? logoPath
          ? `<div class="block carrier-logo">
            <img class="pdf-tlogo" src="${esc(window.location.origin + logoPath)}" alt="${esc(order.transport_company)}" />
           </div>`
          : `<div class="block carrier-logo text-fallback">
            <span>${esc(order.transport_company)}</span>
           </div>`
        : '<div class="block carrier-logo"></div>'
    }

    <div class="block details">
      <h2>Details</h2>
      ${metaRows.join('\n      ')}
    </div>
  </div>

  ${summaryHtml}

  ${
    order.notes
      ? `<div class="block"><h2>Order notes</h2><div class="notes">${esc(order.notes)}</div></div>`
      : ''
  }

  <h2>Items</h2>
  <table>
    <thead>
      <tr>
        <th class="qty">Qty</th>
        <th>SKU</th>
        <th>Description</th>
        <th>Location</th>
        <th>Sublocation</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>

  ${photosHtml}

  <script>
    (function () {
      function go() { try { window.focus(); } catch (e) {} window.print(); }
      var imgs = document.images;
      if (!imgs || imgs.length === 0) { window.addEventListener('load', go); return; }
      var remaining = imgs.length;
      function done() { if (--remaining <= 0) go(); }
      for (var i = 0; i < imgs.length; i++) {
        var im = imgs[i];
        if (im.complete) { done(); }
        else { im.addEventListener('load', done); im.addEventListener('error', done); }
      }
    })();
  </script>
</body>
</html>`;

  win.document.write(html);
  win.document.close();
}
