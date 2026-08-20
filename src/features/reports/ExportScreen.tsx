// /export — where files leave Pickd for another system.
//
// Today that is one file: the FedEx Ship Manager Dimensions table. It lived in
// Settings while it was the only one, which made it a thing you found by
// scrolling past the theme toggle. It is an operational task with a queue of
// unmeasured SKUs attached, so it gets a screen.

import { useNavigate } from 'react-router-dom';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import Upload from 'lucide-react/dist/esm/icons/upload';
import { FedexDimensionsExportCard } from './components/FedexDimensionsExportCard';

export function ExportScreen() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-main">
      <header className="sticky top-0 z-10 bg-surface border-b border-subtle px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          aria-label="Go back"
          className="p-2 bg-surface border border-subtle rounded-xl text-muted hover:text-content active:scale-90 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tighter leading-none text-content">
            Export
          </h1>
          <p className="text-[10px] text-muted font-black uppercase tracking-widest">
            Files for other systems
          </p>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-3 sm:px-6 py-6 pb-32">
        <FedexDimensionsExportCard />

        <div className="flex items-center gap-3 px-6 py-5 border-2 border-dashed border-subtle rounded-3xl">
          <Upload className="text-muted opacity-30 flex-shrink-0" size={20} />
          <p className="text-xs text-muted font-medium">
            Other exports land here as they are built.
          </p>
        </div>
      </div>
    </div>
  );
}
