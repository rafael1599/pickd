// Maps canonical `transport_company` values to locally-hosted logo assets.
//
// Logos live in `public/logos/transport/` — self-hosted on purpose. Hotlinking
// the carriers' own URLs would break (404 / anti-hotlink) and, worse, taint
// canvas/PDF exports with cross-origin images (a recurring bug). Same-origin
// assets sidestep both.
//
// Keys are the EXACT strings stored in the DB (see OrderSidebar's
// TRANSPORT_COMPANIES). Any company without a logo here (or whose image fails
// to load) falls back to its plain name via <TransportLogo>.
export const TRANSPORT_LOGOS: Record<string, string> = {
  'R+L': '/logos/transport/rl.png',
  '2-DAY': '/logos/transport/2day.png',
  RIST: '/logos/transport/rist.png',
  TFORCE: '/logos/transport/tforce.png',
  DAYLIGHT: '/logos/transport/daylight.webp',
  'PAV EXPRESS': '/logos/transport/pav.png',
  ESTES: '/logos/transport/estes.png',
  FEDEX: '/logos/transport/fedex.png',
};

/** Normalizes a stored company value to its canonical map key. */
export function normalizeCompany(company: string | null | undefined): string {
  return (company ?? '').trim().toUpperCase();
}

/** Absolute-or-root logo path for a company, or null when none is mapped. */
export function transportLogoSrc(company: string | null | undefined): string | null {
  return TRANSPORT_LOGOS[normalizeCompany(company)] ?? null;
}
