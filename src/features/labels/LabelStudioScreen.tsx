import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import Tag from 'lucide-react/dist/esm/icons/tag';

import { UnifiedLabelForm } from './components/UnifiedLabelForm';
import { HistoryMode } from './components/HistoryMode';

export const LabelStudioScreen = () => {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<'create' | 'history'>('create');

  const handleBack = () => {
    if (viewMode === 'history') {
      setViewMode('create');
    } else {
      navigate(-1);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-main">
      {/* Header */}
      <div className="print:hidden shrink-0 px-4 pt-4 pb-2">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <button onClick={handleBack} className="p-2 hover:bg-white/10 rounded-full text-muted">
              {viewMode === 'create' ? <ChevronLeft size={24} /> : <ArrowLeft size={24} />}
            </button>
            <h1 className="text-lg font-black uppercase tracking-widest text-content">
              Label Studio
            </h1>
          </div>
          <button
            onClick={() => setViewMode((v) => (v === 'create' ? 'history' : 'create'))}
            className={`p-2 rounded-full ${
              viewMode === 'history' ? 'text-accent bg-accent/10' : 'text-muted hover:bg-white/10'
            }`}
          >
            <Tag size={20} />
          </button>
        </div>
      </div>

      {/* Content */}
      {viewMode === 'create' ? <UnifiedLabelForm /> : <HistoryMode />}
    </div>
  );
};
