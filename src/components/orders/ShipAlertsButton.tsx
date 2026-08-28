/**
 * One pulsing button for the order's alerts, one or two words each.
 *
 * Rafael, 2026-08-27 (idea-161): "juntemos lithium battery y otras alertas a
 * un botón pulsante que diga en una palabra, máximo 2, lo que contiene".
 * Three full-size banners stacked on the card taught the station to read
 * none; this is one pill — LITHIUM, PAV ZONE, or "2 ALERTS" — that pulses
 * until the order ships. A tap opens the alerts' own content (the label
 * instructions, the manual button, the dismiss) in `ShipAlertsPanel`, which
 * the card places under the address so the pill can sit beside the name.
 *
 * What is NOT here, on purpose: the Daylight "text the dispatcher" reminder
 * lives in the carrier row where Rafael placed it (28 Aug), and the combine
 * suggestion is an offer, not an alert.
 */
import React from 'react';
import TriangleAlert from 'lucide-react/dist/esm/icons/triangle-alert';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';

export interface ShipAlert {
  key: string;
  /** One or two words, uppercase on screen: Lithium, PAV zone. */
  label: string;
  tone: 'amber' | 'red';
  /** The alert's own banner, shown in the panel when the button is open. */
  content: React.ReactNode;
}

/** What the pill says: the one alert's word, or how many there are. */
export function shipAlertsLabel(alerts: readonly ShipAlert[]): string | null {
  if (alerts.length === 0) return null;
  if (alerts.length === 1) return alerts[0].label;
  return `${alerts.length} alerts`;
}

interface ShipAlertsButtonProps {
  alerts: ShipAlert[];
  /** The dot pulses while the order is still in the building. */
  pulse: boolean;
  open: boolean;
  onToggle: () => void;
  className?: string;
}

export const ShipAlertsButton: React.FC<ShipAlertsButtonProps> = ({
  alerts,
  pulse,
  open,
  onToggle,
  className = '',
}) => {
  const label = shipAlertsLabel(alerts);
  if (!label) return null;
  const red = alerts.some((a) => a.tone === 'red');
  const tone = red
    ? 'border-red-500/50 bg-red-500/10 text-red-500 hover:bg-red-500/20'
    : 'border-amber-500/50 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20';
  const dot = red ? 'bg-red-500' : 'bg-amber-500';

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      title={alerts.map((a) => a.label).join(' · ')}
      className={`inline-flex items-center gap-2 h-8 px-3 rounded-full border text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all active:scale-95 ${tone} ${className}`}
    >
      <span className="relative flex shrink-0 h-2 w-2">
        {pulse && (
          <span
            className={`absolute inline-flex h-full w-full rounded-full opacity-75 motion-safe:animate-ping ${dot}`}
          />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${dot}`} />
      </span>
      <TriangleAlert size={12} />
      {label}
      <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
  );
};

/** The alerts' own banners, one under the other — rendered where the card wants them. */
export const ShipAlertsPanel: React.FC<{ alerts: ShipAlert[] }> = ({ alerts }) => {
  if (alerts.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 w-full">
      {alerts.map((a) => (
        <React.Fragment key={a.key}>{a.content}</React.Fragment>
      ))}
    </div>
  );
};
