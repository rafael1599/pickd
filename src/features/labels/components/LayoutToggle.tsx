interface LayoutToggleProps {
  layout: 'standard' | 'vertical';
  onLayoutChange: (layout: 'standard' | 'vertical') => void;
  sdPrefix: boolean;
  onSdChange: (sd: boolean) => void;
}

function MiniLines({ vertical }: { vertical?: boolean }) {
  return (
    <div
      className={`flex flex-col gap-0.5 ${vertical ? 'items-center justify-center' : 'items-start justify-center'}`}
      style={{ width: '100%', height: '100%', padding: vertical ? 4 : 3 }}
    >
      <div
        className="bg-current opacity-40 rounded-sm"
        style={{
          width: vertical ? '60%' : '70%',
          height: vertical ? 2 : 3,
        }}
      />
      <div
        className="bg-current opacity-25 rounded-sm"
        style={{
          width: vertical ? '40%' : '50%',
          height: vertical ? 2 : 2,
        }}
      />
      <div
        className="bg-current opacity-15 rounded-sm"
        style={{
          width: vertical ? '50%' : '30%',
          height: vertical ? 2 : 2,
        }}
      />
    </div>
  );
}

export function LayoutToggle({ layout, onLayoutChange, sdPrefix, onSdChange }: LayoutToggleProps) {
  return (
    <div className="flex flex-col gap-3">
      {/* Layout cards */}
      <div className="flex gap-3">
        {/* Standard (landscape) */}
        <button
          type="button"
          onClick={() => onLayoutChange('standard')}
          className={`flex flex-col items-center gap-1.5 transition-all active:scale-95 ${
            layout === 'standard' ? 'opacity-100' : 'opacity-50'
          }`}
        >
          <div
            className={`rounded-md border text-content ${
              layout === 'standard'
                ? 'ring-2 ring-accent bg-card border-accent'
                : 'bg-surface border-subtle'
            }`}
            style={{ width: 48, height: 32 }}
          >
            <MiniLines />
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
            Standard
          </span>
        </button>

        {/* Vertical (portrait) */}
        <button
          type="button"
          onClick={() => onLayoutChange('vertical')}
          className={`flex flex-col items-center gap-1.5 transition-all active:scale-95 ${
            layout === 'vertical' ? 'opacity-100' : 'opacity-50'
          }`}
        >
          <div
            className={`rounded-md border text-content ${
              layout === 'vertical'
                ? 'ring-2 ring-accent bg-card border-accent'
                : 'bg-surface border-subtle'
            }`}
            style={{ width: 32, height: 48 }}
          >
            <MiniLines vertical />
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
            Vertical
          </span>
        </button>
      </div>

      {/* S/D toggle */}
      <button
        type="button"
        onClick={() => onSdChange(!sdPrefix)}
        className={`inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider transition-all active:scale-95 w-fit ${
          sdPrefix ? 'bg-accent text-white' : 'bg-surface text-muted border border-subtle'
        }`}
      >
        S/D
      </button>
    </div>
  );
}
