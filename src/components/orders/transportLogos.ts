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

/** Get text color for carrier display (e.g., red for PICK UP). */
export function getCarrierTextColor(company: string | null | undefined): string {
  const normalized = normalizeCompany(company);
  if (normalized === 'PICK UP') {
    return 'text-red-500';
  }
  return 'text-content/80';
}

export interface CarrierBrandColor {
  border: string;
  ring: string;
  shadow: string;
  hex: string;
}

export const CARRIER_BRAND_COLORS: Record<string, CarrierBrandColor> = {
  FEDEX: {
    border: 'border-purple-500',
    ring: 'ring-purple-500',
    shadow: 'shadow-purple-500/30',
    hex: '#8B5CF6',
  },
  'R+L': {
    border: 'border-emerald-500',
    ring: 'ring-emerald-500',
    shadow: 'shadow-emerald-500/30',
    hex: '#10B981',
  },
  '2-DAY': {
    border: 'border-amber-500',
    ring: 'ring-amber-500',
    shadow: 'shadow-amber-500/30',
    hex: '#F59E0B',
  },
  RIST: {
    border: 'border-blue-500',
    ring: 'ring-blue-500',
    shadow: 'shadow-blue-500/30',
    hex: '#3B82F6',
  },
  TFORCE: {
    border: 'border-red-600',
    ring: 'ring-red-600',
    shadow: 'shadow-red-600/30',
    hex: '#DC2626',
  },
  DAYLIGHT: {
    border: 'border-cyan-500',
    ring: 'ring-cyan-500',
    shadow: 'shadow-cyan-500/30',
    hex: '#06B6D4',
  },
  'PAV EXPRESS': {
    border: 'border-rose-500',
    ring: 'ring-rose-500',
    shadow: 'shadow-rose-500/30',
    hex: '#F43F5E',
  },
  ESTES: {
    border: 'border-teal-500',
    ring: 'ring-teal-500',
    shadow: 'shadow-teal-500/30',
    hex: '#14B8A6',
  },
  'PICK UP': {
    border: 'border-red-500',
    ring: 'ring-red-500',
    shadow: 'shadow-red-500/30',
    hex: '#EF4444',
  },
};

export function getCarrierBrandColors(company: string | null | undefined): CarrierBrandColor {
  const norm = normalizeCompany(company);
  return (
    CARRIER_BRAND_COLORS[norm] ?? {
      border: 'border-accent',
      ring: 'ring-accent',
      shadow: 'shadow-accent/30',
      hex: '#3B82F6',
    }
  );
}
