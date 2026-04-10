import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Printer from 'lucide-react/dist/esm/icons/printer';
import Copy from 'lucide-react/dist/esm/icons/copy';
import Check from 'lucide-react/dist/esm/icons/check';
import Plus from 'lucide-react/dist/esm/icons/plus';
import X from 'lucide-react/dist/esm/icons/x';
import { useActivityReport, useActiveProfiles } from './hooks/useActivityReport';
import { ActivityReportView } from './components/ActivityReportView';
import { useReportTasks } from '../projects/hooks/useProjectReportData';

function formatDateNav(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

interface UserNote {
  id: string;
  full_name: string;
  text: string;
}

const ROUTINE_ITEMS = [
  'Cleanup / trash',
  'Sweeping',
  'Receiving — Uline',
  'Receiving — container',
  'Receiving — FedEx',
  'Receiving — pallets',
  'General organization',
];

export const ActivityReportScreen = () => {
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState(today);
  const [notes, setNotes] = useState<UserNote[]>([]);
  const [noteUser, setNoteUser] = useState('');
  const [noteText, setNoteText] = useState('');
  const [winOfTheDay, setWinOfTheDay] = useState('');
  const [pickdUpdatesText, setPickdUpdatesText] = useState('');
  const [routineChecklist, setRoutineChecklist] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const { data: report, isLoading, error } = useActivityReport(selectedDate);
  const { data: profiles } = useActiveProfiles();
  const { data: reportTasks } = useReportTasks(selectedDate);

  const pickdUpdates = pickdUpdatesText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const doneToday = reportTasks?.doneToday ?? [];
  const inProgress = reportTasks?.inProgress ?? [];
  const comingUpNext = reportTasks?.comingUpNext ?? [];

  const handleDateChange = useCallback((newDate: string) => {
    setSelectedDate(newDate);
    setNotes([]);
    setWinOfTheDay('');
    setPickdUpdatesText('');
    setRoutineChecklist([]);
  }, []);

  const handleAddNote = useCallback(() => {
    if (!noteText.trim() || !noteUser) return;
    const profile = profiles?.find((p) => p.id === noteUser);
    if (!profile) return;
    setNotes((prev) => [
      ...prev,
      { id: noteUser, full_name: profile.full_name, text: noteText.trim() },
    ]);
    setNoteText('');
  }, [noteUser, noteText, profiles]);

  const handleRemoveNote = useCallback((index: number) => {
    setNotes((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleToggleRoutine = useCallback((item: string) => {
    setRoutineChecklist((prev) =>
      prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]
    );
  }, []);

  const handleCopy = useCallback(() => {
    const reportEl = document.getElementById('report-content');
    if (!reportEl) return;
    const range = document.createRange();
    range.selectNodeContents(reportEl);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.execCommand('copy');
    selection?.removeAllRanges();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const accuracyRaw =
    report && report.total_skus > 0
      ? (report.verified_skus_2m / report.total_skus) * 100
      : 0;
  const accuracyPct =
    accuracyRaw >= 10 ? Math.round(accuracyRaw) : Math.round(accuracyRaw * 10) / 10;

  return (
    <div className="flex flex-col min-h-screen bg-bg-main">
      {/* Header — hidden on print */}
      <div className="print:hidden shrink-0 px-4 pt-4 pb-2">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="p-2 hover:bg-white/10 rounded-full text-muted transition-colors"
            >
              <ChevronLeft size={24} />
            </button>
            <h1 className="text-lg font-black uppercase tracking-widest text-content">
              Activity Report
            </h1>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleCopy}
              className="p-2 hover:bg-white/10 rounded-full text-accent transition-colors"
              title="Copy report"
            >
              {copied ? <Check size={20} className="text-green-400" /> : <Copy size={20} />}
            </button>
            <button
              onClick={() => window.print()}
              className="p-2 hover:bg-white/10 rounded-full text-accent transition-colors"
              title="Print report"
            >
              <Printer size={20} />
            </button>
          </div>
        </div>

        {/* Date navigation */}
        <div className="flex items-center justify-center gap-4 mb-3">
          <button
            onClick={() => handleDateChange(addDays(selectedDate, -1))}
            className="p-2 hover:bg-white/10 rounded-full text-muted transition-colors active:scale-90"
          >
            <ChevronLeft size={20} />
          </button>
          <span className="text-sm font-bold text-content min-w-[140px] text-center">
            {formatDateNav(selectedDate)}
          </span>
          <button
            onClick={() => handleDateChange(addDays(selectedDate, 1))}
            disabled={selectedDate >= today}
            className="p-2 hover:bg-white/10 rounded-full text-muted transition-colors disabled:opacity-30 active:scale-90"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      </div>

      {/* Report content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-accent w-8 h-8 opacity-30" />
          </div>
        )}

        {error && (
          <div className="text-center py-20 text-red-400 text-sm">Failed to load report data.</div>
        )}

        {report && !isLoading && (
          <div id="report-content">
            <ActivityReportView
              report={report}
              accuracyPct={accuracyPct}
              notes={notes}
              winOfTheDay={winOfTheDay}
              routineChecklist={routineChecklist}
              pickdUpdates={pickdUpdates}
              doneToday={doneToday}
              inProgress={inProgress}
              comingUpNext={comingUpNext}
            />
          </div>
        )}
      </div>

      {/* Bottom bar — hidden on print */}
      <div className="print:hidden shrink-0 p-4 border-t border-subtle bg-bg-main space-y-3">
        {/* Win of the Day input */}
        <input
          type="text"
          value={winOfTheDay}
          onChange={(e) => setWinOfTheDay(e.target.value)}
          placeholder="Win of the day..."
          className="w-full h-10 px-3 bg-surface border border-subtle rounded-xl text-xs text-content placeholder-muted focus:outline-none focus:border-accent/40"
        />

        {/* PickD Updates — manual multiline */}
        <textarea
          value={pickdUpdatesText}
          onChange={(e) => setPickdUpdatesText(e.target.value)}
          placeholder="PickD updates (one per line)..."
          rows={2}
          className="w-full px-3 py-2 bg-surface border border-subtle rounded-xl text-xs text-content placeholder-muted focus:outline-none focus:border-accent/40 resize-none"
        />

        {/* Routine checklist toggles */}
        <div className="flex flex-wrap gap-1.5">
          {ROUTINE_ITEMS.map((item) => {
            const isChecked = routineChecklist.includes(item);
            return (
              <button
                key={item}
                onClick={() => handleToggleRoutine(item)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all active:scale-95 ${
                  isChecked
                    ? 'bg-accent text-main'
                    : 'bg-surface border border-subtle text-muted hover:border-accent/30'
                }`}
              >
                {item}
              </button>
            );
          })}
        </div>

        {/* Added notes preview */}
        {notes.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {notes.map((n, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-2 py-1 bg-accent/10 border border-accent/20 rounded-lg text-[10px] font-bold text-accent"
              >
                {n.full_name}: {n.text.slice(0, 30)}
                {n.text.length > 30 ? '...' : ''}
                <button onClick={() => handleRemoveNote(i)} className="hover:text-red-400">
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Note user selector + text input */}
        <div className="flex items-center gap-2">
          <select
            value={noteUser}
            onChange={(e) => setNoteUser(e.target.value)}
            className="h-10 px-2 bg-surface border border-subtle rounded-xl text-xs text-content focus:outline-none focus:border-accent/40 min-w-[100px]"
          >
            <option value="">Who?</option>
            {report?.users.map((u) => (
              <option key={u.user_id} value={u.user_id}>
                {u.full_name}
              </option>
            ))}
            {profiles
              ?.filter((p) => !report?.users.some((u) => u.user_id === p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
          </select>
          <input
            type="text"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddNote()}
            placeholder="Add note..."
            className="flex-1 h-10 px-3 bg-surface border border-subtle rounded-xl text-xs text-content placeholder-muted focus:outline-none focus:border-accent/40"
          />
          <button
            onClick={handleAddNote}
            disabled={!noteUser || !noteText.trim()}
            className="h-10 w-10 flex items-center justify-center bg-accent text-main rounded-xl active:scale-90 transition-all disabled:opacity-30"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};
