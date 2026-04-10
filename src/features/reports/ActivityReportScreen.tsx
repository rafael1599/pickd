import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Printer from 'lucide-react/dist/esm/icons/printer';
import Copy from 'lucide-react/dist/esm/icons/copy';
import Check from 'lucide-react/dist/esm/icons/check';
import Plus from 'lucide-react/dist/esm/icons/plus';
import X from 'lucide-react/dist/esm/icons/x';
import Save from 'lucide-react/dist/esm/icons/save';
import { useQuery } from '@tanstack/react-query';
import {
  useActivityReport,
  useActiveProfiles,
  type ActivityReport,
} from './hooks/useActivityReport';
import { useDailyReport, hasComputedData, type DailyReportManual } from './hooks/useDailyReport';
import { useSaveDailyReportManual } from './hooks/useSaveDailyReportManual';
import { ActivityReportView } from './components/ActivityReportView';
import { useReportTasks } from '../projects/hooks/useProjectReportData';
import { getCurrentNYDate } from '../../lib/nyDate';
import { useAuth } from '../../context/AuthContext';

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
  const { isAdmin } = useAuth();

  // Today's NY date — single source of truth via Postgres (handles DST).
  const { data: nyToday } = useQuery({
    queryKey: ['ny-today'],
    queryFn: getCurrentNYDate,
    staleTime: 60 * 60 * 1000, // 1 hour
  });
  const today = nyToday ?? '';
  const [selectedDate, setSelectedDate] = useState('');

  useEffect(() => {
    if (today && !selectedDate) setSelectedDate(today);
  }, [today, selectedDate]);

  // ----- Data sources -----
  // Snapshot row from public.daily_reports (Phase 2 persistence).
  const { data: snapshotRow } = useDailyReport(selectedDate);
  // Live compute via 8 parallel queries (Phase 1 hook). Used for:
  //   - Today (always — snapshot is stale until next cron run)
  //   - Past days where no snapshot exists yet (pre-launch or cron miss)
  const { data: liveReport, isLoading: liveLoading, error: liveError } = useActivityReport(selectedDate);
  const { data: profiles } = useActiveProfiles();
  const { data: reportTasks } = useReportTasks(selectedDate);

  // ----- Manual editable state -----
  const [notes, setNotes] = useState<UserNote[]>([]);
  const [noteUser, setNoteUser] = useState('');
  const [noteText, setNoteText] = useState('');
  const [winOfTheDay, setWinOfTheDay] = useState('');
  const [pickdUpdatesText, setPickdUpdatesText] = useState('');
  const [routineChecklist, setRoutineChecklist] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  // Last successfully saved/loaded baseline (for dirty tracking)
  const [savedManual, setSavedManual] = useState<DailyReportManual>({});
  // Tracks which selectedDate the local state was last hydrated from, so a
  // cache refetch after save does not clobber in-progress edits.
  const lastHydratedDateRef = useRef<string | null>(null);

  // ----- Date / source flags -----
  const isCurrentDay = !!selectedDate && selectedDate === today;
  const isReadOnly = !!selectedDate && selectedDate < today;

  // For computed data display: prefer snapshot for past days, live for today
  // (today's snapshot may be empty until the cron runs the next morning).
  const useSnapshotComputed = !isCurrentDay && hasComputedData(snapshotRow);

  // Adapter: produce the legacy ActivityReport shape so ActivityReportView
  // does not need to know about the new snapshot format.
  const reportForView: ActivityReport | null = useMemo(() => {
    if (useSnapshotComputed && snapshotRow && hasComputedData(snapshotRow)) {
      const c = snapshotRow.data_computed as NonNullable<typeof snapshotRow.data_computed> & {
        warehouse_totals: { orders_completed: number; total_items: number };
        accuracy: { pct: number; verified_skus_2m: number; total_skus: number };
        correction_count: number;
        users: ActivityReport['users'];
      };
      return {
        date: selectedDate,
        users: c.users,
        warehouse_totals: c.warehouse_totals,
        verified_skus_2m: c.accuracy.verified_skus_2m,
        total_skus: c.accuracy.total_skus,
        correction_count: c.correction_count,
      };
    }
    return liveReport ?? null;
  }, [useSnapshotComputed, snapshotRow, liveReport, selectedDate]);

  const pickdUpdates = useMemo(
    () =>
      pickdUpdatesText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    [pickdUpdatesText]
  );
  const doneToday = reportTasks?.doneToday ?? [];
  const inProgress = reportTasks?.inProgress ?? [];
  const comingUpNext = reportTasks?.comingUpNext ?? [];

  // ----- Hydration: load manual fields from snapshot when date changes -----
  // Reset whenever the selected date changes — clears any stale local state
  // and forces re-hydration from the new date's snapshot (or empty).
  useEffect(() => {
    lastHydratedDateRef.current = null;
    setNotes([]);
    setWinOfTheDay('');
    setPickdUpdatesText('');
    setRoutineChecklist([]);
    setSavedManual({});
  }, [selectedDate]);

  // Hydrate local manual state from the snapshot exactly once per selected date.
  // After hydration, mutations (save) update lastHydratedDateRef so subsequent
  // refetches do not overwrite the user's in-progress edits.
  useEffect(() => {
    if (!selectedDate) return;
    if (lastHydratedDateRef.current === selectedDate) return;
    // Wait for the query to settle for this exact date (or confirm no row).
    if (snapshotRow && snapshotRow.report_date !== selectedDate) return;

    const m: DailyReportManual =
      (snapshotRow?.data_manual as DailyReportManual | undefined) ?? {};
    const nextWin = m.win_of_the_day ?? '';
    const nextUpdatesArr = m.pickd_updates ?? [];
    const nextRoutine = m.routine_checklist ?? [];
    const nextNotes = m.user_notes ?? [];

    setWinOfTheDay(nextWin);
    setPickdUpdatesText(nextUpdatesArr.join('\n'));
    setRoutineChecklist(nextRoutine);
    setNotes(nextNotes);
    setSavedManual({
      win_of_the_day: nextWin,
      pickd_updates: nextUpdatesArr,
      routine_checklist: nextRoutine,
      user_notes: nextNotes,
    });
    lastHydratedDateRef.current = selectedDate;
  }, [selectedDate, snapshotRow]);

  // ----- Dirty tracking -----
  const currentManual: DailyReportManual = useMemo(
    () => ({
      win_of_the_day: winOfTheDay,
      pickd_updates: pickdUpdates,
      routine_checklist: routineChecklist,
      user_notes: notes,
    }),
    [winOfTheDay, pickdUpdates, routineChecklist, notes]
  );

  const isDirty = useMemo(
    () => JSON.stringify(currentManual) !== JSON.stringify(savedManual),
    [currentManual, savedManual]
  );

  // ----- Save mutation -----
  const saveManual = useSaveDailyReportManual();

  const handleSave = useCallback(() => {
    if (!isAdmin || isReadOnly || !isDirty || !selectedDate) return;
    const snapshot = currentManual;
    saveManual.mutate(
      { date: selectedDate, manual: snapshot },
      {
        onSuccess: () => {
          // Reset baseline so the next character typed flips dirty back on.
          setSavedManual(snapshot);
        },
      }
    );
  }, [isAdmin, isReadOnly, isDirty, selectedDate, currentManual, saveManual]);

  // ----- Handlers -----
  const handleDateChange = useCallback((newDate: string) => {
    setSelectedDate(newDate);
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

  // ----- Accuracy display -----
  // For snapshots, the cron already computed pct. For live, compute from raw.
  const accuracyPct = useMemo(() => {
    if (useSnapshotComputed && snapshotRow && hasComputedData(snapshotRow)) {
      const c = snapshotRow.data_computed as { accuracy: { pct: number } };
      return c.accuracy.pct;
    }
    if (!reportForView || reportForView.total_skus <= 0) return 0;
    const raw = (reportForView.verified_skus_2m / reportForView.total_skus) * 100;
    return raw >= 10 ? Math.round(raw) : Math.round(raw * 10) / 10;
  }, [useSnapshotComputed, snapshotRow, reportForView]);

  // Wait for NY date to load before rendering anything date-dependent.
  if (!selectedDate || !today) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-bg-main">
        <Loader2 className="animate-spin text-accent w-8 h-8 opacity-30" />
      </div>
    );
  }

  // ----- Save UI state -----
  const showSaveControls = isAdmin && !isReadOnly;
  const canSave = isDirty && !saveManual.isPending;
  const showSavedBadge =
    !isDirty && !saveManual.isPending && saveManual.isSuccess;

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
            {isReadOnly && (
              <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400/90 px-2 py-0.5 border border-amber-400/30 rounded-md">
                Locked
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {showSaveControls && (
              <>
                {showSavedBadge && (
                  <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 px-2">
                    Saved ✓
                  </span>
                )}
                <button
                  onClick={handleSave}
                  disabled={!canSave}
                  title={canSave ? 'Save report' : 'No unsaved changes'}
                  className="p-2 hover:bg-white/10 rounded-full text-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {saveManual.isPending ? (
                    <Loader2 size={20} className="animate-spin" />
                  ) : (
                    <Save size={20} />
                  )}
                </button>
              </>
            )}
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
        {liveLoading && !reportForView && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-accent w-8 h-8 opacity-30" />
          </div>
        )}

        {liveError && !reportForView && (
          <div className="text-center py-20 text-red-400 text-sm">Failed to load report data.</div>
        )}

        {reportForView && (
          <div id="report-content">
            <ActivityReportView
              report={reportForView}
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
          disabled={isReadOnly}
          placeholder={isReadOnly ? '—' : 'Win of the day...'}
          className="w-full h-10 px-3 bg-surface border border-subtle rounded-xl text-xs text-content placeholder-muted focus:outline-none focus:border-accent/40 disabled:opacity-50 disabled:cursor-not-allowed"
        />

        {/* PickD Updates — manual multiline */}
        <textarea
          value={pickdUpdatesText}
          onChange={(e) => setPickdUpdatesText(e.target.value)}
          disabled={isReadOnly}
          placeholder={isReadOnly ? '—' : 'PickD updates (one per line)...'}
          rows={2}
          className="w-full px-3 py-2 bg-surface border border-subtle rounded-xl text-xs text-content placeholder-muted focus:outline-none focus:border-accent/40 resize-none disabled:opacity-50 disabled:cursor-not-allowed"
        />

        {/* Routine checklist toggles */}
        <div className="flex flex-wrap gap-1.5">
          {ROUTINE_ITEMS.map((item) => {
            const isChecked = routineChecklist.includes(item);
            return (
              <button
                key={item}
                onClick={() => handleToggleRoutine(item)}
                disabled={isReadOnly}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all active:scale-95 disabled:cursor-not-allowed ${
                  isChecked
                    ? 'bg-accent text-main'
                    : 'bg-surface border border-subtle text-muted hover:border-accent/30'
                } ${isReadOnly ? 'opacity-50' : ''}`}
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
                {!isReadOnly && (
                  <button onClick={() => handleRemoveNote(i)} className="hover:text-red-400">
                    <X size={10} />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        {/* Note user selector + text input */}
        {!isReadOnly && (
          <div className="flex items-center gap-2">
            <select
              value={noteUser}
              onChange={(e) => setNoteUser(e.target.value)}
              className="h-10 px-2 bg-surface border border-subtle rounded-xl text-xs text-content focus:outline-none focus:border-accent/40 min-w-[100px]"
            >
              <option value="">Who?</option>
              {reportForView?.users.map((u) => (
                <option key={u.user_id} value={u.user_id}>
                  {u.full_name}
                </option>
              ))}
              {profiles
                ?.filter((p) => !reportForView?.users.some((u) => u.user_id === p.id))
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
        )}
      </div>
    </div>
  );
};
