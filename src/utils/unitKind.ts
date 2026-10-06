/**
 * One colour per kind of unit, for the whole app (idea-251,
 * docs/prds/unit-kind-colors.md). A new bike carries no mark: it is the normal
 * case. The chip always says the kind in letters too — colour never goes alone.
 *
 * The colours avoid the ones already taken: amber is a ROW square and «not
 * saved», red an error, green checked. Purple is FedEx, and a return is FedEx.
 */
export type UnitKind = 'new' | 'sd' | 'photo' | 'return';

export interface UnitKindStyle {
  label: string;
  /** Background, text and border of the chip. */
  chip: string;
  /** A solid dot of the same colour (filters). */
  dot: string;
  /** Solid fill, for a light background (the carton label of the item card). */
  solid: string;
}

export const UNIT_KIND_STYLE: Record<Exclude<UnitKind, 'new'>, UnitKindStyle> = {
  sd: {
    label: 'S/D',
    chip: 'bg-orange-500/15 text-orange-400 border-orange-500/40',
    dot: 'bg-orange-500',
    solid: 'bg-orange-500 text-[#111214] border-orange-500',
  },
  photo: {
    label: 'PH',
    chip: 'bg-sky-500/15 text-sky-400 border-sky-500/40',
    dot: 'bg-sky-500',
    solid: 'bg-sky-500 text-[#111214] border-sky-500',
  },
  return: {
    label: 'RET',
    chip: 'bg-purple-500/15 text-purple-400 border-purple-500/40',
    dot: 'bg-purple-500',
    solid: 'bg-purple-500 text-white border-purple-500',
  },
};

/** The style of a kind, or null for a new unit (and anything unknown). */
export function unitKindStyle(kind: string | null | undefined): UnitKindStyle | null {
  if (kind === 'sd' || kind === 'photo' || kind === 'return') return UNIT_KIND_STYLE[kind];
  return null;
}

/**
 * The kind of a catalogue row. `unit_kind` decides; an older read that only
 * carries `is_scratch_dent` still says S/D (the trigger keeps the two in step).
 */
export function unitKindOf(
  meta: { unit_kind?: string | null; is_scratch_dent?: boolean | null } | null | undefined
): UnitKind {
  const k = meta?.unit_kind;
  if (k === 'sd' || k === 'photo' || k === 'return' || k === 'new') {
    return k === 'new' && meta?.is_scratch_dent ? 'sd' : k;
  }
  return meta?.is_scratch_dent ? 'sd' : 'new';
}
