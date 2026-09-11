/** How far Double Check has got, as the board draws it (`verificationProgress`). */
export function VerificationBar({
  percent,
  className = '',
}: {
  percent: number;
  className?: string;
}) {
  return (
    <div
      className={`h-2 w-full bg-surface rounded-full overflow-hidden border border-subtle ${className}`}
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Double check progress"
    >
      <div
        className="h-full transition-all duration-500 ease-out"
        style={{
          width: `${percent}%`,
          background:
            'linear-gradient(to right, rgb(59, 130, 246), rgb(6, 182, 212), rgb(16, 185, 129)) 0% 0% / 162.242% 100%',
        }}
      />
    </div>
  );
}
