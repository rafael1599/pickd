import React from 'react';
import shippedImg from '../../assets/shipped.png';
import shippedFedexImg from '../../assets/shipped-fedex.png';

interface ShippedTruckBadgeProps {
  /** FedEx orders show the dedicated truck logo; others the generic one. */
  isFedex?: boolean | null;
  className?: string;
}

/**
 * Animated shipped badge for the Ship screen header. The truck drives in from
 * the left edge of the screen, brakes with a small recoil + engine rumble, and
 * trails a couple of exhaust puffs. The animation replays whenever the caller
 * remounts it (use a `key` on the order id). Motion is defined in index.css and
 * disabled under `prefers-reduced-motion`.
 */
export const ShippedTruckBadge: React.FC<ShippedTruckBadgeProps> = ({
  isFedex,
  className = '',
}) => {
  return (
    <div className={`truck-arrival inline-flex items-center shrink-0 ${className}`}>
      <span className="truck-smoke" aria-hidden="true" />
      <span className="truck-smoke" aria-hidden="true" />
      <span className="truck-smoke" aria-hidden="true" />
      <img
        src={isFedex ? shippedFedexImg : shippedImg}
        alt={isFedex ? 'Shipped via FedEx' : 'Shipped'}
        className="truck-rig h-12 w-auto object-contain shrink-0"
      />
    </div>
  );
};
