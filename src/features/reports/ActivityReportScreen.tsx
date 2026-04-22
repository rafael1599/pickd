import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Copy from 'lucide-react/dist/esm/icons/copy';
import Check from 'lucide-react/dist/esm/icons/check';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Save from 'lucide-react/dist/esm/icons/save';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import Settings2 from 'lucide-react/dist/esm/icons/settings-2';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import GripVertical from 'lucide-react/dist/esm/icons/grip-vertical';
import { useQuery } from '@tanstack/react-query';
import {
  useActivityReport,
  type ActivityReport,
} from './hooks/useActivityReport';
import { useDailyReport, hasComputedData, type DailyReportManual } from './hooks/useDailyReport';
import { useSaveDailyReportManual } from './hooks/useSaveDailyReportManual';
import { ActivityReportView } from './components/ActivityReportView';
import { useReportTasks } from '../projects/hooks/useProjectReportData';
import { getCurrentNYDate } from '../../lib/nyDate';
import { useAuth } from '../../context/AuthContext';
import { useWaitingOrdersCount } from '../picking/hooks/useWaitingOrders';
import Download from 'lucide-react/dist/esm/icons/download';
// `./utils/exportReportPdf` is dynamically imported inside handleDownloadPdf
// to defer @react-pdf/renderer (~490 KB gzipped) until the user actually
// clicks "Download PDF".

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

const DEFAULT_ROUTINE_ITEMS = [
  'Cleanup / trash',
  'Sweeping',
  'Receiving — Uline',
  'Receiving — container',
  'Receiving — FedEx',
  'Receiving — pallets',
  'General organization',
];

const ROUTINE_STORAGE_KEY = 'pickd-routine-items';

function loadRoutineItems(): string[] {
  try {
    const stored = localStorage.getItem(ROUTINE_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* ignore */ }
  return DEFAULT_ROUTINE_ITEMS;
}

function saveRoutineItems(items: string[]) {
  localStorage.setItem(ROUTINE_STORAGE_KEY, JSON.stringify(items));
}

export const ActivityReportScreen = () => {
  const navigate = useNavigate();
  const { isAdmin, user, profile: authProfile } = useAuth();
  const { data: waitingCount = 0 } = useWaitingOrdersCount();

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
  // useActiveProfiles removed — notes now use current logged-in user
  const { data: reportTasks } = useReportTasks(selectedDate);

  // ----- Manual editable state -----
  // Greeting removed — feature eliminated per design refactor.
  const [notesText, setNotesText] = useState('');
  const [winOfTheDay, setWinOfTheDay] = useState('');
  const [pickdUpdatesText, setPickdUpdatesText] = useState('');
  const [routineChecklist, setRoutineChecklist] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [routineItems, setRoutineItems] = useState<string[]>(loadRoutineItems);
  const [editingRoutine, setEditingRoutine] = useState(false);
  const [newRoutineItem, setNewRoutineItem] = useState('');

  // Last successfully saved/loaded baseline (for dirty tracking)
  const [savedManual, setSavedManual] = useState<DailyReportManual>({});
  // Tracks which selectedDate the local state was last hydrated from, so a
  // cache refetch after save does not clobber in-progress edits.
  const lastHydratedDateRef = useRef<string | null>(null);

  // ----- Date / source flags -----
  const isCurrentDay = !!selectedDate && selectedDate === today;
  // Past dates are LOCKED — no edits even for admins (RLS enforces this).
  const isPastDate = !!selectedDate && selectedDate < today;
  // canEdit gates the editable controls. Non-admins viewing today see the
  // same disabled inputs as anyone viewing a past date — RLS would reject
  // a save anyway, so we hide the affordance.
  const canEdit = isAdmin && !isPastDate;

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
        // Photos are live (not snapshotted) — pull from live query if available
        completed_orders_with_photos: liveReport?.completed_orders_with_photos ?? [],
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
     
    setNotesText('');
     
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
    const nextNotesText = nextNotes.map((n) => n.text).join('\n');

     
    setWinOfTheDay(nextWin);
    setPickdUpdatesText(nextUpdatesArr.join('\n'));
    setRoutineChecklist(nextRoutine);
    setNotesText(nextNotesText);
    setSavedManual({
      win_of_the_day: nextWin,
      pickd_updates: nextUpdatesArr,
      routine_checklist: nextRoutine,
      user_notes: nextNotes,
    });
    lastHydratedDateRef.current = selectedDate;
  }, [selectedDate, snapshotRow]);

  // ----- Derived notes for view & persistence -----
  const notes: UserNote[] = useMemo(() => {
    const name = authProfile?.full_name ?? 'Unknown';
    const uid = user?.id ?? '';
    return notesText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((text) => ({ id: uid, full_name: name, text }));
  }, [notesText, authProfile, user]);

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
    if (!canEdit || !isDirty || !selectedDate) return;
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
  }, [canEdit, isDirty, selectedDate, currentManual, saveManual]);

  // ----- Handlers -----
  // Confirm before navigating away from unsaved changes. Uses window.confirm
  // (browser-native) intentionally — this is exactly the kind of ephemeral
  // gating dialog that the Modal Manager pattern lists as an exception.
  const handleDateChange = useCallback(
    (newDate: string) => {
      if (isDirty && canEdit) {
        const ok = window.confirm(
          'You have unsaved changes that will be lost. Continue without saving?'
        );
        if (!ok) return;
      }
      setSelectedDate(newDate);
    },
    [isDirty, canEdit]
  );

  // Browser-level beforeunload guard so closing/refreshing the tab while
  // dirty also prompts the user. Only registered when there are unsaved
  // changes that the user could have saved (admin + today + dirty).
  useEffect(() => {
    if (!isDirty || !canEdit) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty, canEdit]);

  const handleToggleRoutine = useCallback((item: string) => {
    setRoutineChecklist((prev) =>
      prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]
    );
  }, []);

  const handleCopy = useCallback(async () => {
    const reportEl = document.getElementById('report-content');
    if (!reportEl) return;

    setIsCopying(true);
    try {
      // Clone the report so we don't mutate the live UI
      const clone = reportEl.cloneNode(true) as HTMLElement;

      // Remove ALL images from the clipboard copy — they don't paste well
      // into email clients regardless of source (blob:, https:, data:).
      for (const img of Array.from(clone.querySelectorAll('img'))) {
        img.remove();
      }

      // Remove the entire PALLET PHOTOS section (images + order numbers).
      clone.querySelector('[data-section="pallet-photos"]')?.remove();

      // Use Clipboard API to write HTML with external image URLs.
      const html = clone.outerHTML;
      const blob = new Blob([html], { type: 'text/html' });
      const data = [new ClipboardItem({ 'text/html': blob })];
      await navigator.clipboard.write(data);

      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Copy failed, falling back to execCommand:', err);
      // Fallback for browsers without Clipboard API support.
      const range = document.createRange();
      range.selectNodeContents(reportEl);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.execCommand('copy');
      selection?.removeAllRanges();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } finally {
      setIsCopying(false);
    }
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

  // PDF export (idea-059) — renders <ActivityReportView printMode /> off-screen
  // with full-resolution images and triggers a download.
  const handleDownloadPdf = useCallback(async () => {
    if (!reportForView) return;
    setIsGeneratingPdf(true);
    try {
      // Dynamic import keeps @react-pdf/renderer out of the initial bundle.
      const { exportActivityReportPdf } = await import('./utils/exportReportPdf');
      await exportActivityReportPdf({
        report: reportForView,
        accuracyPct,
        notes,
        winOfTheDay,
        routineChecklist,
        pickdUpdates,
        doneToday,
        inProgress,
        comingUpNext,
        waitingOrdersCount: waitingCount,
        filenameStem: `activity-report-${selectedDate}`,
      });
    } catch (err) {
      console.error('PDF export failed:', err);
      alert('Failed to generate PDF. Check console for details.');
    } finally {
      setIsGeneratingPdf(false);
    }
  }, [
    reportForView,
    accuracyPct,
    notes,
    winOfTheDay,
    routineChecklist,
    pickdUpdates,
    doneToday,
    inProgress,
    comingUpNext,
    waitingCount,
    selectedDate,
  ]);

  // Wait for NY date to load before rendering anything date-dependent.
  if (!selectedDate || !today) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-bg-main">
        <Loader2 className="animate-spin text-accent w-8 h-8 opacity-30" />
      </div>
    );
  }

  // ----- Save UI state -----
  const showSaveControls = canEdit;
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
            {isPastDate && (
              <span
                title="Past days are locked. Editing is only allowed for the current NY day."
                className="text-[10px] font-bold uppercase tracking-widest text-amber-400/90 px-2 py-0.5 border border-amber-400/30 rounded-md"
              >
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
              disabled={isCopying}
              className="p-2 hover:bg-white/10 rounded-full text-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title={isCopying ? 'Copying images...' : 'Copy report'}
            >
              {isCopying ? (
                <Loader2 size={20} className="animate-spin" />
              ) : copied ? (
                <Check size={20} className="text-green-400" />
              ) : (
                <Copy size={20} />
              )}
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

      {/* Main content — side-by-side on desktop, stacked on mobile */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">

        {/* Editor panel — left on desktop, bottom on mobile (order-2 mobile, order-1 desktop) */}
        <div className="print:hidden shrink-0 md:w-80 md:min-w-[320px] md:border-r md:border-subtle md:order-1 order-2 border-t md:border-t-0 border-subtle bg-bg-main overflow-y-auto">
          <div className="p-4 space-y-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted mb-1">Editor</p>

            {/* Win of the Day input + save */}
            <div>
              <label className="text-[9px] font-bold uppercase tracking-widest text-muted/70 mb-1 block">Win of the Day</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={winOfTheDay}
                  onChange={(e) => setWinOfTheDay(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && canSave && handleSave()}
                  disabled={!canEdit}
                  placeholder={canEdit ? 'Win of the day...' : '—'}
                  className="flex-1 h-9 px-3 bg-surface border border-subtle rounded-xl text-xs text-content placeholder-muted focus:outline-none focus:border-accent/40 disabled:opacity-50 disabled:cursor-not-allowed"
                />
                {showSaveControls && (
                  <button
                    onClick={handleSave}
                    disabled={!canSave}
                    className="h-9 w-9 flex items-center justify-center bg-accent text-main rounded-xl active:scale-90 transition-all disabled:opacity-30 shrink-0"
                    title="Save"
                  >
                    {saveManual.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  </button>
                )}
              </div>
            </div>

            {/* PickD Updates — collapsible */}
            <details className="group">
              <summary className="flex items-center gap-1 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
                <ChevronDown size={12} className="text-muted/50 transition-transform group-open:rotate-180" />
                <span className="text-[9px] font-bold uppercase tracking-widest text-muted/70">
                  PickD Updates
                </span>
                {pickdUpdatesText.trim() && (
                  <span className="text-[9px] font-bold text-accent/60 group-open:hidden">({pickdUpdates.length})</span>
                )}
              </summary>
              <div className="flex gap-1.5 mt-1.5">
                <textarea
                  value={pickdUpdatesText}
                  onChange={(e) => setPickdUpdatesText(e.target.value)}
                  disabled={!canEdit}
                  placeholder={canEdit ? 'One per line...' : '—'}
                  rows={3}
                  className="flex-1 px-3 py-2 bg-surface border border-subtle rounded-xl text-xs text-content placeholder-muted focus:outline-none focus:border-accent/40 resize-none disabled:opacity-50 disabled:cursor-not-allowed"
                />
                {showSaveControls && (
                  <button
                    onClick={handleSave}
                    disabled={!canSave}
                    className="h-9 w-9 flex items-center justify-center bg-accent text-main rounded-xl active:scale-90 transition-all disabled:opacity-30 shrink-0 self-end"
                    title="Save"
                  >
                    {saveManual.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  </button>
                )}
              </div>
            </details>

            {/* Routine checklist toggles */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[9px] font-bold uppercase tracking-widest text-muted/70">On the Floor</label>
                {canEdit && (
                  <button
                    onClick={() => setEditingRoutine((v) => !v)}
                    className={`p-1 rounded-md transition-colors ${
                      editingRoutine ? 'bg-accent/20 text-accent' : 'text-muted/50 hover:text-muted'
                    }`}
                    title="Edit routine items"
                  >
                    <Settings2 size={12} />
                  </button>
                )}
              </div>

              {editingRoutine && canEdit ? (
                <div className="space-y-1.5 mb-2">
                  {routineItems.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-1.5 group"
                    >
                      <GripVertical size={10} className="text-muted/30 shrink-0" />
                      <span className="flex-1 text-[11px] text-content truncate">{item}</span>
                      <button
                        onClick={() => {
                          const next = routineItems.filter((_, i) => i !== idx);
                          setRoutineItems(next);
                          saveRoutineItems(next);
                          setRoutineChecklist((prev) => prev.filter((c) => c !== item));
                        }}
                        className="p-1 rounded-md text-muted/40 hover:text-red-400 hover:bg-red-400/10 transition-colors opacity-0 group-hover:opacity-100"
                        title="Remove item"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center gap-1.5 mt-2">
                    <input
                      type="text"
                      value={newRoutineItem}
                      onChange={(e) => setNewRoutineItem(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newRoutineItem.trim()) {
                          const next = [...routineItems, newRoutineItem.trim()];
                          setRoutineItems(next);
                          saveRoutineItems(next);
                          setNewRoutineItem('');
                        }
                      }}
                      placeholder="New item..."
                      className="flex-1 h-7 px-2 bg-surface border border-subtle rounded-lg text-[11px] text-content placeholder-muted/50 focus:outline-none focus:border-accent/40"
                    />
                    <button
                      onClick={() => {
                        if (!newRoutineItem.trim()) return;
                        const next = [...routineItems, newRoutineItem.trim()];
                        setRoutineItems(next);
                        saveRoutineItems(next);
                        setNewRoutineItem('');
                      }}
                      disabled={!newRoutineItem.trim()}
                      className="h-7 w-7 flex items-center justify-center bg-accent text-main rounded-lg active:scale-90 transition-all disabled:opacity-30 shrink-0"
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                  <button
                    onClick={() => {
                      setRoutineItems(DEFAULT_ROUTINE_ITEMS);
                      saveRoutineItems(DEFAULT_ROUTINE_ITEMS);
                    }}
                    className="text-[9px] font-bold uppercase tracking-widest text-muted/50 hover:text-muted transition-colors"
                  >
                    Reset to defaults
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {routineItems.map((item) => {
                    const isChecked = routineChecklist.includes(item);
                    return (
                      <button
                        key={item}
                        onClick={() => handleToggleRoutine(item)}
                        disabled={!canEdit}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all active:scale-95 disabled:cursor-not-allowed ${
                          isChecked
                            ? 'bg-accent text-main'
                            : 'bg-surface border border-subtle text-muted hover:border-accent/30'
                        } ${!canEdit ? 'opacity-50' : ''}`}
                      >
                        {item}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Notes — multiline editable */}
            <div>
              <label className="text-[9px] font-bold uppercase tracking-widest text-muted/70 mb-1 block">Notes</label>
              <div className="flex gap-1.5">
                <textarea
                  value={notesText}
                  onChange={(e) => setNotesText(e.target.value)}
                  disabled={!canEdit}
                  placeholder={canEdit ? 'One per line...' : '—'}
                  rows={3}
                  className="flex-1 px-3 py-2 bg-surface border border-subtle rounded-xl text-xs text-content placeholder-muted focus:outline-none focus:border-accent/40 resize-none disabled:opacity-50 disabled:cursor-not-allowed"
                />
                {showSaveControls && (
                  <button
                    onClick={handleSave}
                    disabled={!canSave}
                    className="h-9 w-9 flex items-center justify-center bg-accent text-main rounded-xl active:scale-90 transition-all disabled:opacity-30 shrink-0 self-end"
                    title="Save"
                  >
                    {saveManual.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  </button>
                )}
              </div>
            </div>

            {/* Save & Copy button — saves then copies report to clipboard */}
            {showSaveControls && (
              <button
                onClick={async () => {
                  if (canSave) {
                    handleSave();
                    // Wait briefly for save to process before copying
                    await new Promise((r) => setTimeout(r, 300));
                  }
                  await handleCopy();
                }}
                disabled={isCopying}
                className="w-full py-3 rounded-xl text-xs font-black uppercase tracking-widest bg-accent text-main hover:bg-accent/90 active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isCopying ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Copying...
                  </>
                ) : copied ? (
                  <>
                    <Check size={14} />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy size={14} />
                    Save &amp; Copy Report
                  </>
                )}
              </button>
            )}

            {/* Download PDF — idea-059, includes full-res gallery + pallet photos */}
            <button
              onClick={handleDownloadPdf}
              disabled={isGeneratingPdf || !reportForView}
              className="w-full py-3 rounded-xl text-xs font-black uppercase tracking-widest bg-card border border-subtle text-content/70 hover:bg-card/80 active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              title="Download report as PDF with full-resolution images"
            >
              {isGeneratingPdf ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Generating PDF...
                </>
              ) : (
                <>
                  <Download size={14} />
                  Download PDF
                </>
              )}
            </button>
          </div>
        </div>

        {/* Report preview — right on desktop, top on mobile */}
        <div className="flex-1 overflow-y-auto md:order-2 order-1 min-h-0">
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
                waitingOrdersCount={waitingCount}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
