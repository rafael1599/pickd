import React, { useRef, useState, useCallback } from 'react';
import { toast, Toaster, ToastBar, type Toast } from 'react-hot-toast';
import X from 'lucide-react/dist/esm/icons/x';
import { useToastHistoryRecorder } from '../../lib/notificationHistory';

const SWIPE_THRESHOLD = 50;

interface SwipeableToastWrapperProps {
  t: Toast;
  children: React.ReactNode;
}

const SwipeableToastWrapper: React.FC<SwipeableToastWrapperProps> = ({ t, children }) => {
  const startPos = useRef({ x: 0, y: 0 });
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDismissing, setIsDismissing] = useState(false);
  const [swipeDir, setSwipeDir] = useState<'x' | 'y' | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    startPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    setSwipeDir(null);
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const dx = e.touches[0].clientX - startPos.current.x;
      const dy = e.touches[0].clientY - startPos.current.y;

      // Lock direction on first significant move
      if (!swipeDir) {
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
          setSwipeDir(Math.abs(dx) > Math.abs(dy) ? 'x' : 'y');
        }
        return;
      }

      if (swipeDir === 'x') {
        setOffset({ x: dx, y: 0 });
      } else {
        // Only allow swipe up (negative y)
        setOffset({ x: 0, y: Math.min(0, dy) });
      }
    },
    [swipeDir]
  );

  const handleTouchEnd = useCallback(() => {
    const { x, y } = offset;
    if (Math.abs(x) > SWIPE_THRESHOLD || y < -SWIPE_THRESHOLD) {
      setIsDismissing(true);
      setTimeout(() => toast.dismiss(t.id), 200);
    } else {
      setOffset({ x: 0, y: 0 });
    }
    setSwipeDir(null);
  }, [offset, t.id]);

  const dismissDirection = isDismissing
    ? offset.x !== 0
      ? offset.x > 0
        ? 'translateX(120%)'
        : 'translateX(-120%)'
      : 'translateY(-120%)'
    : `translate(${offset.x}px, ${offset.y}px)`;

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        transform: dismissDirection,
        transition:
          isDismissing || (offset.x === 0 && offset.y === 0)
            ? 'transform 0.2s ease-out, opacity 0.2s ease-out'
            : 'none',
        opacity: isDismissing ? 0 : 1,
        cursor: 'grab',
        touchAction: 'none',
      }}
    >
      {children}
    </div>
  );
};

export const SwipeableToaster: React.FC = () => {
  // Graba cada toast en el historial persistente (revisable desde Settings).
  useToastHistoryRecorder();

  return (
    <Toaster
      position="top-center"
      toastOptions={{
        // Feedback rápido y poco intrusivo. Los errores duran un poco más
        // para alcanzar a leerlos; el historial guarda todo por si acaso.
        duration: 1200,
        success: { duration: 1200 },
        error: { duration: 2500 },
        loading: { duration: Infinity },
        style: {
          background: '#1a1a22',
          color: '#fff',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '1.25rem',
          fontSize: '14px',
          fontWeight: 600,
          padding: '12px 16px',
          boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
          maxWidth: '420px',
        },
      }}
    >
      {(t) => (
        <SwipeableToastWrapper t={t}>
          <ToastBar
            toast={t}
            style={{ ...t.style, padding: 0, background: 'transparent', boxShadow: 'none' }}
          >
            {({ icon, message }) => (
              <div className="flex items-center gap-2 w-full">
                {icon}
                <div className="flex-1 text-sm">{message}</div>
                {t.type !== 'loading' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toast.dismiss(t.id);
                    }}
                    className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full hover:bg-white/10 text-white/30 hover:text-white/60 transition-all active:scale-90"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            )}
          </ToastBar>
        </SwipeableToastWrapper>
      )}
    </Toaster>
  );
};
