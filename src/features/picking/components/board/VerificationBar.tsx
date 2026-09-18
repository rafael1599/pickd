import Package from 'lucide-react/dist/esm/icons/package';

/** How far Double Check has got, as the board draws it (`verificationProgress`). */
export function VerificationBar({
  percent,
  className = '',
}: {
  percent: number;
  className?: string;
}) {
  // Bouncing box while active, still and green once done — same treatment
  // as OrderProgressBar (Rafael, 18 sep 2026), so a board full of finished
  // cards isn't all bouncing at once.
  const moving = percent > 0 && percent < 100;

  return (
    <div
      className={`relative flex w-full items-center py-1 ${className}`}
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Double check progress"
    >
      <div className="h-2 w-full bg-surface rounded-full overflow-hidden border border-subtle">
        <div
          className="h-full transition-all duration-500 ease-out"
          style={{
            width: `${percent}%`,
            background:
              'linear-gradient(to right, rgb(59, 130, 246), rgb(6, 182, 212), rgb(16, 185, 129)) 0% 0% / 162.242% 100%',
          }}
        />
      </div>
      {percent > 0 && (
        <div
          className="pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 transition-all duration-500 ease-out"
          style={{ left: `${Math.max(4, Math.min(percent, 96))}%` }}
        >
          <div
            className={`rounded border border-subtle bg-card p-0.5 shadow-sm ${
              moving ? 'text-accent motion-safe:animate-bounce' : 'text-emerald-400'
            }`}
          >
            <Package size={11} strokeWidth={2.5} />
          </div>
        </div>
      )}
    </div>
  );
}
