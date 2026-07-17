import { useState } from 'react';
import { transportLogoSrc } from './transportLogos';

interface TransportLogoProps {
  company: string | null | undefined;
  /** Logo height in px (default 20). */
  height?: number;
  /** Extra classes for the wrapper. */
  className?: string;
  /**
   * When true, renders the `<img>` directly without the white pill wrapper.
   * Use this when the parent provides its own container / background.
   */
  plain?: boolean;
  /** Optional color for text fallback (e.g., 'text-red-500' for PICK UP). */
  textColor?: string;
}

/**
 * Renders a transport company's logo (self-hosted) inside a small white pill so
 * it reads on any theme / colored background. Falls back to the company name as
 * text when no logo is mapped or the image fails to load. Renders nothing for an
 * empty company.
 */
export const TransportLogo = ({
  company,
  height,
  className = '',
  plain = false,
  textColor = 'text-content/80',
}: TransportLogoProps) => {
  const [failed, setFailed] = useState(false);
  const label = (company ?? '').trim();
  const src = transportLogoSrc(company);

  if (!label) return null;

  const hasHeightClass = className.split(' ').some((c) => c.startsWith('h-'));
  const finalHeight = height ?? (hasHeightClass ? undefined : 20);
  const styleObj = finalHeight !== undefined ? { height: finalHeight } : {};

  if (!src || failed) {
    return (
      <span
        className={`text-[11px] font-black uppercase tracking-wider ${textColor} inline-flex items-center justify-center text-center ${className}`}
      >
        {label}
      </span>
    );
  }

  if (plain) {
    return (
      <img
        src={src}
        alt={label}
        onError={() => setFailed(true)}
        style={styleObj}
        className={`w-auto object-contain ${className}`}
      />
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
        style={styleObj}
        className="w-auto object-contain"
      />
    </span>
  );
};
