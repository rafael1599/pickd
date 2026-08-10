import React from 'react';
import Bike from 'lucide-react/dist/esm/icons/bike';
import Package from 'lucide-react/dist/esm/icons/package';
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2';

interface RegisterTypeSelectorProps {
  value: 'bike' | 'part' | null;
  onChange: (type: 'bike' | 'part') => void;
  title?: string;
  subtitle?: string;
  className?: string;
  compact?: boolean;
}

export const RegisterTypeSelector: React.FC<RegisterTypeSelectorProps> = ({
  value,
  onChange,
  title = '¿Qué estás registrando?',
  subtitle = 'Debes elegir obligatoriamente si este registro es una Bicicleta o una Parte / Accesorio',
  className = '',
  compact = false,
}) => {
  return (
    <div className={`space-y-3 ${className}`}>
      {title && (
        <div className="text-center sm:text-left space-y-1 mb-2">
          <label className="text-xs font-black uppercase tracking-widest text-muted block">
            {title} <span className="text-red-400">*</span>
          </label>
          {subtitle && <p className="text-[11px] font-medium text-muted/80">{subtitle}</p>}
        </div>
      )}

      <div className={`grid grid-cols-2 gap-3 ${compact ? 'max-w-md' : 'w-full'}`}>
        {/* BUTTON 1: BICICLETA */}
        <button
          type="button"
          onClick={() => onChange('bike')}
          className={`relative flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all duration-200 text-center active:scale-95 group ${
            value === 'bike'
              ? 'bg-blue-500/15 border-blue-500 text-blue-400 shadow-lg shadow-blue-500/10 ring-2 ring-blue-500/30'
              : 'bg-surface/60 hover:bg-surface border-subtle text-muted hover:text-content hover:border-blue-500/40'
          }`}
        >
          {value === 'bike' && (
            <div className="absolute top-2 right-2 text-blue-400">
              <CheckCircle2 size={16} />
            </div>
          )}
          <div
            className={`w-12 h-12 rounded-xl flex items-center justify-center mb-2 transition-colors ${
              value === 'bike'
                ? 'bg-blue-500 text-white shadow-md'
                : 'bg-muted/10 text-muted group-hover:bg-blue-500/20 group-hover:text-blue-400'
            }`}
          >
            <Bike size={compact ? 22 : 28} />
          </div>
          <span className="text-xs font-black uppercase tracking-wider block text-content">
            BICICLETA
          </span>
          <span className="text-[10px] text-muted font-medium mt-0.5 block leading-tight">
            Unidad completa / Cuadro
          </span>
        </button>

        {/* BUTTON 2: PARTE / ACCESORIO */}
        <button
          type="button"
          onClick={() => onChange('part')}
          className={`relative flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all duration-200 text-center active:scale-95 group ${
            value === 'part'
              ? 'bg-amber-500/15 border-amber-500 text-amber-400 shadow-lg shadow-amber-500/10 ring-2 ring-amber-500/30'
              : 'bg-surface/60 hover:bg-surface border-subtle text-muted hover:text-content hover:border-amber-500/40'
          }`}
        >
          {value === 'part' && (
            <div className="absolute top-2 right-2 text-amber-400">
              <CheckCircle2 size={16} />
            </div>
          )}
          <div
            className={`w-12 h-12 rounded-xl flex items-center justify-center mb-2 transition-colors ${
              value === 'part'
                ? 'bg-amber-500 text-white shadow-md'
                : 'bg-muted/10 text-muted group-hover:bg-amber-500/20 group-hover:text-amber-400'
            }`}
          >
            <Package size={compact ? 22 : 28} />
          </div>
          <span className="text-xs font-black uppercase tracking-wider block text-content">
            PARTE / ACCESORIO
          </span>
          <span className="text-[10px] text-muted font-medium mt-0.5 block leading-tight">
            Saddles, pedales, repuestos
          </span>
        </button>
      </div>
    </div>
  );
};
