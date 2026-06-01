import React, { useCallback, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, Upload, Package, ArrowLeft, Copy, CheckCircle2 } from 'lucide-react';
import { parseShipmentXlsx } from './lib/parseShipmentXlsx';
import { formatTowersLines } from './lib/containerDistribution';
import { useRegistrarContainer } from './hooks/useRegistrarContainer';
import type { ContainerInputItem, ParsedSheet, RegisterSummary, ResolvedItem } from './lib/types';

type Step = 'upload' | 'preview' | 'done';

const WAREHOUSES = ['LUDLOW', 'ATS'];

function toInputItems(sheet: ParsedSheet): ContainerInputItem[] {
  return sheet.items.map((i) => ({ sku: i.sku, qty: i.qty, item_name: i.itemName }));
}

function buildReportText(location: string, resolved: ResolvedItem[]): string {
  const lines = ['Consolidation — container ' + location, ''];
  for (const r of resolved) {
    if (r.existing_qty <= 0) continue;
    const target = r.existing_locations[0];
    const loc = target
      ? `${target.location}${target.sublocation?.length ? ' ' + target.sublocation.join(',') : ''}`
      : '—';
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
  const [warehouse, setWarehouse] = useState<string>('LUDLOW');
  const [location, setLocation] = useState<string>('');
  const [orderNumber, setOrderNumber] = useState<string>('');
  const [parsing, setParsing] = useState(false);

  const [resolved, setResolved] = useState<ResolvedItem[]>([]);
  const [summary, setSummary] = useState<RegisterSummary | null>(null);

  const activeSheet = useMemo(
    () => sheets.find((s) => s.name === selectedSheet) ?? null,
    [sheets, selectedSheet]
  );

  const handleFile = useCallback(async (file: File) => {
    setParsing(true);
    try {
      const parsed = await parseShipmentXlsx(file);
      const withItems = parsed.filter((s) => s.items.length > 0);
      setFileName(file.name);
      setSheets(parsed);
      setSelectedSheet(withItems[0]?.name ?? parsed[0]?.name ?? '');
      if (withItems.length === 0) {
        toast.error('No SKU lines found in the file.');
      }
    } catch (err) {
      toast.error(`Could not read the Excel: ${(err as Error).message}`);
    } finally {
      setParsing(false);
    }
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!activeSheet || activeSheet.items.length === 0) {
      toast.error('Select a sheet with lines.');
      return;
    }
    if (!location.trim()) {
      toast.error('Enter the location name (e.g. FLORIDA).');
      return;
    }
    const data = await resolve.mutateAsync({
      items: toInputItems(activeSheet),
      warehouse,
    });
    setResolved(data);
    setStep('preview');
  }, [activeSheet, location, warehouse, resolve]);

  const handleRegister = useCallback(async () => {
    if (!activeSheet) return;
    const result = await register.mutateAsync({
      location: location.trim(),
      items: toInputItems(activeSheet),
      warehouse,
      orderNumber: orderNumber.trim() || null,
    });
    setSummary(result);
    setStep('done');
  }, [activeSheet, location, warehouse, orderNumber, register]);

  const reset = useCallback(() => {
    setStep('upload');
    setFileName('');
    setSheets([]);
    setSelectedSheet('');
    setLocation('');
    setOrderNumber('');
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

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      <header className="flex items-center gap-3 mb-6">
        <Package className="w-6 h-6 text-accent" />
        <h1 className="text-xl font-semibold">Register Container</h1>
        <StepBadge step={step} />
      </header>

      {/* ───────── STEP 1: UPLOAD ───────── */}
      {step === 'upload' && (
        <div className="space-y-5">
          <label className="block border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-accent transition-colors">
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
            {parsing ? (
              <Loader2 className="w-8 h-8 mx-auto animate-spin text-accent" />
            ) : (
              <Upload className="w-8 h-8 mx-auto text-gray-400" />
            )}
            <p className="mt-2 text-sm text-gray-600">
              {fileName || 'Upload the shipment Excel (.xlsx)'}
            </p>
          </label>

          {sheets.length > 0 && (
            <div className="space-y-4 rounded-xl border border-gray-200 p-4">
              <div>
                <p className="text-sm font-medium mb-2">Sheet to import</p>
                <div className="space-y-1">
                  {sheets.map((s) => (
                    <label
                      key={s.name}
                      className={`flex items-center gap-2 text-sm px-2 py-1 rounded ${
                        s.items.length === 0 ? 'opacity-40' : 'cursor-pointer'
                      }`}
                    >
                      <input
                        type="radio"
                        name="sheet"
                        disabled={s.items.length === 0}
                        checked={selectedSheet === s.name}
                        onChange={() => setSelectedSheet(s.name)}
                      />
                      <span className="font-mono">{s.name}</span>
                      <span className="text-gray-500">
                        — {s.items.length} lines · {s.total} units
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Location (new)">
                  <input
                    value={location}
                    onChange={(e) => setLocation(e.target.value.toUpperCase())}
                    placeholder="FLORIDA"
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                  />
                </Field>
                <Field label="Warehouse">
                  <select
                    value={warehouse}
                    onChange={(e) => setWarehouse(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                  >
                    {WAREHOUSES.map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Order # (optional)">
                  <input
                    value={orderNumber}
                    onChange={(e) => setOrderNumber(e.target.value)}
                    placeholder="879908"
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                  />
                </Field>
              </div>

              <button
                onClick={() => void handleAnalyze()}
                disabled={resolve.isPending}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50 sm:w-auto"
              >
                {resolve.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Analyze'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ───────── STEP 2: PREVIEW ───────── */}
      {step === 'preview' && (
        <div className="space-y-4">
          <SummaryBar
            location={location}
            warehouse={warehouse}
            skus={totals.skus}
            units={totals.units}
            extra={`${totals.newCount} new · ${totals.mergedCount} merged`}
          />

          <div className="overflow-x-auto rounded-xl border border-gray-200">
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep('upload')}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <button
              onClick={() => void handleRegister()}
              disabled={register.isPending}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {register.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                `Confirm & register in ${location || '—'}`
              )}
            </button>
          </div>
        </div>
      )}

      {/* ───────── STEP 3: DONE / REPORT ───────── */}
      {step === 'done' && summary && (
        <div className="space-y-5">
          <div className="rounded-xl border border-green-200 bg-green-50 p-4 flex items-center gap-3">
            <CheckCircle2 className="w-6 h-6 text-green-600" />
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

          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Suggested consolidation</h2>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(buildReportText(summary.location, resolved));
                toast.success('Report copied');
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              <Copy className="w-4 h-4" /> Copy
            </button>
          </div>

          {consolidations.length === 0 ? (
            <p className="text-sm text-gray-500">
              No SKU has prior stock — everything stays in {summary.location}.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200">
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
                    const t = r.existing_locations[0];
                    const loc = t
                      ? `${t.location}${t.sublocation?.length ? ' ' + t.sublocation.join(',') : ''}`
                      : '—';
                    const total = r.qty + r.existing_qty;
                    return (
                      <tr key={r.canonical_sku} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-mono">{r.canonical_sku}</td>
                        <td className="px-3 py-2">
                          {r.qty}{' '}
                          <span className="text-gray-400">({formatTowersLines(r.qty)})</span>
                        </td>
                        <td className="px-3 py-2">
                          {loc} · {r.existing_qty}{' '}
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
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Register another container
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-gray-500">{label}</span>
      {children}
    </label>
  );
}

function SummaryBar({
  location,
  warehouse,
  skus,
  units,
  extra,
}: {
  location: string;
  warehouse: string;
  skus: number;
  units: number;
  extra?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
      <span>
        <span className="text-gray-500">Target:</span>{' '}
        <span className="font-medium">
          {warehouse} / {location || '—'}
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
    <span className="ml-auto text-xs rounded-full bg-gray-100 px-3 py-1 text-gray-600">
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
