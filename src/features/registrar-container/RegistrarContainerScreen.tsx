import React, { useCallback, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, Upload, Package, ArrowLeft, Copy, CheckCircle2 } from 'lucide-react';
import { parseShipmentXlsx } from './lib/parseShipmentXlsx';
import { formatTowersLines } from './lib/containerDistribution';
import { useRegistrarContainer } from './hooks/useRegistrarContainer';
import type { ContainerInputItem, ParsedSheet, RegisterSummary, ResolvedItem } from './lib/types';

type Step = 'upload' | 'preview' | 'done';

// Stock from these container imports always lands in the LUDLOW warehouse.
const WAREHOUSE = 'LUDLOW';

function toInputItems(sheet: ParsedSheet): ContainerInputItem[] {
  return sheet.items.map((i) => ({ sku: i.sku, qty: i.qty, item_name: i.itemName }));
}

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

export function RegistrarContainerScreen() {
  const { resolve, register } = useRegistrarContainer();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState<string>('');
  const [sheets, setSheets] = useState<ParsedSheet[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [location, setLocation] = useState<string>('');
  const [parsing, setParsing] = useState(false);

  const [resolved, setResolved] = useState<ResolvedItem[]>([]);
  const [summary, setSummary] = useState<RegisterSummary | null>(null);

  const activeSheet = useMemo(
    () => sheets.find((s) => s.name === selectedSheet) ?? null,
    [sheets, selectedSheet]
  );
  const sheetsWithItems = useMemo(() => sheets.filter((s) => s.items.length > 0), [sheets]);

  // Resolve a sheet and move straight to the preview — no manual "Analyze" step.
  const analyzeSheet = useCallback(
    async (sheet: ParsedSheet) => {
      const data = await resolve.mutateAsync({
        items: toInputItems(sheet),
        warehouse: WAREHOUSE,
      });
      setResolved(data);
      setStep('preview');
    },
    [resolve]
  );

  const handleFile = useCallback(
    async (file: File) => {
      setParsing(true);
      try {
        const parsed = await parseShipmentXlsx(file);
        const withItems = parsed.filter((s) => s.items.length > 0);
        setFileName(file.name);
        setSheets(parsed);
        if (withItems.length === 0) {
          toast.error('No SKU lines found in the file.');
          return;
        }
        setSelectedSheet(withItems[0].name);
        // Single sheet → analyze automatically. Multiple → let the user pick
        // (picking a sheet triggers the analysis; still no button).
        if (withItems.length === 1) {
          await analyzeSheet(withItems[0]);
        }
      } catch (err) {
        toast.error(`Could not read the Excel: ${(err as Error).message}`);
      } finally {
        setParsing(false);
      }
    },
    [analyzeSheet]
  );

  const handleSelectSheet = useCallback(
    async (name: string) => {
      setSelectedSheet(name);
      const sheet = sheets.find((s) => s.name === name);
      if (sheet && sheet.items.length > 0) await analyzeSheet(sheet);
    },
    [sheets, analyzeSheet]
  );

  const handleRegister = useCallback(async () => {
    if (!activeSheet) return;
    if (!location.trim()) {
      toast.error('Enter the location name (e.g. FLORIDA).');
      return;
    }
    const result = await register.mutateAsync({
      location: location.trim(),
      items: toInputItems(activeSheet),
      warehouse: WAREHOUSE,
      orderNumber: null,
    });
    setSummary(result);
    setStep('done');
  }, [activeSheet, location, register]);

  const reset = useCallback(() => {
    setStep('upload');
    setFileName('');
    setSheets([]);
    setSelectedSheet('');
    setLocation('');
    setResolved([]);
    setSummary(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const totals = useMemo(() => {
    const units = resolved.reduce((s, r) => s + r.qty, 0);
    const newCount = resolved.filter((r) => r.is_new).length;
    const mergedCount = resolved.filter((r) => r.merged_from.length > 1).length;
    return { skus: resolved.length, units, newCount, mergedCount };
  }, [resolved]);

  const consolidations = useMemo(() => resolved.filter((r) => r.existing_qty > 0), [resolved]);
  const newPlacements = useMemo(() => resolved.filter((r) => r.existing_qty <= 0), [resolved]);

  const analyzing = resolve.isPending;

  return (
    <div
      className={`max-w-5xl mx-auto p-3 sm:p-6 ${step === 'preview' ? 'pb-44' : 'pb-24 sm:pb-6'}`}
    >
      <header className="flex items-center gap-3 mb-5 sm:mb-6">
        <Package className="w-6 h-6 text-accent shrink-0" />
        <h1 className="text-lg sm:text-xl font-semibold">Register Container</h1>
        <StepBadge step={step} />
      </header>

      {/* ───────── STEP 1: UPLOAD ───────── */}
      {step === 'upload' && (
        <div className="space-y-5">
          <label className="block border-2 border-dashed border-gray-300 rounded-2xl p-10 sm:p-8 text-center cursor-pointer hover:border-accent active:border-accent transition-colors">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
            {parsing || analyzing ? (
              <Loader2 className="w-9 h-9 mx-auto animate-spin text-accent" />
            ) : (
              <Upload className="w-9 h-9 mx-auto text-gray-400" />
            )}
            <p className="mt-3 text-sm text-gray-600">
              {analyzing ? 'Analyzing…' : fileName || 'Tap to upload the shipment Excel (.xlsx)'}
            </p>
            {!fileName && !analyzing && (
              <p className="mt-1 text-xs text-gray-400">It analyzes automatically</p>
            )}
          </label>

          {/* Sheet picker only when the file has more than one sheet with items. */}
          {sheetsWithItems.length > 1 && (
            <div className="rounded-2xl border border-gray-200 p-4">
              <p className="text-sm font-medium mb-2">Pick the sheet to import</p>
              <div className="space-y-1">
                {sheetsWithItems.map((s) => (
                  <label
                    key={s.name}
                    className="flex items-center gap-3 text-sm px-2 py-3 rounded-lg cursor-pointer active:bg-gray-50"
                  >
                    <input
                      type="radio"
                      name="sheet"
                      className="w-4 h-4"
                      checked={selectedSheet === s.name}
                      onChange={() => void handleSelectSheet(s.name)}
                    />
                    <span className="font-mono">{s.name}</span>
                    <span className="text-gray-500">
                      — {s.items.length} lines · {s.total} units
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ───────── STEP 2: PREVIEW ───────── */}
      {step === 'preview' && (
        <div className="space-y-4">
          {/* The only thing the user enters: the destination location name. */}
          <div className="rounded-2xl border border-gray-200 p-4">
            <label className="block">
              <span className="text-xs text-gray-500">
                Location name (where this container lands)
              </span>
              <input
                autoFocus
                value={location}
                onChange={(e) => setLocation(e.target.value.toUpperCase())}
                placeholder="FLORIDA"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-3 text-base focus:border-accent focus:outline-none"
              />
            </label>
          </div>

          <SummaryBar
            location={location}
            skus={totals.skus}
            units={totals.units}
            extra={`${totals.newCount} new · ${totals.mergedCount} merged`}
          />

          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-500">
                <tr>
                  <th className="px-3 py-2">Canonical SKU</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2">Towers/Lines</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {resolved.map((r) => (
                  <tr key={r.canonical_sku} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-mono">{r.canonical_sku}</td>
                    <td className="px-3 py-2 text-gray-600">{r.item_name}</td>
                    <td className="px-3 py-2 text-right font-medium">{r.qty}</td>
                    <td className="px-3 py-2">{r.is_bike ? formatTowersLines(r.qty) : '—'}</td>
                    <td className="px-3 py-2 space-x-1">
                      <StatusBadges r={r} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden space-y-2">
            {resolved.map((r) => (
              <div key={r.canonical_sku} className="rounded-xl border border-gray-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono text-sm">{r.canonical_sku}</span>
                  <span className="text-sm font-semibold whitespace-nowrap">
                    {r.qty}
                    {r.is_bike && (
                      <span className="text-gray-400 font-normal">
                        {' '}
                        · {formatTowersLines(r.qty)}
                      </span>
                    )}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-gray-600">{r.item_name}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  <StatusBadges r={r} />
                </div>
              </div>
            ))}
          </div>

          {/* Actions — float ABOVE the app's bottom nav, always visible (no need
              to scroll to the end). The nav bar is fixed bottom-0 h-24 z-[100],
              so we sit at bottom-24 with z-40. */}
          <div className="fixed inset-x-0 bottom-24 z-40 px-3 sm:px-6 pointer-events-none">
            <div className="mx-auto flex max-w-5xl flex-col-reverse gap-2 rounded-2xl border border-gray-200 bg-white/95 p-3 shadow-lg backdrop-blur pointer-events-auto sm:flex-row sm:gap-3">
              <button
                onClick={reset}
                className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-gray-300 px-3 py-3 text-sm text-gray-600 active:bg-gray-50 sm:w-auto sm:py-2"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button
                onClick={() => void handleRegister()}
                disabled={register.isPending}
                className="inline-flex w-full flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-4 py-3 text-sm font-medium text-white disabled:opacity-50 sm:py-2"
              >
                {register.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  `Confirm & register in ${location || '—'}`
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ───────── STEP 3: DONE / REPORT ───────── */}
      {step === 'done' && summary && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-green-200 bg-green-50 p-4 flex items-center gap-3">
            <CheckCircle2 className="w-6 h-6 text-green-600 shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-green-800">
                {summary.skus} SKUs · {summary.units} units in {summary.warehouse} /{' '}
                {summary.location}
              </p>
              {summary.new_skus.length > 0 && (
                <p className="text-green-700">{summary.new_skus.length} new SKUs registered</p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">Suggested consolidation</h2>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(buildReportText(summary.location, resolved));
                toast.success('Report copied');
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 active:bg-gray-50 shrink-0"
            >
              <Copy className="w-4 h-4" /> Copy
            </button>
          </div>

          {consolidations.length === 0 ? (
            <p className="text-sm text-gray-500">
              No SKU has prior stock — everything stays in {summary.location}.
            </p>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden sm:block overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-left text-gray-500">
                    <tr>
                      <th className="px-3 py-2">SKU</th>
                      <th className="px-3 py-2">In {summary.location}</th>
                      <th className="px-3 py-2">Move to</th>
                      <th className="px-3 py-2">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {consolidations.map((r) => {
                      const total = r.qty + r.existing_qty;
                      return (
                        <tr key={r.canonical_sku} className="border-t border-gray-100">
                          <td className="px-3 py-2 font-mono">{r.canonical_sku}</td>
                          <td className="px-3 py-2">
                            {r.qty}{' '}
                            <span className="text-gray-400">({formatTowersLines(r.qty)})</span>
                          </td>
                          <td className="px-3 py-2">
                            {locLabel(r.existing_locations[0])} · {r.existing_qty}{' '}
                            <span className="text-gray-400">
                              ({formatTowersLines(r.existing_qty)})
                            </span>
                            {r.existing_locations.length > 1 && (
                              <span className="text-amber-600">
                                {' '}
                                +{r.existing_locations.length - 1} more
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-medium">
                            {total}{' '}
                            <span className="text-gray-400">({formatTowersLines(total)})</span>
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
                      className="rounded-xl border border-gray-200 p-3 text-sm"
                    >
                      <div className="font-mono mb-2">{r.canonical_sku}</div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">In {summary.location}</span>
                        <span>
                          {r.qty}{' '}
                          <span className="text-gray-400">({formatTowersLines(r.qty)})</span>
                        </span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-gray-500">Move to</span>
                        <span className="text-right">
                          {locLabel(r.existing_locations[0])} · {r.existing_qty}{' '}
                          <span className="text-gray-400">
                            ({formatTowersLines(r.existing_qty)})
                          </span>
                          {r.existing_locations.length > 1 && (
                            <span className="text-amber-600">
                              {' '}
                              +{r.existing_locations.length - 1}
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between font-medium">
                        <span className="text-gray-500">Total</span>
                        <span>
                          {total}{' '}
                          <span className="text-gray-400">({formatTowersLines(total)})</span>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {newPlacements.length > 0 && (
            <div className="text-sm text-gray-600">
              <p className="font-medium mb-1">
                Not consolidated — staying in {summary.location} ({newPlacements.length})
              </p>
              <p className="font-mono text-xs text-gray-500">
                {newPlacements.map((r) => r.canonical_sku).join(', ')}
              </p>
            </div>
          )}

          <button
            onClick={reset}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-3 text-sm font-medium text-white disabled:opacity-50 sm:w-auto sm:py-2"
          >
            Register another container
          </button>
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
  location,
  skus,
  units,
  extra,
}: {
  location: string;
  skus: number;
  units: number;
  extra?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
      <span>
        <span className="text-gray-500">Target:</span>{' '}
        <span className="font-medium">
          {WAREHOUSE} / {location || '—'}
        </span>
      </span>
      <span>
        <span className="text-gray-500">SKUs:</span> <span className="font-medium">{skus}</span>
      </span>
      <span>
        <span className="text-gray-500">Units:</span> <span className="font-medium">{units}</span>
      </span>
      {extra && <span className="text-gray-500">{extra}</span>}
    </div>
  );
}

function StepBadge({ step }: { step: Step }) {
  const map: Record<Step, string> = {
    upload: '1 · Upload',
    preview: '2 · Review',
    done: '3 · Report',
  };
  return (
    <span className="ml-auto text-xs rounded-full bg-gray-100 px-3 py-1 text-gray-600 whitespace-nowrap">
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
    green: 'bg-green-100 text-green-700',
    blue: 'bg-blue-100 text-blue-700',
    amber: 'bg-amber-100 text-amber-700',
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
