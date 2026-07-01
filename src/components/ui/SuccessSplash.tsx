import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import Check from 'lucide-react/dist/esm/icons/check';
import { useSuccessPulse, clearSuccessPulse } from '../../lib/successPulse';

/** Duración total del splash (debe coincidir con la animación CSS `success-splash-fade`). */
const SPLASH_MS = 1200;

/**
 * Overlay central que reproduce el check de PickD al completar acciones clave
 * (ej. terminar una orden). Se dispara con `celebrateSuccess()` desde cualquier
 * parte, se reproduce rápido y se limpia solo — sin cerrar ni deslizar.
 *
 * El ciclo visual (fade in → hold → fade out) es 100% CSS. El único trabajo del
 * effect es limpiar el store al terminar; no hay setState de componente, así que
 * un nuevo pulso simplemente remonta el nodo (via `key`) y reproduce de nuevo.
 *
 * Montar UNA sola vez a nivel raíz (junto a SwipeableToaster).
 */
export const SuccessSplash = () => {
  const pulse = useSuccessPulse();
  const pulseId = pulse?.id;

  useEffect(() => {
    if (pulseId == null) return;
    const timer = setTimeout(clearSuccessPulse, SPLASH_MS);
    return () => clearTimeout(timer);
  }, [pulseId]);

  if (!pulse) return null;

  return createPortal(
    <div
      key={pulse.id}
      className="animate-success-splash pointer-events-none fixed inset-0 z-[200] flex flex-col items-center justify-center"
      aria-live="polite"
      role="status"
    >
      {/* Glow suave detrás del logo */}
      <div className="relative flex items-center justify-center">
        <div className="bg-accent/20 absolute h-40 w-40 rounded-full blur-3xl" />

        {/* Disco con el logo de PickD haciendo el "pop" de marca */}
        <div className="bg-surface/90 border-subtle animate-pickd-check relative flex h-28 w-28 items-center justify-center rounded-[2rem] border shadow-2xl backdrop-blur-xl">
          <img src="/PickD.png" alt="" className="h-16 w-16 object-contain" />

          {/* Badge de check verde en la esquina */}
          <div className="border-surface absolute -bottom-2 -right-2 flex h-9 w-9 items-center justify-center rounded-full border-4 bg-emerald-500 shadow-lg">
            <Check size={16} strokeWidth={3.5} className="text-white" />
          </div>
        </div>
      </div>

      {pulse.message && (
        <p className="text-content mt-6 text-sm font-black uppercase tracking-widest drop-shadow-lg">
          {pulse.message}
        </p>
      )}
    </div>,
    document.body
  );
};
