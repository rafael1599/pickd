import React, { useCallback, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, Upload, Package, ArrowLeft, Copy, CheckCircle2, XCircle } from 'lucide-react';
import { parseShipmentXlsx } from './lib/parseShipmentXlsx';
import { parseShipmentPdf } from './lib/parseShipmentPdf';
import { isWarehouseContainer, toInputItems } from './lib/containers';
import { formatTowersLines } from '../../utils/containerDistribution';
import { useRegistrarContainer } from './hooks/useRegistrarContainer';
import { RegisterTypeSelector } from '../../components/ui/RegisterTypeSelector';
import type {
  AnalyzedContainer,
  ContainerIntake,
  ParsedContainer,
  RegisterOutcome,
  ResolvedItem,
} from './lib/types';

type Step = 'upload' | 'classify' | 'preview' | 'done';
type ItemType = 'bike' | 'part';

// Stock from these container imports always lands in the LUDLOW warehouse.
const WAREHOUSE = 'LUDLOW';

function locLabel(t?: ResolvedItem['existing_locations'][number]): string {
  if (!t) return '—';
  return `${t.location}${t.sublocation?.length ? ' ' + t.sublocation.join(',') : ''}`;
}

function buildReportText(location: string, resolved: ResolvedItem[]): string {
  const lines = ['Consolidation — container ' + location, ''];
  for (const r of resolved) {
    if (r.existing_qty <= 0) continue;
    const loc = locLabel(r.existing_locations[0]);
    lines.push(
      `${r.canonical_sku}\t${r.qty} (${formatTowersLines(r.qty)})\t→ ${loc} · ${r.existing_qty} (${formatTowersLines(r.existing_qty)})\t= ${r.qty + r.existing_qty} (${formatTowersLines(r.qty + r.existing_qty)})`
    );
  }
  return lines.join('\n');
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** 'Sep 10', New York time. */
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'America/New_York',
  });
}

/**
 * Ticked when the file is read: a load of this warehouse PickD does not have
 * yet. A block with no PO is ticked too -- it is the whole file (a PDF, a
 * sheet cut by hand), and leaving it unticked would register nothing.
 */
function includedByDefault(c: AnalyzedContainer): boolean {
  return !c.intake && (c.container.po == null || isWarehouseContainer(c.container.po));
}

interface DoneRow {
  outcome: RegisterOutcome;
  resolved: ResolvedItem[];
}

export function RegistrarContainerScreen() {
  const { analyze, register } = useRegistrarContainer();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('upload');
  const [itemType, setItemType] = useState<ItemType | null>(null);
  const [itemTypesBySku, setItemTypesBySku] = useState<Record<string, ItemType>>({});
  const [fileName, setFileName] = useState<string>('');
  const [parsing, setParsing] = useState(false);
  const [containers, setContainers] = useState<AnalyzedContainer[]>([]);
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  // Only a container the file names no PO for is typed; every other one
  // lands in a location named after its PO.
  const [typedNames, setTypedNames] = useState<Record<string, string>>({});
  const [done, setDone] = useState<DoneRow[]>([]);

  const toRegister = useMemo(() => containers.filter((c) => !c.intake), [containers]);
  const inPickd = useMemo(
    () => containers.flatMap((c) => (c.intake ? [{ ...c, intake: c.intake }] : [])),
    [containers]
  );
  const selected = useMemo(() => toRegister.filter((c) => included[c.key]), [toRegister, included]);

  const locationOf = useCallback(
    (c: AnalyzedContainer) => (c.container.po ?? typedNames[c.key] ?? '').trim().toUpperCase(),
    [typedNames]
  );

  // Every SKU of the ticked containers, once: a SKU two containers bring has
  // one type.
  const selectedSkus = useMemo(
    () => [...new Set(selected.flatMap((c) => c.resolved.map((r) => r.canonical_sku)))],
    [selected]
  );
  const unassignedCount = useMemo(
    () => selectedSkus.filter((sku) => !itemTypesBySku[sku]).length,
    [selectedSkus, itemTypesBySku]
  );
  const totals = useMemo(() => {
    const units = selected.reduce((s, c) => s + c.container.total, 0);
    const newSkus = new Set(
      selected.flatMap((c) => c.resolved.filter((r) => r.is_new).map((r) => r.canonical_sku))
    );
    const mergedCount = selected.reduce(
      (s, c) => s + c.resolved.filter((r) => r.merged_from.length > 1).length,
      0
    );
    return { units, newCount: newSkus.size, mergedCount };
  }, [selected]);

  // Read the file, then read it against PickD, and move straight on — no
  // manual "Analyze" step.
  const handleFile = useCallback(
    async (file: File) => {
      setParsing(true);
      try {
        let parsed: ParsedContainer[];
        try {
          const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
          parsed = isPdf ? await parseShipmentPdf(file) : await parseShipmentXlsx(file);
        } catch (err) {
          toast.error(`Could not read the file: ${(err as Error).message}`);
          return;
        }
        setFileName(file.name);
        if (parsed.length === 0) {
          toast.error('No SKU lines found in the file.');
          return;
        }

        let data: AnalyzedContainer[];
        try {
          data = await analyze.mutateAsync({ containers: parsed, warehouse: WAREHOUSE });
        } catch {
          return; // analyze's onError already said why
        }
        const ticked = Object.fromEntries(data.map((c) => [c.key, includedByDefault(c)]));
        // Auto-assign type only for known SKUs (already in sku_metadata).
        // New/unknown SKUs are left unset — the user must designate them.
        const typesMap: Record<string, ItemType> = {};
        for (const c of data) {
          for (const r of c.resolved) {
            if (!r.is_new) typesMap[r.canonical_sku] = r.is_bike ? 'bike' : 'part';
          }
        }
        setContainers(data);
        setIncluded(ticked);
        setTypedNames({});
        setItemTypesBySku(typesMap);
        // Only ask the classification question when there is something to
        // classify — known SKUs already carry their type from the DB.
        const hasUnassigned = data.some(
          (c) => ticked[c.key] && c.resolved.some((r) => !typesMap[r.canonical_sku])
        );
        setStep(hasUnassigned ? 'classify' : 'preview');
      } finally {
        setParsing(false);
      }
    },
    [analyze]
  );

  const toggleIncluded = useCallback((key: string) => {
    setIncluded((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleSetAllTypes = useCallback(
    (type: ItemType) => {
      setItemType(type);
      setItemTypesBySku((prev) => {
        const updated = { ...prev };
        for (const sku of selectedSkus) updated[sku] = type;
        return updated;
      });
    },
    [selectedSkus]
  );

  // Classification step: one tap fills only the UNASSIGNED lines — SKUs whose
  // type is already known from the DB keep it. Explicit override for
  // everything lives in the preview's "Set all" control.
  const handleClassifyDefault = useCallback(
    (type: ItemType) => {
      setItemType(type);
      setItemTypesBySku((prev) => {
        const updated = { ...prev };
        for (const sku of selectedSkus) if (!updated[sku]) updated[sku] = type;
        return updated;
      });
      setStep('preview');
    },
    [selectedSkus]
  );

  const handleToggleRowType = useCallback((sku: string, type: ItemType) => {
    setItemTypesBySku((prev) => ({ ...prev, [sku]: type }));
  }, []);

  const handleRegister = useCallback(async () => {
    if (selected.length === 0) return;
    const names = selected.map(locationOf);
    if (names.some((n) => !n)) {
      toast.error('Name the location of the container the file gives no PO for.');
      return;
    }
    const twice = names.find((n, i) => names.indexOf(n) !== i);
    if (twice) {
      toast.error(`Two containers would land in ${twice}.`);
      return;
    }
    if (unassignedCount > 0) {
      toast.error('Assign Bike or Part to every item before registering.');
      return;
    }

    let outcomes: RegisterOutcome[];
    try {
      outcomes = await register.mutateAsync({
        batch: selected.map((c, i) => ({
          location: names[i],
          po: c.container.po,
          items: toInputItems(c.container),
          skus: c.resolved.map((r) => r.canonical_sku),
        })),
        warehouse: WAREHOUSE,
        itemTypesBySku,
      });
    } catch {
      return; // register's onError already said why; nothing was written
    }
    setDone(outcomes.map((outcome, i) => ({ outcome, resolved: selected[i].resolved })));
    setStep('done');
  }, [selected, locationOf, unassignedCount, register, itemTypesBySku]);

  const reset = useCallback(() => {
    setStep('upload');
    setItemType(null);
    setItemTypesBySku({});
    setFileName('');
    setContainers([]);
    setIncluded({});
    setTypedNames({});
    setDone([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const registered = useMemo(
    () =>
      done.flatMap((d) =>
        d.outcome.ok ? [{ location: d.outcome.summary.location, resolved: d.resolved }] : []
      ),
    [done]
  );
  const withMoves = useMemo(
    () => registered.filter((r) => r.resolved.some((x) => x.existing_qty > 0)),
    [registered]
  );

  const registerLabel =
    selected.length === 0
      ? 'Nothing to register'
      : selected.length === 1
        ? `Register ${locationOf(selected[0]) || '—'} · ${totals.units} u`
        : `Register ${selected.length} containers · ${totals.units} u`;

  return (
    <div className={`max-w-5xl mx-auto p-3 sm:p-6 ${step === 'preview' ? 'pb-44' : 'pb-32'}`}>
      <header className="flex items-center gap-3 mb-5 sm:mb-6">
        <Package className="w-6 h-6 text-accent shrink-0" />
        <h1 className="text-lg sm:text-xl font-semibold text-content">Register Container</h1>
        <StepBadge step={step} />
      </header>

      {/* ───────── STEP 1: UPLOAD ───────── */}
      {step === 'upload' && (
        <label className="block border-2 border-dashed border-gray-300 rounded-2xl p-10 sm:p-8 text-center cursor-pointer hover:border-accent active:border-accent transition-colors">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
          {parsing ? (
            <Loader2 className="w-9 h-9 mx-auto animate-spin text-accent" />
          ) : (
            <Upload className="w-9 h-9 mx-auto text-muted" />
          )}
          <p className="mt-3 text-sm text-content">
            {parsing ? 'Analyzing…' : fileName || 'Tap to upload the shipment file (.xlsx or .pdf)'}
          </p>
          {!parsing && (
            <p className="mt-1 text-xs text-muted">
              Every container in the file, each into its own PO
            </p>
          )}
        </label>
      )}

      {/* ───────── STEP 2: CLASSIFY (only when the file brings new SKUs) ───────── */}
      {step === 'classify' && (
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="w-full max-w-lg space-y-6">
            <div className="rounded-2xl border border-subtle bg-card p-5 sm:p-6">
              <RegisterTypeSelector
                value={itemType}
                onChange={handleClassifyDefault}
                title="Container classification"
                subtitle={`One tap classifies the ${unassignedCount} new SKU${unassignedCount === 1 ? '' : 's'} in ${selected.length === 1 ? locationOf(selected[0]) || 'this file' : `these ${selected.length} containers`}. SKUs already in the system keep their saved type. You can adjust each SKU on the next screen.`}
                large
              />
            </div>
            <div className="flex items-center justify-between">
              <button
                onClick={reset}
                className="inline-flex items-center gap-1 rounded-lg border border-subtle px-3 py-2 text-sm text-muted active:bg-main"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button
                onClick={() => setStep('preview')}
                className="text-sm text-muted underline underline-offset-2 active:text-content"
              >
                Skip — classify each SKU individually
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ───────── STEP 3: PREVIEW ───────── */}
      {step === 'preview' && (
        <div className="space-y-4">
          {toRegister.length === 0 && (
            <p className="rounded-2xl border border-subtle bg-card px-4 py-3 text-sm text-content">
              Every container in {fileName} is already in PickD — nothing to register.
            </p>
          )}
          {selected.length > 0 && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-subtle bg-card px-4 py-2.5">
                <span
                  className={`text-xs font-medium ${unassignedCount > 0 ? 'text-red-500' : 'text-muted'}`}
                >
                  {unassignedCount > 0
                    ? `${unassignedCount} SKU${unassignedCount === 1 ? '' : 's'} still need${unassignedCount === 1 ? 's' : ''} a type`
                    : 'All SKUs classified'}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] uppercase tracking-wider text-muted">Set all:</span>
                  <TypeToggle value={itemType} onChange={handleSetAllTypes} />
                </div>
              </div>

              <SummaryBar
                target={
                  selected.length === 1
                    ? `${WAREHOUSE} / ${locationOf(selected[0]) || '—'}`
                    : `${WAREHOUSE} · ${selected.length} containers`
                }
                skus={selectedSkus.length}
                units={totals.units}
                extra={`${totals.newCount} new · ${totals.mergedCount} merged`}
              />
            </>
          )}

          {toRegister.map((c) => (
            <ContainerSection
              key={c.key}
              c={c}
              included={!!included[c.key]}
              selectable={toRegister.length > 1}
              onToggle={() => toggleIncluded(c.key)}
              typedName={typedNames[c.key] ?? ''}
              onTypedName={(v) => setTypedNames((prev) => ({ ...prev, [c.key]: v.toUpperCase() }))}
            >
              <SkuRows
                resolved={c.resolved}
                itemTypesBySku={itemTypesBySku}
                onToggleType={handleToggleRowType}
              />
            </ContainerSection>
          ))}

          {inPickd.length > 0 && <AlreadyInPickd containers={inPickd} />}

          {/* Actions — float ABOVE the app's bottom nav, always visible (no need
              to scroll to the end). The nav bar is fixed bottom-0 h-24 z-[100],
              so we sit at bottom-24 with z-40. */}
          <div className="fixed inset-x-0 bottom-24 z-40 px-3 sm:px-6 pointer-events-none">
            <div className="mx-auto flex max-w-5xl flex-col-reverse gap-2 rounded-2xl border border-subtle bg-surface p-3 shadow-lg pointer-events-auto sm:flex-row sm:gap-3">
              <button
                onClick={reset}
                className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-subtle px-3 py-3 text-sm text-muted active:bg-main sm:w-auto sm:py-2"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button
                onClick={() => void handleRegister()}
                disabled={register.isPending || selected.length === 0}
                className="inline-flex w-full flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-4 py-3 text-sm font-medium text-white disabled:opacity-50 sm:py-2"
              >
                {register.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : registerLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ───────── STEP 4: DONE / REPORT ───────── */}
      {step === 'done' && (
        <div className="space-y-5">
          <ul className="space-y-2">
            {done.map(({ outcome }) => (
              <OutcomeRow key={outcome.location} outcome={outcome} />
            ))}
          </ul>

          {registered.length > 0 && (
            <>
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold text-content">Suggested consolidation</h2>
                {withMoves.length > 0 && (
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(
                        withMoves.map((r) => buildReportText(r.location, r.resolved)).join('\n\n')
                      );
                      toast.success('Report copied');
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-subtle px-3 py-2 text-sm text-muted active:bg-main shrink-0"
                  >
                    <Copy className="w-4 h-4" /> Copy
                  </button>
                )}
              </div>

              {withMoves.length === 0 && (
                <p className="text-sm text-muted">
                  No SKU has prior stock — everything stays in its container.
                </p>
              )}

              {registered.map((r) => (
                <ContainerReport
                  key={r.location}
                  location={r.location}
                  resolved={r.resolved}
                  titled={registered.length > 1}
                />
              ))}
            </>
          )}

          <button
            onClick={reset}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-3 text-sm font-medium text-white disabled:opacity-50 sm:w-auto sm:py-2"
          >
            Register another file
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * One container of the file, to be registered. Its location is its PO and is
 * never typed; the only input is for a block the file gives no PO for.
 */
function ContainerSection({
  c,
  included,
  selectable,
  onToggle,
  typedName,
  onTypedName,
  children,
}: {
  c: AnalyzedContainer;
  included: boolean;
  selectable: boolean;
  onToggle: () => void;
  typedName: string;
  onTypedName: (value: string) => void;
  children: React.ReactNode;
}) {
  const { container, resolved } = c;
  const newCount = resolved.filter((r) => r.is_new).length;
  const meta = [container.sheet, container.vessel, container.containerIds.join(' + ')]
    .filter(Boolean)
    .join(' · ');
  // The whole header toggles when it holds no text field of its own.
  const Header = selectable && container.po ? 'label' : 'div';

  return (
    <section
      className={`overflow-hidden rounded-2xl border border-subtle bg-card ${included ? '' : 'opacity-60'}`}
    >
      <Header
        className={`flex items-center gap-3 px-4 py-3 ${Header === 'label' ? 'cursor-pointer' : ''}`}
      >
        {selectable && (
          <input
            type="checkbox"
            checked={included}
            onChange={onToggle}
            aria-label={`Register ${container.po ?? 'this container'}`}
            className="h-5 w-5 shrink-0 accent-emerald-500"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {container.po ? (
              <span className="font-mono text-lg font-semibold text-content">{container.po}</span>
            ) : (
              <input
                value={typedName}
                onChange={(e) => onTypedName(e.target.value)}
                placeholder="LOCATION NAME"
                aria-label="Location name"
                className="w-44 rounded-lg border border-subtle bg-surface px-2 py-1.5 font-mono text-base text-content focus:border-accent focus:outline-none"
              />
            )}
            <span className="whitespace-nowrap text-sm text-muted">
              {plural(resolved.length, 'SKU')} · {container.total} u
            </span>
            {newCount > 0 && <Badge tone="green">{newCount} NEW</Badge>}
          </div>
          {container.po ? (
            meta && <p className="mt-0.5 truncate text-xs text-muted">{meta}</p>
          ) : (
            <p className="mt-0.5 text-xs text-amber-500">
              The file gives no PO for these lines — name their location
            </p>
          )}
        </div>
      </Header>
      {included && <div className="border-t border-subtle">{children}</div>}
    </section>
  );
}

function SkuRows({
  resolved,
  itemTypesBySku,
  onToggleType,
}: {
  resolved: ResolvedItem[];
  itemTypesBySku: Record<string, ItemType>;
  onToggleType: (sku: string, type: ItemType) => void;
}) {
  return (
    <>
      {/* Desktop table */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Canonical SKU</th>
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 font-medium text-center">Type</th>
              <th className="px-3 py-2 font-medium text-right">Qty</th>
              <th className="px-3 py-2 font-medium">Towers/Lines</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {resolved.map((r) => {
              const type = itemTypesBySku[r.canonical_sku];
              return (
                <tr
                  key={r.canonical_sku}
                  className={`border-t ${type ? 'border-subtle' : 'border-red-400/40 bg-red-500/5'}`}
                >
                  <td className="px-3 py-2 font-mono font-medium text-content">
                    {r.canonical_sku}
                  </td>
                  <td className="px-3 py-2 text-muted">{r.item_name}</td>
                  <td className="px-3 py-2 text-center">
                    <TypeToggle
                      value={type ?? null}
                      onChange={(t) => onToggleType(r.canonical_sku, t)}
                      attention={!type}
                    />
                  </td>
                  <td className="px-3 py-2 text-right font-medium text-content">{r.qty}</td>
                  <td className="px-3 py-2 text-muted">
                    {type === 'bike' ? formatTowersLines(r.qty) : '—'}
                  </td>
                  <td className="px-3 py-2 space-x-1">
                    <StatusBadges r={r} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="sm:hidden divide-y divide-subtle">
        {resolved.map((r) => {
          const type = itemTypesBySku[r.canonical_sku];
          return (
            <div key={r.canonical_sku} className={`p-3 space-y-2 ${type ? '' : 'bg-red-500/5'}`}>
              <div className="flex items-start justify-between gap-2">
                <span className="font-mono text-sm font-semibold text-content">
                  {r.canonical_sku}
                </span>
                <span className="text-sm font-semibold whitespace-nowrap text-content">
                  {r.qty}
                  {type === 'bike' && (
                    <span className="text-muted font-normal"> · {formatTowersLines(r.qty)}</span>
                  )}
                </span>
              </div>

              <p className="text-xs text-muted">{r.item_name}</p>

              <div className="flex items-center justify-between gap-2">
                <TypeToggle
                  value={type ?? null}
                  onChange={(t) => onToggleType(r.canonical_sku, t)}
                  attention={!type}
                  large
                />
                <div className="flex flex-wrap justify-end gap-1">
                  <StatusBadges r={r} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function TypeToggle({
  value,
  onChange,
  attention = false,
  large = false,
}: {
  value: ItemType | null;
  onChange: (type: ItemType) => void;
  attention?: boolean;
  large?: boolean;
}) {
  const pad = large ? 'px-3 py-1.5' : 'px-2.5 py-1';
  return (
    <div
      className={`inline-flex items-center p-0.5 rounded-lg border ${
        attention ? 'bg-red-500/10 border-red-400 animate-pulse' : 'bg-main border-subtle'
      }`}
    >
      <button
        type="button"
        onClick={() => onChange('bike')}
        className={`${pad} text-xs font-bold rounded-md transition-all ${
          value === 'bike' ? 'bg-blue-600 text-white shadow-sm' : 'text-muted hover:text-content'
        }`}
      >
        🚲 Bike
      </button>
      <button
        type="button"
        onClick={() => onChange('part')}
        className={`${pad} text-xs font-bold rounded-md transition-all ${
          value === 'part' ? 'bg-amber-500 text-white shadow-sm' : 'text-muted hover:text-content'
        }`}
      >
        📦 Part
      </button>
    </div>
  );
}

/**
 * The containers of the file PickD already has: listed so the file reads
 * whole, never registered again. The units are what went in, next to what the
 * file says -- the check a person would otherwise do by hand.
 */
function AlreadyInPickd({
  containers,
}: {
  containers: { key: string; container: ParsedContainer; intake: ContainerIntake }[];
}) {
  return (
    <section className="rounded-2xl border border-subtle bg-card px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wider text-muted">
        Already in PickD — not registered again
      </p>
      <ul className="mt-2 space-y-1.5">
        {containers.map(({ key, container, intake }) => (
          <li key={key} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
            <span className="font-mono font-semibold text-content">{container.po}</span>
            <span className="text-muted">
              {[
                intake.firstAt ? shortDate(intake.firstAt) : null,
                intake.units > 0 ? `${intake.units} u` : `${intake.stock} u there now`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
            {intake.units > 0 && intake.units !== container.total && (
              <span className="text-amber-500">· the file says {container.total}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function OutcomeRow({ outcome }: { outcome: RegisterOutcome }) {
  if (!outcome.ok) {
    return (
      <li className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm">
        <XCircle className="h-5 w-5 shrink-0 text-red-500" />
        <div className="min-w-0">
          <span className="font-mono font-semibold text-content">{outcome.location}</span>
          <p className="text-red-500">{outcome.error}</p>
        </div>
      </li>
    );
  }
  const { summary } = outcome;
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm">
      <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
      <span className="font-mono font-semibold text-content">{summary.location}</span>
      <span className="text-content">
        {plural(summary.skus, 'SKU')} · {summary.units} u
        {summary.new_skus.length > 0 && ` · ${summary.new_skus.length} new`}
      </span>
    </li>
  );
}

/** What to move out of one registered container, and what stays in it. */
function ContainerReport({
  location,
  resolved,
  titled,
}: {
  location: string;
  resolved: ResolvedItem[];
  titled: boolean;
}) {
  const consolidations = resolved.filter((r) => r.existing_qty > 0);
  const staying = resolved.filter((r) => r.existing_qty <= 0);

  return (
    <div className="space-y-2">
      {titled && <h3 className="font-mono text-sm font-semibold text-content">{location}</h3>}

      {consolidations.length > 0 && (
        <>
          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto rounded-xl border border-subtle">
            <table className="w-full text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">SKU</th>
                  <th className="px-3 py-2 font-medium">In {location}</th>
                  <th className="px-3 py-2 font-medium">Move to</th>
                  <th className="px-3 py-2 font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="text-content">
                {consolidations.map((r) => {
                  const total = r.qty + r.existing_qty;
                  return (
                    <tr key={r.canonical_sku} className="border-t border-subtle">
                      <td className="px-3 py-2 font-mono">{r.canonical_sku}</td>
                      <td className="px-3 py-2">
                        {r.qty} <span className="text-muted">({formatTowersLines(r.qty)})</span>
                      </td>
                      <td className="px-3 py-2">
                        {locLabel(r.existing_locations[0])} · {r.existing_qty}{' '}
                        <span className="text-muted">({formatTowersLines(r.existing_qty)})</span>
                        {r.existing_locations.length > 1 && (
                          <span className="text-amber-500">
                            {' '}
                            +{r.existing_locations.length - 1} more
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-medium">
                        {total} <span className="text-muted">({formatTowersLines(total)})</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden space-y-2">
            {consolidations.map((r) => {
              const total = r.qty + r.existing_qty;
              return (
                <div
                  key={r.canonical_sku}
                  className="rounded-xl border border-subtle bg-card p-3 text-sm text-content"
                >
                  <div className="font-mono mb-2">{r.canonical_sku}</div>
                  <div className="flex justify-between">
                    <span className="text-muted">In {location}</span>
                    <span>
                      {r.qty} <span className="text-muted">({formatTowersLines(r.qty)})</span>
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted">Move to</span>
                    <span className="text-right">
                      {locLabel(r.existing_locations[0])} · {r.existing_qty}{' '}
                      <span className="text-muted">({formatTowersLines(r.existing_qty)})</span>
                      {r.existing_locations.length > 1 && (
                        <span className="text-amber-500"> +{r.existing_locations.length - 1}</span>
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between font-medium">
                    <span className="text-muted">Total</span>
                    <span>
                      {total} <span className="text-muted">({formatTowersLines(total)})</span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {staying.length > 0 && (
        <div className="text-sm text-muted">
          <p className="font-medium mb-1">
            Not consolidated — staying in {location} ({staying.length})
          </p>
          <p className="font-mono text-xs">{staying.map((r) => r.canonical_sku).join(', ')}</p>
        </div>
      )}
    </div>
  );
}

function StatusBadges({ r }: { r: ResolvedItem }) {
  return (
    <>
      {r.is_new && <Badge tone="green">NEW</Badge>}
      {r.merged_from.length > 1 && (
        <Badge tone="blue" title={r.merged_from.join(' + ')}>
          MERGED ×{r.merged_from.length}
        </Badge>
      )}
      {r.existing_qty > 0 && (
        <Badge tone="amber">
          {r.existing_locations.length} loc. · {r.existing_qty}
        </Badge>
      )}
    </>
  );
}

function SummaryBar({
  target,
  skus,
  units,
  extra,
}: {
  target: string;
  skus: number;
  units: number;
  extra?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-2xl border border-subtle bg-card px-4 py-3 text-sm text-content">
      <span>
        <span className="text-muted">Target:</span> <span className="font-medium">{target}</span>
      </span>
      <span>
        <span className="text-muted">SKUs:</span> <span className="font-medium">{skus}</span>
      </span>
      <span>
        <span className="text-muted">Units:</span> <span className="font-medium">{units}</span>
      </span>
      {extra && <span className="text-muted">{extra}</span>}
    </div>
  );
}

function StepBadge({ step }: { step: Step }) {
  const map: Record<Step, string> = {
    upload: '1 · Upload',
    classify: '2 · Classify',
    preview: '3 · Review',
    done: '4 · Report',
  };
  return (
    <span className="ml-auto text-xs rounded-full border border-subtle bg-card px-3 py-1 text-muted whitespace-nowrap">
      {map[step]}
    </span>
  );
}

function Badge({
  children,
  tone,
  title,
}: {
  children: React.ReactNode;
  tone: 'green' | 'blue' | 'amber';
  title?: string;
}) {
  const tones: Record<string, string> = {
    green: 'bg-emerald-500/15 text-emerald-600',
    blue: 'bg-blue-500/15 text-blue-500',
    amber: 'bg-amber-500/15 text-amber-600',
  };
  return (
    <span
      title={title}
      className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
