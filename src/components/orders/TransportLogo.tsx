import { useState } from 'react';
import { transportLogoSrc } from './transportLogos';

interface TransportLogoProps {
  company: string | null | undefined;
  /** Logo height in px (default 20). */
  height?: number;
  /** Extra classes for the wrapper. */
  className?: string;
}

/**
 * Renders a transport company's logo (self-hosted) inside a small white pill so
 * it reads on any theme / colored background. Falls back to the company name as
 * text when no logo is mapped or the image fails to load. Renders nothing for an
 * empty company.
 */
export const TransportLogo = ({ company, height = 20, className = '' }: TransportLogoProps) => {
  const [failed, setFailed] = useState(false);
  const label = (company ?? '').trim();
  const src = transportLogoSrc(company);

  if (!label) return null;

  if (!src || failed) {
    return (
      <span
        className={`text-[11px] font-black uppercase tracking-wider text-content/80 ${className}`}
      >
        {label}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center rounded bg-white px-1.5 py-0.5 ${className}`}
      title={label}
    >
      <img
        src={src}
        alt={label}
        onError={() => setFailed(true)}
        style={{ height }}
        className="w-auto object-contain"
      />
    </span>
  );
};
