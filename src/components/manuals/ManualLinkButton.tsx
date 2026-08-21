/**
 * "Read the procedure" — the one way a screen links into a manual.
 *
 * The `slug` is typed as {@link ManualSlug}, so a link to a manual that does
 * not exist fails to build. That is the whole reason this is three lines of
 * navigation rather than a lookup: an earlier version matched manuals by title
 * at runtime and fell back to the index when it missed, which meant a renamed
 * manual quietly degraded into a dead-end button that still looked fine.
 *
 * Manuals ship with the build (`src/content/manuals`), so there is nothing to
 * fetch, nothing to cache, and no state where the button is not ready yet.
 */
import { useNavigate } from 'react-router-dom';
import BookOpen from 'lucide-react/dist/esm/icons/book-open';
import { manualRoute, type ManualSlug } from '../../content/manuals';

/** Matches the tone of the surface it sits on. */
export type ManualLinkTone = 'amber' | 'neutral';

const TONE_CLASSES: Record<ManualLinkTone, string> = {
  amber: 'bg-amber-600 text-white shadow-sm hover:bg-amber-500',
  neutral: 'border border-subtle text-content hover:bg-subtle',
};

interface ManualLinkButtonProps {
  slug: ManualSlug;
  /** What the button says. Name the task, not the document: an operator looks
   *  for "how to ship e-bikes", not for "manual". */
  label: string;
  tone?: ManualLinkTone;
  className?: string;
}

export const ManualLinkButton: React.FC<ManualLinkButtonProps> = ({
  slug,
  label,
  tone = 'neutral',
  className = '',
}) => {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      onClick={() => navigate(manualRoute(slug))}
      className={`px-2.5 h-7 inline-flex items-center gap-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all ${TONE_CLASSES[tone]} ${className}`}
    >
      <BookOpen size={11} />
      {label}
    </button>
  );
};
