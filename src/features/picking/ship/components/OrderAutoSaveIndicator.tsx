import React, { useEffect, useState } from 'react';

interface OrderAutoSaveIndicatorProps {
  status: 'idle' | 'saving' | 'saved' | 'error';
}

export const OrderAutoSaveIndicator: React.FC<OrderAutoSaveIndicatorProps> = ({ status }) => {
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    if (status === 'saved') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowSaved(true);
      const timer = setTimeout(() => setShowSaved(false), 2000);
      return () => clearTimeout(timer);
    } else {
      setShowSaved(false);
    }
  }, [status]);

  const isShown = status === 'saving' || status === 'error' || (status === 'saved' && showSaved);

  return (
    <span
      className="inline-flex items-center gap-1 h-5 transition-all duration-300 ease-in-out"
      style={{
        fontSize: '12px',
        opacity: isShown ? 1 : 0,
        transform: isShown ? 'translateY(0)' : 'translateY(-2px)',
        pointerEvents: 'none',
      }}
    >
      {status === 'saving' && (
        <>
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted animate-pulse" />
          <span className="text-muted">Saving...</span>
        </>
      )}

      {status === 'saved' && (
        <>
          <span className="text-emerald-400">✓</span>
          <span className="text-emerald-400">Saved</span>
        </>
      )}

      {status === 'error' && (
        <>
          <span className="text-red-400">✕</span>
          <span className="text-red-400">Failed</span>
        </>
      )}
    </span>
  );
};
