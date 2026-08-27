import { useEffect, useMemo, useRef, useState } from 'react';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import Printer from 'lucide-react/dist/esm/icons/printer';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import { useNavigate } from 'react-router-dom';

const BASE = '/reports/warehouse-updates/';

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * "What's new" — the printable warehouse updates (reports/warehouse-updates),
 * newest first. Same shape as PickdReportViewer: the HTML is written by hand
 * per update, copied to public/ by the prebuild step, and rendered in an
 * iframe. A <base> is injected so the update's relative images resolve under
 * its own folder, and Print prints the iframe (the page carries print CSS).
 */
export const WhatsNewViewer = () => {
  const navigate = useNavigate();
  const [dates, setDates] = useState<string[] | null>(null);
  const [index, setIndex] = useState(0);
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${BASE}index.json`);
        const list = (await res.json()) as string[];
        setDates([...list].sort().reverse());
      } catch {
        setDates([]);
      }
    })();
  }, []);

  const selected = dates?.[index] ?? null;

  useEffect(() => {
    if (!selected) {
      setLoading(dates === null);
      return;
    }
    setLoading(true);
    setHtml(null);
    void (async () => {
      try {
        const res = await fetch(`${BASE}${selected}.html`);
        if (!res.ok) throw new Error('Not found');
        const text = await res.text();
        setHtml(text.replace(/<head>/i, `<head><base href="${BASE}">`));
      } catch {
        setHtml(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [selected, dates]);

  const title = useMemo(() => (selected ? formatDate(selected) : '—'), [selected]);

  return (
    <div className="flex flex-col min-h-screen bg-[#f5f7fa]">
      <div className="shrink-0 px-4 py-3 bg-white border-b border-gray-200 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors"
            aria-label="Back"
          >
            <ChevronLeft size={20} />
          </button>
          <h1 className="text-sm font-black uppercase tracking-widest text-gray-800 truncate">
            What&apos;s new
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIndex((i) => Math.min(i + 1, (dates?.length ?? 1) - 1))}
            disabled={!dates || index >= dates.length - 1}
            className="p-1.5 hover:bg-gray-100 rounded-full text-gray-500 transition-colors disabled:opacity-30 active:scale-90"
            aria-label="Older update"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-xs font-bold text-gray-700 min-w-[150px] text-center">{title}</span>
          <button
            onClick={() => setIndex((i) => Math.max(i - 1, 0))}
            disabled={index <= 0}
            className="p-1.5 hover:bg-gray-100 rounded-full text-gray-500 transition-colors disabled:opacity-30 active:scale-90"
            aria-label="Newer update"
          >
            <ChevronRight size={18} />
          </button>
          <button
            onClick={() => frameRef.current?.contentWindow?.print()}
            disabled={!html}
            className="ml-1 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-900 text-white text-[11px] font-black uppercase tracking-wider disabled:opacity-30 active:scale-95"
          >
            <Printer size={14} />
            <span className="hidden sm:inline">Print</span>
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-gray-400 w-8 h-8" />
          </div>
        )}
        {!loading && !html && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-gray-400 text-sm font-bold">No updates published yet</p>
          </div>
        )}
        {html && !loading && (
          <iframe
            ref={frameRef}
            srcDoc={html}
            title={`What's new — ${selected ?? ''}`}
            className="w-full border-0 bg-white"
            style={{ minHeight: 'calc(100vh - 60px)' }}
          />
        )}
      </div>
    </div>
  );
};
