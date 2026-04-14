import { useState, useEffect } from 'react';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import { useNavigate } from 'react-router-dom';

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export const PickdReportViewer = () => {
  const navigate = useNavigate();
  const [today] = useState(() => {
    // Local NY date approximation (good enough for the viewer)
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  });
  const [selectedDate, setSelectedDate] = useState(today);
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    setLoading(true);
    setNotFound(false);
    setHtmlContent(null);

    fetch(`/reports/daily/${selectedDate}.html`)
      .then((res) => {
        if (!res.ok) throw new Error('Not found');
        return res.text();
      })
      .then((html) => {
        setHtmlContent(html);
        setLoading(false);
      })
      .catch(() => {
        setNotFound(true);
        setLoading(false);
      });
  }, [selectedDate]);

  return (
    <div className="flex flex-col min-h-screen bg-[#f5f7fa]">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 bg-white border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors"
          >
            <ChevronLeft size={20} />
          </button>
          <h1 className="text-sm font-black uppercase tracking-widest text-gray-800">
            PickD Report
          </h1>
        </div>

        {/* Date navigation */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSelectedDate(addDays(selectedDate, -1))}
            className="p-1.5 hover:bg-gray-100 rounded-full text-gray-500 transition-colors active:scale-90"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-xs font-bold text-gray-700 min-w-[160px] text-center">
            {formatDate(selectedDate)}
          </span>
          <button
            onClick={() => setSelectedDate(addDays(selectedDate, 1))}
            disabled={selectedDate >= today}
            className="p-1.5 hover:bg-gray-100 rounded-full text-gray-500 transition-colors disabled:opacity-30 active:scale-90"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-gray-400 w-8 h-8" />
          </div>
        )}

        {notFound && !loading && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-gray-400 text-sm font-bold">No report for {formatDate(selectedDate)}</p>
            <p className="text-gray-300 text-xs mt-1">Reports are generated at the end of each work day.</p>
          </div>
        )}

        {htmlContent && !loading && (
          <iframe
            srcDoc={htmlContent}
            title={`PickD Report — ${selectedDate}`}
            className="w-full border-0"
            style={{ minHeight: 'calc(100vh - 60px)' }}
          />
        )}
      </div>
    </div>
  );
};
