import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import Camera from 'lucide-react/dist/esm/icons/camera';
import Upload from 'lucide-react/dist/esm/icons/upload';
import Clock from 'lucide-react/dist/esm/icons/clock';
import Copy from 'lucide-react/dist/esm/icons/copy';
import Check from 'lucide-react/dist/esm/icons/check';
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw';
import ScanBarcode from 'lucide-react/dist/esm/icons/scan-barcode';
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle';
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles';
import Database from 'lucide-react/dist/esm/icons/database';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import MapPin from 'lucide-react/dist/esm/icons/map-pin';
import toast from 'react-hot-toast';
import {
  recognizeMultiBoxClient,
  type MultiBoxClientResult,
  type DetectedBoxResult,
  type FieldWithProvenance,
} from '../../lib/recognition/recognizeMultiBoxClient';
import { warmupOcrService } from '../../lib/recognition/clientOcr';

function ProvenanceBadge({ field }: { field?: FieldWithProvenance<string> }) {
  if (!field) return null;
  if (field.status === 'match') {
    return (
      <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 mt-1">
        <CheckCircle2 size={12} className="shrink-0" />
        <span>Coincide con foto</span>
      </div>
    );
  }
  if (field.status === 'discrepancy') {
    return (
      <div className="flex items-start gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400 mt-1 leading-tight">
        <AlertTriangle size={12} className="shrink-0 mt-0.5" />
        <span>Discrepancia: foto dice &ldquo;{field.photoValue}&rdquo;</span>
      </div>
    );
  }
  if (field.status === 'catalog_only') {
    return (
      <span className="text-[10px] text-muted font-medium mt-1 block">
        Sugerencia de catálogo (foto no detectó)
      </span>
    );
  }
  return null;
}

function BoxCard({ box, totalBoxes }: { box: DetectedBoxResult; totalBoxes: number }) {
  const catData = box.catalogData;
  const catStatus = box.catalogStatus;

  return (
    <div className="bg-card border border-subtle rounded-3xl p-5 sm:p-6 shadow-sm space-y-5">
      {/* Box Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-subtle pb-4">
        <div>
          <h2 className="text-base sm:text-lg font-black uppercase tracking-tight text-content">
            Caja {box.boxIndex} de {totalBoxes}
          </h2>
          <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] font-mono text-muted">
            <span>
              BBox: [x:{box.bbox.x}, y:{box.bbox.y}, w:{box.bbox.width}, h:{box.bbox.height}]
            </span>
            {box.anchorsCount > 0 && (
              <>
                <span>•</span>
                <span>
                  {box.anchorsCount} {box.anchorsCount === 1 ? 'ancla' : 'anclas'} (
                  {box.anchors.join(', ')})
                </span>
              </>
            )}
          </div>
        </div>

        {/* Status badges */}
        {catStatus === 'found' && catData ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              {catData.source === 'catalog' ? 'Catálogo Oficial' : 'Inferido de AS400'}
            </span>
            <span
              className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full border ${
                catData.inStock
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                  : 'bg-surface text-muted border-subtle'
              }`}
            >
              {catData.inStock ? `En Stock (${catData.totalStock} u.)` : 'Sin Stock (0 u.)'}
            </span>
          </div>
        ) : catStatus === 'not_found' ? (
          <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
            SKU No Registrado
          </span>
        ) : null}
      </div>

      {/* Catalog Suggestion Section */}
      {catStatus === 'found' && catData && (
        <div className="p-4 bg-surface border border-subtle rounded-2xl space-y-3">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-content">
            <Database size={16} className="text-emerald-500" />
            <span>Sugerencia del Catálogo (PickD Database)</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Modelo */}
            <div className="p-3 bg-card border border-subtle rounded-xl">
              <span className="text-[10px] font-black uppercase tracking-widest text-muted block mb-1">
                Modelo Sugerido
              </span>
              <p className="text-sm font-black uppercase tracking-tight text-content">
                {catData.model ?? '—'}
              </p>
              <ProvenanceBadge field={box.model} />
            </div>

            {/* Talla */}
            <div className="p-3 bg-card border border-subtle rounded-xl">
              <span className="text-[10px] font-black uppercase tracking-widest text-muted block mb-1">
                Talla Sugerida
              </span>
              <p className="text-sm font-black font-mono text-content">{catData.size ?? '—'}</p>
              <ProvenanceBadge field={box.size} />
            </div>

            {/* Color */}
            <div className="p-3 bg-card border border-subtle rounded-xl">
              <span className="text-[10px] font-black uppercase tracking-widest text-muted block mb-1">
                Color Sugerido
              </span>
              <p className="text-sm font-black uppercase tracking-tight text-content">
                {catData.color ?? '—'}
              </p>
              <ProvenanceBadge field={box.color} />
            </div>
          </div>

          {/* Stock Locations and AS400 description */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 text-xs">
            <div className="sm:col-span-4 p-3 bg-card border border-subtle rounded-xl">
              <span className="text-[10px] font-black uppercase tracking-widest text-muted block mb-1">
                Tipo de Artículo
              </span>
              <p className="font-bold text-content">
                {catData.isBike === true
                  ? 'Bicicleta (B-Bike)'
                  : catData.isBike === false
                    ? 'Parte / Repuesto (P-Part)'
                    : 'General'}
              </p>
              {catData.as400Description && (
                <p
                  className="text-[10px] text-muted font-mono mt-1 truncate"
                  title={catData.as400Description}
                >
                  AS400: {catData.as400Description}
                </p>
              )}
            </div>

            <div className="sm:col-span-8 p-3 bg-card border border-subtle rounded-xl">
              <span className="text-[10px] font-black uppercase tracking-widest text-muted flex items-center gap-1 mb-1.5">
                <MapPin size={12} />
                <span>Ubicaciones con Stock ({catData.totalStock} un.)</span>
              </span>
              {catData.stockLocations.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {catData.stockLocations.map((loc, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface border border-subtle text-[11px] font-mono font-bold text-content"
                    >
                      <span>{loc.location}</span>
                      <span className="text-accent font-black">({loc.quantity})</span>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-muted italic">Sin unidades en estantes.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Discrepancy warning alert if any field on this box has discrepancy */}
      {(box.model.status === 'discrepancy' ||
        box.size.status === 'discrepancy' ||
        box.color.status === 'discrepancy' ||
        box.sku.status === 'discrepancy') && (
        <div className="p-3.5 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-amber-700 dark:text-amber-300 text-xs space-y-1">
          <div className="flex items-center gap-1.5 font-bold">
            <AlertTriangle size={14} className="shrink-0" />
            <span>Alerta de Discrepancia entre Foto y Catálogo</span>
          </div>
          {box.model.discrepancyDetail && (
            <p className="text-[11px]">• {box.model.discrepancyDetail}</p>
          )}
          {box.size.discrepancyDetail && (
            <p className="text-[11px]">• {box.size.discrepancyDetail}</p>
          )}
          {box.color.discrepancyDetail && (
            <p className="text-[11px]">• {box.color.discrepancyDetail}</p>
          )}
        </div>
      )}

      {/* Primary Extracted Fields Card Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* SKU */}
        <div className="p-4 bg-surface border border-subtle rounded-2xl">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-muted">
              SKU / Stock No.
            </span>
            {box.sku.photoValue ? (
              <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                Detectado
              </span>
            ) : (
              <span className="text-[9px] font-bold text-muted uppercase">No hallado</span>
            )}
          </div>
          <p className="text-lg font-black font-mono tracking-tight text-content">
            {box.sku.photoValue ?? '—'}
          </p>
          {box.sku.source && (
            <p className="text-[10px] text-muted font-mono mt-0.5">{box.sku.source}</p>
          )}
        </div>

        {/* UPC / GTIN */}
        <div
          className={`p-4 bg-surface border rounded-2xl ${
            box.upc.source?.includes('conflicto')
              ? 'border-amber-500/50 bg-amber-500/5'
              : 'border-subtle'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-muted">
              UPC / EAN
            </span>
            {box.upc.value ? (
              <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                <CheckCircle2 size={10} /> Checksum OK
              </span>
            ) : (
              <span className="text-[9px] font-bold text-muted uppercase">No hallado</span>
            )}
          </div>
          <p className="text-lg font-black font-mono text-content">
            {box.upc.value ?? box.gtin.value ?? '—'}
          </p>
          {(box.upc.source || box.gtin.source) && (
            <p className="text-[10px] text-muted font-mono mt-0.5">
              {box.upc.source || box.gtin.source}
            </p>
          )}
        </div>

        {/* Modelo */}
        <div className="p-4 bg-surface border border-subtle rounded-2xl">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-muted">
              Modelo
            </span>
            {box.model.photoValue && (
              <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20">
                OCR
              </span>
            )}
          </div>
          <p className="text-base font-black uppercase tracking-tight text-content">
            {box.model.photoValue ?? '—'}
          </p>
          {box.model.source && (
            <p className="text-[10px] text-muted font-mono mt-0.5">{box.model.source}</p>
          )}
        </div>

        {/* Color */}
        <div className="p-4 bg-surface border border-subtle rounded-2xl">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-muted">
              Color
            </span>
            {box.color.photoValue && (
              <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20">
                OCR
              </span>
            )}
          </div>
          <p className="text-base font-black uppercase tracking-tight text-content">
            {box.color.photoValue ?? '—'}
          </p>
          {box.color.source && (
            <p className="text-[10px] text-muted font-mono mt-0.5">{box.color.source}</p>
          )}
        </div>

        {/* Talla */}
        <div className="p-4 bg-surface border border-subtle rounded-2xl">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-muted">
              Talla
            </span>
            {box.size.photoValue && (
              <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20">
                OCR
              </span>
            )}
          </div>
          <p className="text-base font-black font-mono text-content">
            {box.size.photoValue ?? '—'}
          </p>
          {box.size.source && (
            <p className="text-[10px] text-muted font-mono mt-0.5">{box.size.source}</p>
          )}
        </div>

        {/* Peso Bruto (G.W.) */}
        <div className="p-4 bg-surface border border-subtle rounded-2xl">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-muted">
              Peso Bruto (G.W.)
            </span>
            {box.gw_kg.value != null && (
              <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20">
                OCR
              </span>
            )}
          </div>
          <p className="text-base font-black font-mono text-content">
            {box.gw_kg.value != null ? `${box.gw_kg.value} kg` : '—'}
          </p>
          {box.gw_kg.source && (
            <p className="text-[10px] text-muted font-mono mt-0.5">{box.gw_kg.source}</p>
          )}
        </div>

        {/* Serie / Frame */}
        <div className="p-4 bg-surface border border-subtle rounded-2xl">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-muted">
              Serie / Frame
            </span>
            {box.serial.value && (
              <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-accent/10 text-accent border border-accent/20">
                {box.serial.source?.includes('factory_qr') ? 'QR' : 'Detectado'}
              </span>
            )}
          </div>
          <p className="text-base font-black font-mono text-content">{box.serial.value ?? '—'}</p>
          {box.serial.source && (
            <p className="text-[10px] text-muted font-mono mt-0.5">{box.serial.source}</p>
          )}
        </div>

        {/* Cartón & Orden */}
        <div className="p-4 bg-surface border border-subtle rounded-2xl">
          <span className="text-[10px] font-black uppercase tracking-widest text-muted block mb-1">
            Cartón / PO
          </span>
          <div className="flex items-baseline gap-3">
            <div>
              <span className="text-[10px] text-muted">Cartón: </span>
              <span className="text-sm font-bold text-content font-mono">
                {box.carton.value ?? '—'}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-muted">PO: </span>
              <span className="text-sm font-bold text-content font-mono">
                {box.po.value ?? '—'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Símbolos Decodificados para esta caja */}
      {box.barcodes.length > 0 && (
        <div className="p-4 bg-surface border border-subtle rounded-2xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-content">
              Símbolos de esta caja ({box.barcodes.length})
            </span>
          </div>
          <div className="space-y-1.5">
            {box.barcodes.map((barcode, bIdx) => (
              <div
                key={bIdx}
                className="p-2.5 bg-card border border-subtle rounded-xl flex items-center justify-between gap-2 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="px-2 py-0.5 rounded bg-accent/10 border border-accent/20 text-accent font-black text-[10px] font-mono shrink-0">
                    {barcode.format}
                  </span>
                  <span className="font-mono text-content font-bold truncate">{barcode.text}</span>
                </div>
                <span className="text-[10px] text-muted font-mono shrink-0">
                  {barcode.hits} {barcode.hits === 1 ? 'pase' : 'pases'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function LabelTestScreen() {
  const navigate = useNavigate();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [liveElapsedMs, setLiveElapsedMs] = useState<number>(0);
  const [result, setResult] = useState<MultiBoxClientResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedResult, setCopiedResult] = useState(false);

  // Warm up OCR engine and ONNX session in background on mount (A3b-perf)
  useEffect(() => {
    warmupOcrService().catch(() => {});
  }, []);

  // Clean up object URL when image changes or unmounts
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  // Live stopwatch timer ticker
  useEffect(() => {
    let animId: number;
    let startTime: number;

    if (isProcessing) {
      startTime = performance.now();
      const tick = () => {
        setLiveElapsedMs(performance.now() - startTime);
        animId = requestAnimationFrame(tick);
      };
      animId = requestAnimationFrame(tick);
    }

    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [isProcessing]);

  const processImageFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) {
        toast.error('El archivo debe ser una imagen');
        return;
      }

      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }

      const newUrl = URL.createObjectURL(file);
      setSelectedImage(file);
      setPreviewUrl(newUrl);
      setResult(null);
      setError(null);
      setIsProcessing(true);
      setLiveElapsedMs(0);

      try {
        const multiResult = await recognizeMultiBoxClient(file, file.name);
        setResult(multiResult);
        setLiveElapsedMs(multiResult.timingMs.total);
        toast.success(
          `${multiResult.totalBoxes} ${multiResult.totalBoxes === 1 ? 'caja detectada' : 'cajas detectadas'} en ${(multiResult.timingMs.total / 1000).toFixed(2)}s`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Error al procesar la imagen';
        setError(msg);
        toast.error(msg);
      } finally {
        setIsProcessing(false);
      }
    },
    [previewUrl]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processImageFile(files[0]);
    }
    // Reset inputs so the same file can be selected again
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processImageFile(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleCopyResult = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.summaryText);
      setCopiedResult(true);
      toast.success(
        `Resultado copiado (${result.totalBoxes} ${result.totalBoxes === 1 ? 'caja' : 'cajas'})`
      );
      setTimeout(() => setCopiedResult(false), 2500);
    } catch {
      toast.error('No se pudo copiar al portapapeles');
    }
  };

  const resetCapture = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setSelectedImage(null);
    setPreviewUrl(null);
    setResult(null);
    setError(null);
    setLiveElapsedMs(0);
  };

  return (
    <div className="min-h-screen bg-main text-content p-3 sm:p-6 pb-24 font-sans">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Top Navigation / Header */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted hover:text-accent p-2 -ml-2 rounded-xl transition-colors"
          >
            <ArrowLeft size={18} />
            <span>Volver</span>
          </button>
          <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full text-emerald-600 dark:text-emerald-400 text-[11px] font-bold">
            <ShieldCheck size={14} />
            <span>100% Cómputo Cliente · Cero Persistencia</span>
          </div>
        </div>

        {/* Header Title */}
        <div className="bg-card border border-subtle rounded-3xl p-6 relative overflow-hidden shadow-sm">
          <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none">
            <ScanBarcode size={180} />
          </div>
          <div className="flex items-start gap-4">
            <div className="p-3.5 bg-accent/10 border border-accent/20 rounded-2xl text-accent shrink-0">
              <ScanBarcode size={32} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl sm:text-3xl font-black uppercase tracking-tight text-content">
                  Test de Reconocimiento de Etiquetas
                </h1>
              </div>
              <p className="text-xs sm:text-sm text-muted mt-1 max-w-2xl font-medium">
                Módulo de prueba del camino rápido (A3b). Lee códigos de barras a resolución
                completa con pases multi-escala, evalúa checksums y extrae datos de caja sin guardar
                nada en base de datos.
              </p>
            </div>
          </div>
        </div>

        {/* Hidden Inputs for Camera and File Picker */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileChange}
          className="hidden"
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
        />

        {/* Capture / Select Photo Buttons */}
        {!selectedImage ? (
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            className="border-2 border-dashed border-subtle hover:border-accent/50 rounded-3xl p-8 sm:p-12 text-center transition-all bg-card/40 backdrop-blur-sm"
          >
            <div className="w-16 h-16 mx-auto mb-4 bg-accent/10 border border-accent/20 rounded-2xl flex items-center justify-center text-accent">
              <Camera size={32} />
            </div>
            <h2 className="text-lg font-black uppercase tracking-tight text-content">
              Captura o Selecciona una Etiqueta
            </h2>
            <p className="text-xs text-muted max-w-md mx-auto mt-1 mb-6">
              Usa la cámara del teléfono para fotografiar una caja o sube una imagen de prueba del
              banco local.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 max-w-md mx-auto">
              <button
                onClick={() => cameraInputRef.current?.click()}
                className="w-full sm:w-auto flex-1 flex items-center justify-center gap-2.5 px-6 py-4 bg-accent hover:bg-accent/90 text-white rounded-2xl font-black text-xs uppercase tracking-wider shadow-lg shadow-accent/20 transition-transform active:scale-[0.98]"
              >
                <Camera size={18} />
                <span>Tomar Foto</span>
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full sm:w-auto flex-1 flex items-center justify-center gap-2.5 px-6 py-4 bg-surface hover:bg-surface/80 border border-subtle hover:border-accent/40 text-content rounded-2xl font-bold text-xs uppercase tracking-wider transition-colors"
              >
                <Upload size={18} className="text-muted" />
                <span>Elegir Archivo</span>
              </button>
            </div>
            <p className="text-[10px] text-muted font-mono mt-4 uppercase tracking-widest">
              O arrastra una imagen aquí
            </p>
          </div>
        ) : (
          /* Image Selected & Live Processing View */
          <div className="space-y-6">
            {/* Live Timer Banner */}
            <div
              className={`p-5 rounded-3xl border transition-all ${
                isProcessing
                  ? 'bg-accent/10 border-accent/30 animate-pulse'
                  : result
                    ? 'bg-card border-subtle shadow-sm'
                    : 'bg-card border-subtle'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <div
                    className={`p-3 rounded-2xl ${
                      isProcessing
                        ? 'bg-accent text-white animate-spin'
                        : result
                          ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                          : 'bg-surface text-muted'
                    }`}
                  >
                    <Clock size={24} />
                  </div>
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-muted block">
                      {isProcessing ? 'Procesando en cliente...' : 'Tiempo medido'}
                    </span>
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-black font-mono tracking-tight text-content">
                        {liveElapsedMs.toFixed(1)}
                      </span>
                      <span className="text-sm font-bold text-muted">ms</span>
                      <span className="text-xs font-mono font-bold text-accent">
                        ({(liveElapsedMs / 1000).toFixed(2)}s)
                      </span>
                    </div>
                    {result && (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] font-mono text-muted">
                        <span>
                          Barras:{' '}
                          <strong className="text-content">
                            {result.timingMs.barcodes.toFixed(1)} ms
                          </strong>
                        </span>
                        <span>•</span>
                        <span>
                          OCR:{' '}
                          <strong className="text-content">
                            {result.timingMs.ocr.toFixed(1)} ms
                          </strong>
                        </span>
                        <span>•</span>
                        <span>
                          Segmentación:{' '}
                          <strong className="text-content">
                            {result.timingMs.segmentation.toFixed(1)} ms
                          </strong>
                        </span>
                        <span>•</span>
                        <span>
                          Catálogo:{' '}
                          <strong className="text-content">
                            {result.timingMs.catalog.toFixed(1)} ms
                          </strong>
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions when finished */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => cameraInputRef.current?.click()}
                    disabled={isProcessing}
                    className="flex items-center gap-1.5 px-3 py-2 bg-surface border border-subtle hover:border-accent/40 text-content rounded-xl text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
                  >
                    <Camera size={14} />
                    <span className="hidden sm:inline">Tomar otra</span>
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isProcessing}
                    className="flex items-center gap-1.5 px-3 py-2 bg-surface border border-subtle hover:border-accent/40 text-content rounded-xl text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
                  >
                    <Upload size={14} />
                    <span className="hidden sm:inline">Cambiar</span>
                  </button>
                  <button
                    onClick={resetCapture}
                    disabled={isProcessing}
                    className="p-2 bg-surface border border-subtle hover:border-red-500/30 text-muted hover:text-red-500 rounded-xl transition-colors disabled:opacity-50"
                    title="Reiniciar"
                  >
                    <RotateCcw size={16} />
                  </button>
                </div>
              </div>
            </div>

            {/* Main Content Grid: Preview + Extracted Results */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column: Image Thumbnail + File Info */}
              <div className="lg:col-span-4 space-y-3">
                <div className="bg-card border border-subtle rounded-3xl p-3 overflow-hidden shadow-sm">
                  {previewUrl && (
                    <div className="relative rounded-2xl overflow-hidden bg-black/50 aspect-[3/4] flex items-center justify-center">
                      <img
                        src={previewUrl}
                        alt="Etiqueta capturada"
                        className="w-full h-full object-contain"
                      />
                      {isProcessing && (
                        <div className="absolute inset-0 bg-main/70 backdrop-blur-xs flex flex-col items-center justify-center p-4 text-center">
                          <div className="w-10 h-10 border-4 border-accent border-t-transparent rounded-full animate-spin mb-3" />
                          <p className="text-xs font-bold uppercase tracking-wider text-content">
                            Escaneando barras y texto...
                          </p>
                          <p className="text-[10px] text-muted mt-1">
                            zxing-wasm multi-pass + PP-OCRv6 tiny
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="p-3 text-[11px] text-muted font-mono space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted">Archivo:</span>
                      <span className="font-bold text-content truncate max-w-[150px]">
                        {selectedImage.name}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Tamaño:</span>
                      <span className="text-content">
                        {(selectedImage.size / (1024 * 1024)).toFixed(2)} MB
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Formato:</span>
                      <span className="text-content">{selectedImage.type || 'image/jpeg'}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Extracted Fields & Detection Summary */}
              <div className="lg:col-span-8 space-y-4">
                {error && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 flex items-center gap-3 text-red-500">
                    <AlertCircle size={20} className="shrink-0" />
                    <p className="text-xs font-semibold">{error}</p>
                  </div>
                )}

                {result && (
                  <>
                    {/* Header Bar with Cajas detectadas: N & Copy Button */}
                    <div className="bg-card border border-subtle rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3 shadow-sm">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 bg-accent/10 border border-accent/20 rounded-xl text-accent">
                          <Sparkles size={18} />
                        </div>
                        <div>
                          <h2 className="text-base font-black uppercase tracking-tight text-content">
                            Cajas detectadas: {result.totalBoxes}
                          </h2>
                          <p className="text-[11px] text-muted font-medium">
                            Segmentación 2D y extracción discreta por caja
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={handleCopyResult}
                        className="flex items-center gap-1.5 px-3.5 py-2.5 bg-accent hover:bg-accent/90 text-white rounded-xl text-xs font-black uppercase tracking-wider shadow-sm transition-all active:scale-[0.98]"
                      >
                        {copiedResult ? <Check size={14} /> : <Copy size={14} />}
                        <span>{copiedResult ? 'Copiado' : 'Copiar resultado'}</span>
                      </button>
                    </div>

                    {/* Detected Box Cards List */}
                    <div className="space-y-4">
                      {result.boxes.map((box) => (
                        <BoxCard key={box.id} box={box} totalBoxes={result.totalBoxes} />
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
