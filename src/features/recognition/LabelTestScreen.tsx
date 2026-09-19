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
import Code2 from 'lucide-react/dist/esm/icons/code-2';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle';
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles';
import toast from 'react-hot-toast';
import {
  recognizeLabelClient,
  type ClientRecognitionResult,
} from '../../lib/recognition/recognizeLabelClient';

export function LabelTestScreen() {
  const navigate = useNavigate();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [liveElapsedMs, setLiveElapsedMs] = useState<number>(0);
  const [result, setResult] = useState<ClientRecognitionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);

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
        const recognitionResult = await recognizeLabelClient(file, file.name);
        setResult(recognitionResult);
        setLiveElapsedMs(recognitionResult.timingMs.total);
        toast.success(
          `Etiqueta analizada en ${(recognitionResult.timingMs.total / 1000).toFixed(2)}s`
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

  const handleCopySummary = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.summaryText);
      setCopiedSummary(true);
      toast.success('Resumen copiado al portapapeles');
      setTimeout(() => setCopiedSummary(false), 2500);
    } catch {
      toast.error('No se pudo copiar al portapapeles');
    }
  };

  const handleCopyJson = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
      setCopiedJson(true);
      toast.success('JSON copiado al portapapeles');
      setTimeout(() => setCopiedJson(false), 2500);
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
                      <div className="flex items-center gap-3 mt-1 text-[11px] font-mono text-muted">
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
                    {/* Copy Actions Bar */}
                    <div className="bg-card border border-subtle rounded-2xl p-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Sparkles size={16} className="text-accent" />
                        <span className="text-xs font-bold uppercase tracking-wider text-content">
                          Resultado de Extracción (Barras + OCR)
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleCopySummary}
                          className="flex items-center gap-1.5 px-3 py-2 bg-accent hover:bg-accent/90 text-white rounded-xl text-xs font-black uppercase tracking-wider shadow-sm transition-all active:scale-[0.98]"
                        >
                          {copiedSummary ? <Check size={14} /> : <Copy size={14} />}
                          <span>{copiedSummary ? 'Copiado' : 'Copiar Resumen'}</span>
                        </button>
                        <button
                          onClick={handleCopyJson}
                          className="flex items-center gap-1.5 px-3 py-2 bg-surface hover:bg-surface/80 border border-subtle text-content rounded-xl text-xs font-bold uppercase tracking-wider transition-colors"
                        >
                          {copiedJson ? <Check size={14} /> : <Code2 size={14} />}
                          <span>{copiedJson ? 'Copiado' : 'JSON'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Primary Extracted Fields Card Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* SKU */}
                      <div className="p-4 bg-card border border-subtle rounded-2xl">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-black uppercase tracking-widest text-muted">
                            SKU / Stock No.
                          </span>
                          {result.extractedFields.sku ? (
                            <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                              Detectado
                            </span>
                          ) : (
                            <span className="text-[9px] font-bold text-muted uppercase">
                              No hallado
                            </span>
                          )}
                        </div>
                        <p className="text-lg font-black font-mono tracking-tight text-content">
                          {result.extractedFields.sku ?? '—'}
                        </p>
                        {result.fieldSources.sku && (
                          <p className="text-[10px] text-muted font-mono mt-0.5">
                            {result.fieldSources.sku}
                          </p>
                        )}
                      </div>

                      {/* UPC */}
                      <div className="p-4 bg-card border border-subtle rounded-2xl">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-black uppercase tracking-widest text-muted">
                            UPC / EAN
                          </span>
                          {result.extractedFields.upc ? (
                            <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                              <CheckCircle2 size={10} /> Checksum OK
                            </span>
                          ) : (
                            <span className="text-[9px] font-bold text-muted uppercase">
                              No hallado
                            </span>
                          )}
                        </div>
                        <p className="text-lg font-black font-mono tracking-tight text-content">
                          {result.extractedFields.upc ?? '—'}
                        </p>
                        {result.fieldSources.upc && (
                          <p className="text-[10px] text-muted font-mono mt-0.5">
                            {result.fieldSources.upc}
                          </p>
                        )}
                      </div>

                      {/* Modelo */}
                      <div className="p-4 bg-card border border-subtle rounded-2xl">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-black uppercase tracking-widest text-muted">
                            Modelo
                          </span>
                          {result.extractedFields.model && (
                            <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20">
                              OCR
                            </span>
                          )}
                        </div>
                        <p className="text-base font-black uppercase tracking-tight text-content">
                          {result.extractedFields.model ?? '—'}
                        </p>
                        {result.fieldSources.model && (
                          <p className="text-[10px] text-muted font-mono mt-0.5">
                            {result.fieldSources.model}
                          </p>
                        )}
                      </div>

                      {/* Color */}
                      <div className="p-4 bg-card border border-subtle rounded-2xl">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-black uppercase tracking-widest text-muted">
                            Color
                          </span>
                          {result.extractedFields.color && (
                            <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20">
                              OCR
                            </span>
                          )}
                        </div>
                        <p className="text-base font-black uppercase tracking-tight text-content">
                          {result.extractedFields.color ?? '—'}
                        </p>
                        {result.fieldSources.color && (
                          <p className="text-[10px] text-muted font-mono mt-0.5">
                            {result.fieldSources.color}
                          </p>
                        )}
                      </div>

                      {/* Talla */}
                      <div className="p-4 bg-card border border-subtle rounded-2xl">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-black uppercase tracking-widest text-muted">
                            Talla
                          </span>
                          {result.extractedFields.size && (
                            <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20">
                              OCR
                            </span>
                          )}
                        </div>
                        <p className="text-base font-black font-mono text-content">
                          {result.extractedFields.size ?? '—'}
                        </p>
                        {result.fieldSources.size && (
                          <p className="text-[10px] text-muted font-mono mt-0.5">
                            {result.fieldSources.size}
                          </p>
                        )}
                      </div>

                      {/* Peso Bruto (G.W.) */}
                      <div className="p-4 bg-card border border-subtle rounded-2xl">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-black uppercase tracking-widest text-muted">
                            Peso Bruto (G.W.)
                          </span>
                          {result.extractedFields.gw_kg != null && (
                            <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20">
                              OCR
                            </span>
                          )}
                        </div>
                        <p className="text-base font-black font-mono text-content">
                          {result.extractedFields.gw_kg != null
                            ? `${result.extractedFields.gw_kg} kg`
                            : '—'}
                        </p>
                        {result.fieldSources.gw_kg && (
                          <p className="text-[10px] text-muted font-mono mt-0.5">
                            {result.fieldSources.gw_kg}
                          </p>
                        )}
                      </div>

                      {/* Serie / Frame */}
                      <div className="p-4 bg-card border border-subtle rounded-2xl">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-black uppercase tracking-widest text-muted">
                            Serie / Frame
                          </span>
                          {result.extractedFields.serial && (
                            <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-accent/10 text-accent border border-accent/20">
                              {result.fieldSources.serial?.includes('factory_qr')
                                ? 'QR'
                                : 'Detectado'}
                            </span>
                          )}
                        </div>
                        <p className="text-base font-black font-mono text-content">
                          {result.extractedFields.serial ?? '—'}
                        </p>
                        {result.fieldSources.serial && (
                          <p className="text-[10px] text-muted font-mono mt-0.5">
                            {result.fieldSources.serial}
                          </p>
                        )}
                      </div>

                      {/* Cartón & Orden */}
                      <div className="p-4 bg-card border border-subtle rounded-2xl">
                        <span className="text-[10px] font-black uppercase tracking-widest text-muted block mb-1">
                          Cartón / PO
                        </span>
                        <div className="flex items-baseline gap-3">
                          <div>
                            <span className="text-[10px] text-muted">Cartón: </span>
                            <span className="text-sm font-bold text-content font-mono">
                              {result.extractedFields.carton ?? '—'}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-muted">PO: </span>
                            <span className="text-sm font-bold text-content font-mono">
                              {result.extractedFields.order ?? '—'}
                            </span>
                          </div>
                        </div>
                        {result.extractedFields.factoryCode && (
                          <p className="text-[10px] text-muted font-mono mt-1">
                            Fábrica: {result.extractedFields.factoryCode}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Detected Barcodes List */}
                    <div className="bg-card border border-subtle rounded-2xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-xs font-black uppercase tracking-wider text-content">
                          Símbolos Decodificados ({result.barcodes.count})
                        </h3>
                        <span className="text-[10px] font-mono text-muted">
                          Pase de barras: {result.timingMs.barcodes.toFixed(1)} ms
                        </span>
                      </div>

                      {result.barcodes.reads.length === 0 ? (
                        <p className="text-xs text-muted italic py-2">
                          No se detectaron códigos de barras válidos en la imagen.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {result.barcodes.reads.map((barcode, idx) => (
                            <div
                              key={idx}
                              className="p-3 bg-surface border border-subtle rounded-xl flex items-center justify-between gap-3 text-xs"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span className="px-2 py-0.5 rounded-md bg-accent/10 border border-accent/20 text-accent font-black text-[10px] font-mono shrink-0">
                                  {barcode.format}
                                </span>
                                <span className="font-mono text-content font-bold truncate">
                                  {barcode.text}
                                </span>
                              </div>
                              <span className="text-[10px] text-muted font-mono shrink-0">
                                {barcode.hits} {barcode.hits === 1 ? 'pase' : 'pases'}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Raw JSON Toggle & Viewer */}
                    <div className="bg-card border border-subtle rounded-2xl overflow-hidden">
                      <button
                        onClick={() => setShowRawJson(!showRawJson)}
                        className="w-full p-4 flex items-center justify-between text-left hover:bg-surface/50 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <Code2 size={16} className="text-muted" />
                          <span className="text-xs font-bold uppercase tracking-wider text-content">
                            Ver JSON Crudo
                          </span>
                        </div>
                        <span className="text-[10px] font-bold text-accent uppercase tracking-wider">
                          {showRawJson ? 'Ocultar' : 'Mostrar'}
                        </span>
                      </button>

                      {showRawJson && (
                        <div className="p-4 border-t border-subtle bg-black/40">
                          <pre className="text-[11px] font-mono text-emerald-400 overflow-x-auto p-3 rounded-xl bg-black/60 max-h-80">
                            {JSON.stringify(result, null, 2)}
                          </pre>
                        </div>
                      )}
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
