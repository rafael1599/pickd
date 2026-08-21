import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import { ManualDocument } from './components/ManualDocument.tsx';
import { getManualBySlug } from '../../content/manuals/index.ts';

export const ManualDetailScreen: React.FC = () => {
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  // Static content: there is no loading state to render, and a wrong slug is
  // known on the first frame rather than after a round-trip.
  const manual = getManualBySlug(slug);

  return (
    <div className="p-4 max-w-2xl mx-auto pb-32">
      <div className="flex items-start gap-3 mb-5">
        <button
          onClick={() => navigate('/manuals')}
          className="p-2 hover:bg-card rounded-xl text-muted hover:text-content transition-colors shrink-0"
          aria-label="Back to manuals"
        >
          <ArrowLeft size={20} />
        </button>

        {manual && (
          <div className="min-w-0 flex-1 pt-1">
            <h1 className="text-lg font-black text-content tracking-tight leading-snug">
              {manual.title}
            </h1>
            <p className="text-[10px] text-muted font-bold uppercase tracking-widest mt-0.5">
              {manual.category}
            </p>
          </div>
        )}
      </div>

      {manual ? (
        <ManualDocument content={manual.content} />
      ) : (
        <div className="text-center py-12 px-4">
          <p className="text-sm text-muted">This manual doesn&apos;t exist.</p>
          <button
            onClick={() => navigate('/manuals')}
            className="mt-3 px-3 py-2 rounded-xl bg-accent text-white text-xs font-bold uppercase tracking-tight"
          >
            See all manuals
          </button>
        </div>
      )}
    </div>
  );
};
