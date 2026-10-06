import { unitKindStyle } from '../../utils/unitKind';

interface UnitKindChipProps {
  kind: string | null | undefined;
  className?: string;
  /** Filled, for a light background (the carton label). */
  solid?: boolean;
}

/** S/D · PH · RET in its colour (idea-251); nothing for a new unit. */
export function UnitKindChip({ kind, className = '', solid = false }: UnitKindChipProps) {
  const style = unitKindStyle(kind);
  if (!style) return null;
  return (
    <span
      data-testid="unit-kind-chip"
      data-kind={kind}
      className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] font-black uppercase leading-none tracking-widest ${solid ? style.solid : style.chip} ${className}`}
    >
      {style.label}
    </span>
  );
}
