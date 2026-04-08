import React, { useEffect, useRef, useState } from 'react';
import Printer from 'lucide-react/dist/esm/icons/printer';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';

interface FloatingActionButtonsProps {
  onPrint: () => void;
  onNext: () => void;
  onPrevious: () => void;
  isPrinting: boolean;
  hasOrders: boolean;
  pressedKey?: 'left' | 'right' | null;
}

export const FloatingActionButtons: React.FC<FloatingActionButtonsProps> = ({
  onPrint,
  onNext,
  onPrevious,
  isPrinting,
  hasOrders,
  pressedKey,
}) => {
  const [glowKey, setGlowKey] = useState<'left' | 'right' | null>(null);
  const [glowId, setGlowId] = useState(0);
  const glowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (pressedKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing glow from pressedKey prop
      setGlowKey(pressedKey);
      setGlowId((prev) => prev + 1);
      if (glowTimer.current) clearTimeout(glowTimer.current);
      glowTimer.current = setTimeout(() => setGlowKey(null), 2000);
    }
    return () => {
      if (glowTimer.current) clearTimeout(glowTimer.current);
    };
  }, [pressedKey]);

  if (!hasOrders) return null;

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
                @keyframes glow-green {
                    0%   { box-shadow: 0 0 0 6px rgba(34,197,94,0.8), 0 0 24px 8px rgba(34,197,94,0.4); }
                    100% { box-shadow: 0 0 0 0px rgba(34,197,94,0),   0 0 0px  0px rgba(34,197,94,0); }
                }
                .btn-glow-green { animation: glow-green 2s ease-out forwards; }
            `,
        }}
      />
      <div className="flex items-center gap-3 p-3 bg-card backdrop-blur-2xl border border-subtle rounded-[2.5rem] shadow-2xl">
        {/* Previous Button */}
        <button
          onClick={onPrevious}
          className={`flex items-center justify-center w-14 h-14 bg-surface hover:bg-main text-accent-blue rounded-full transition-all active:scale-90 border border-subtle
                        ${pressedKey === 'left' ? 'scale-90 bg-accent-blue/10' : ''}
                        ${glowKey === 'left' ? 'btn-glow-green' : ''}
                    `}
          title="Previous Order"
          key={glowKey === 'left' ? `prev-glow-${glowId}` : 'prev'}
        >
          <ChevronLeft className="w-8 h-8" />
        </button>

        {/* Print Labels Button */}
        <button
          onClick={onPrint}
          disabled={isPrinting}
          className={`
                        flex items-center gap-3 px-10 py-4 bg-accent hover:opacity-90 text-main font-[900] text-xl rounded-full ios-transition shadow-xl active:scale-95 disabled:opacity-50
                        ${isPrinting ? 'animate-pulse' : ''}
                    `}
        >
          {isPrinting ? (
            <Loader2 className="animate-spin w-7 h-7" />
          ) : (
            <Printer className="w-7 h-7" />
          )}
          <span className="tracking-tight uppercase">
            {isPrinting ? 'Preparing...' : 'Print Labels'}
          </span>
        </button>

        {/* Next Button */}
        <button
          onClick={onNext}
          className={`flex items-center justify-center w-14 h-14 bg-surface hover:bg-main text-accent-blue rounded-full transition-all shadow-xl active:scale-90 border border-subtle
                        ${pressedKey === 'right' ? 'scale-90 bg-accent-blue/10' : ''}
                        ${glowKey === 'right' ? 'btn-glow-green' : ''}
                    `}
          title="Next Order"
          key={glowKey === 'right' ? `next-glow-${glowId}` : 'next'}
        >
          <ChevronRight className="w-8 h-8" />
        </button>
      </div>
    </>
  );
};
