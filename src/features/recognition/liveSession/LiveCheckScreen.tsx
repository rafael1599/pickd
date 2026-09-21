import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../context/AuthContext';
import {
  type LiveSessionState,
  createInitialLiveSessionState,
  initSessionFromOrders,
  setCandidateProposal,
  clearActiveProposal,
  confirmActiveBox,
  undoLastConfirmation,
} from './liveSessionState';
import { batchConfirmPartsCarton } from './partsBatchHandler';
import { completeVerifiedOrderGroup } from './orderCompleter';
import { TemporalConsensusFilter, type RawBarcodeDetection } from './liveBarcodeScanner';
import { calculateOpticalParameters, GALAXY_S25_ULTRA_PROFILE } from './opticalGeometry';

// Lucide icons
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import AlertOctagon from 'lucide-react/dist/esm/icons/alert-octagon';
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw';
import Camera from 'lucide-react/dist/esm/icons/camera';
import CameraOff from 'lucide-react/dist/esm/icons/camera-off';
import Package from 'lucide-react/dist/esm/icons/package';
import Bike from 'lucide-react/dist/esm/icons/bike';
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check';
import Search from 'lucide-react/dist/esm/icons/search';

export const LiveCheckScreen: React.FC = () => {
  const { orderNumber: paramOrderNumber } = useParams<{ orderNumber?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [inputOrderNumber, setInputOrderNumber] = useState(paramOrderNumber || '');
  const [sessionState, setSessionState] = useState<LiveSessionState>(
    createInitialLiveSessionState()
  );
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [completionMessage, setCompletionMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'camera' | 'checklist' | 'history'>('camera');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const consensusFilterRef = useRef<TemporalConsensusFilter>(
    new TemporalConsensusFilter({ requiredFrames: 2, windowMs: 600 })
  );
  const scanLoopRef = useRef<number | null>(null);

  // Optical metrics for Galaxy S25 Ultra at 250mm
  const opticalMetrics = calculateOpticalParameters(250, 1920, 1080, GALAXY_S25_ULTRA_PROFILE);

  // 1. Carga de órdenes (Orden o Grupo de Órdenes)
  const loadOrderData = useCallback(async (targetOrderNumber: string) => {
    if (!targetOrderNumber.trim()) return;

    setLoadingOrders(true);
    setCompletionMessage(null);

    try {
      // Buscar la orden principal por order_number
      const { data: primaryOrder, error: primaryErr } = await supabase
        .from('picking_lists')
        .select(
          `
          id,
          order_number,
          status,
          is_shipped,
          group_id,
          items,
          customer:customers(name)
        `
        )
        .eq('order_number', targetOrderNumber.trim())
        .single();

      if (primaryErr || !primaryOrder) {
        throw new Error(`Orden #${targetOrderNumber} no encontrada`);
      }

      let allOrders = [primaryOrder];

      // Si pertenece a un order_group, traer todas las órdenes hermanas del grupo
      if (primaryOrder.group_id) {
        const { data: siblingOrders, error: groupErr } = await supabase
          .from('picking_lists')
          .select(
            `
            id,
            order_number,
            status,
            is_shipped,
            group_id,
            items,
            customer:customers(name)
          `
          )
          .eq('group_id', primaryOrder.group_id);

        if (!groupErr && siblingOrders && siblingOrders.length > 0) {
          allOrders = siblingOrders;
        }
      }

      const initializedState = initSessionFromOrders(allOrders as any, primaryOrder.group_id);
      setSessionState(initializedState);
    } catch (err: any) {
      setCameraError(err?.message || 'Error cargando orden');
    } finally {
      setLoadingOrders(false);
    }
  }, []);

  useEffect(() => {
    if (paramOrderNumber) {
      loadOrderData(paramOrderNumber);
    }
  }, [paramOrderNumber, loadOrderData]);

  // 2. Control de Cámara
  const startCamera = useCallback(async () => {
    try {
      setCameraError(null);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }

      // Constraints calibrados para Samsung Galaxy S25 Ultra (1080p stream)
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setIsCameraActive(true);
      }
    } catch (err: any) {
      setCameraError(`No se pudo acceder a la cámara: ${err?.message || err}`);
      setIsCameraActive(false);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (scanLoopRef.current) {
      cancelAnimationFrame(scanLoopRef.current);
      scanLoopRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  }, []);

  // 3. Ciclo de Escaneo y Consenso Multi-Frame
  useEffect(() => {
    if (!isCameraActive || !videoRef.current) return;

    let isScanning = true;
    let detector: any = null;

    if ('BarcodeDetector' in window) {
      try {
        detector = new (window as any).BarcodeDetector({
          formats: ['code_39', 'code_128', 'qr_code', 'upc_a', 'ean_13'],
        });
      } catch {
        detector = null;
      }
    }

    let lastScanTime = 0;
    const scanIntervalMs = 70; // ~14 fps de escaneo para cuidar batería y térmicos

    const processFrame = async (timestamp: number) => {
      if (!isScanning) return;

      if (
        videoRef.current &&
        videoRef.current.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        timestamp - lastScanTime >= scanIntervalMs
      ) {
        lastScanTime = timestamp;

        if (detector) {
          try {
            const barcodes = await detector.detect(videoRef.current);
            if (barcodes && barcodes.length > 0) {
              for (const b of barcodes) {
                const raw: RawBarcodeDetection = {
                  rawValue: b.rawValue,
                  format: b.format,
                  timestamp: Date.now(),
                };
                const candidate = consensusFilterRef.current.pushFrame(raw);
                if (candidate) {
                  setSessionState((prev) => setCandidateProposal(prev, candidate));
                  break; // Una propuesta activa a la vez
                }
              }
            }
          } catch {
            // Ignorar errores transitorios de cuadro
          }
        }
      }

      if (isScanning) {
        scanLoopRef.current = requestAnimationFrame(processFrame);
      }
    };

    scanLoopRef.current = requestAnimationFrame(processFrame);

    return () => {
      isScanning = false;
      if (scanLoopRef.current) {
        cancelAnimationFrame(scanLoopRef.current);
        scanLoopRef.current = null;
      }
    };
  }, [isCameraActive]);

  // Al desmontar, apagar cámara
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  // 4. Acciones de Operador
  const handleConfirmBox = () => {
    // Respuesta háptica física en Galaxy S25 Ultra
    try {
      if (navigator.vibrate) navigator.vibrate(40);
    } catch {
      // Ignore vibration error
    }

    setSessionState((prev) => {
      const { state } = confirmActiveBox(prev);
      return state;
    });
    consensusFilterRef.current.reset();
  };

  const handleDismissProposal = () => {
    setSessionState((prev) => clearActiveProposal(prev));
    consensusFilterRef.current.reset();
  };

  const handleUndo = () => {
    try {
      if (navigator.vibrate) navigator.vibrate(25);
    } catch {
      // Ignore vibration error
    }
    setSessionState((prev) => undoLastConfirmation(prev));
  };

  const handleBatchConfirmParts = (sku: string) => {
    try {
      if (navigator.vibrate) navigator.vibrate([40, 30, 40]);
    } catch {
      // Ignore vibration error
    }
    setSessionState((prev) => batchConfirmPartsCarton(prev, sku).state);
    consensusFilterRef.current.reset();
  };

  // 5. Finalizar Orden / Grupo
  const handleCompleteOrders = async (dryRun: boolean = false) => {
    if (!user) {
      alert('Debes estar autenticado para finalizar la orden');
      return;
    }

    setIsCompleting(true);
    try {
      const result = await completeVerifiedOrderGroup(supabase, user.id, sessionState, { dryRun });
      if (result.allSucceeded) {
        setCompletionMessage(
          dryRun
            ? '✓ Simulación exitosa: Todas las órdenes verificadas (Modo Dry-Run).'
            : '✓ ¡Orden(es) completadas exitosamente en el sistema!'
        );
        setSessionState((prev) => ({ ...prev, status: 'completed' }));
      } else {
        alert('Hubo un error completando algunas órdenes. Revisa la consola.');
      }
    } catch (err: any) {
      alert(`Error al completar orden: ${err?.message || err}`);
    } finally {
      setIsCompleting(false);
    }
  };

  const proposal = sessionState.activeProposal;

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 font-sans select-none overflow-hidden">
      {/* HEADER SUPERIOR */}
      <header className="flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/ship')}
            className="p-2 -ml-2 rounded-lg text-slate-400 hover:text-slate-200 active:bg-slate-800"
            aria-label="Volver"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                Track A • Verificación en Vivo
              </span>
              {sessionState.groupId && (
                <span className="text-xs font-mono text-cyan-400 bg-cyan-950/60 px-1.5 py-0.5 rounded border border-cyan-800/40">
                  Grupo ({sessionState.orders.length} órdenes)
                </span>
              )}
            </div>
            <h1 className="text-base font-bold text-white tracking-tight">
              {sessionState.orders.length > 0
                ? sessionState.orders.map((o) => `#${o.orderNumber}`).join(' • ')
                : 'Seleccionar Orden'}
            </h1>
          </div>
        </div>

        {/* CONTROLES DE CÁMARA */}
        <div className="flex items-center gap-2">
          {sessionState.orders.length > 0 && (
            <button
              onClick={isCameraActive ? stopCamera : startCamera}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium text-xs transition-colors ${
                isCameraActive
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30'
                  : 'bg-emerald-600 text-white hover:bg-emerald-500 active:bg-emerald-700'
              }`}
            >
              {isCameraActive ? (
                <>
                  <CameraOff className="w-4 h-4" /> Detener
                </>
              ) : (
                <>
                  <Camera className="w-4 h-4" /> Iniciar Cámara
                </>
              )}
            </button>
          )}
        </div>
      </header>

      {/* SELECTOR DE ÓRDEN SI NO HAY CARGADA */}
      {sessionState.orders.length === 0 && (
        <div className="flex-1 p-4 overflow-y-auto max-w-lg mx-auto w-full flex flex-col justify-center">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <h2 className="text-lg font-bold text-slate-200">Abrir Sesión de Verificación</h2>
            <p className="text-xs text-slate-400">
              Ingresa el número de orden de piso para verificar caja por caja contra el order_group.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                loadOrderData(inputOrderNumber);
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                value={inputOrderNumber}
                onChange={(e) => setInputOrderNumber(e.target.value)}
                placeholder="Ej. 881650"
                className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white font-mono focus:outline-none focus:border-emerald-500"
              />
              <button
                type="submit"
                disabled={loadingOrders}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-4 py-3 rounded-xl text-sm flex items-center gap-1.5 disabled:opacity-50"
              >
                <Search className="w-4 h-4" /> {loadingOrders ? 'Cargando...' : 'Abrir'}
              </button>
            </form>

            {/* CANDIDATOS DE PISO RECOMENDADOS (L-0) */}
            <div className="pt-2 border-t border-slate-800/80">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">
                Órdenes de prueba en piso (Sub-fase L-0):
              </span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    setInputOrderNumber('881650');
                    loadOrderData('881650');
                  }}
                  className="p-2.5 rounded-xl bg-slate-800/70 border border-slate-700/60 hover:border-emerald-500 text-left transition-all"
                >
                  <span className="text-xs font-mono font-bold text-emerald-400">#881650</span>
                  <span className="text-[11px] block text-slate-400">
                    Simple: 5 bicis, 1 pallet
                  </span>
                </button>

                <button
                  onClick={() => {
                    setInputOrderNumber('881649');
                    loadOrderData('881649');
                  }}
                  className="p-2.5 rounded-xl bg-slate-800/70 border border-slate-700/60 hover:border-emerald-500 text-left transition-all"
                >
                  <span className="text-xs font-mono font-bold text-emerald-400">#881649</span>
                  <span className="text-[11px] block text-slate-400">
                    Simple: 4 bicis, 1 pallet
                  </span>
                </button>

                <button
                  onClick={() => {
                    setInputOrderNumber('881555');
                    loadOrderData('881555');
                  }}
                  className="p-2.5 rounded-xl bg-slate-800/70 border border-slate-700/60 hover:border-cyan-500 text-left transition-all"
                >
                  <span className="text-xs font-mono font-bold text-cyan-400">
                    #881555 + #881635
                  </span>
                  <span className="text-[11px] block text-slate-400">
                    Combinada: 2 + 4 = 6 bicis
                  </span>
                </button>

                <button
                  onClick={() => {
                    setInputOrderNumber('881656');
                    loadOrderData('881656');
                  }}
                  className="p-2.5 rounded-xl bg-slate-800/70 border border-slate-700/60 hover:border-amber-500 text-left transition-all"
                >
                  <span className="text-xs font-mono font-bold text-amber-400">
                    #881656 + #881657
                  </span>
                  <span className="text-[11px] block text-slate-400">
                    Bicis + Partes (Población C)
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CUERPO PRINCIPAL CON CÁMARA O CHECKLIST */}
      {sessionState.orders.length > 0 && (
        <div className="flex-1 flex flex-col relative overflow-hidden">
          {/* BARRA DE PROGRESO DEL GRUPO */}
          <div className="bg-slate-900/90 backdrop-blur border-b border-slate-800 px-4 py-2 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-4 text-xs font-medium">
              <span className="flex items-center gap-1.5 text-slate-300">
                <Bike className="w-4 h-4 text-emerald-400" />
                Bicis:{' '}
                <b className="text-white font-mono">
                  {sessionState.stats.totalBikesConfirmed} / {sessionState.stats.totalBikesRequired}
                </b>
              </span>
              {sessionState.stats.totalPartsRequired > 0 && (
                <span className="flex items-center gap-1.5 text-slate-300">
                  <Package className="w-4 h-4 text-amber-400" />
                  Partes:{' '}
                  <b className="text-white font-mono">
                    {sessionState.stats.totalPartsConfirmed} /{' '}
                    {sessionState.stats.totalPartsRequired}
                  </b>
                </span>
              )}
              {sessionState.stats.alienCount > 0 && (
                <span className="flex items-center gap-1 text-rose-400 font-bold bg-rose-950/50 px-2 py-0.5 rounded border border-rose-800">
                  ⚠️ {sessionState.stats.alienCount} ajena(s)
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold text-emerald-400">
                {sessionState.stats.progressPercent}%
              </span>
              <div className="w-20 bg-slate-800 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                  style={{ width: `${sessionState.stats.progressPercent}%` }}
                />
              </div>
            </div>
          </div>

          {/* MENSAJE DE COMPLETADO */}
          {completionMessage && (
            <div className="bg-emerald-500/20 border-b border-emerald-500/30 p-3 text-xs text-emerald-300 text-center font-medium">
              {completionMessage}
            </div>
          )}

          {/* MENSAJE DE ERROR DE CÁMARA */}
          {cameraError && (
            <div className="bg-rose-950/60 border border-rose-800 text-rose-300 px-3 py-2 text-xs rounded-xl flex items-center gap-2 m-3 shrink-0">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{cameraError}</span>
            </div>
          )}

          {/* VISOR DE CÁMARA */}
          {activeTab === 'camera' && (
            <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${!isCameraActive ? 'hidden' : ''}`}
              />

              {!isCameraActive && (
                <div className="text-center p-6 space-y-3">
                  <Camera className="w-12 h-12 text-slate-600 mx-auto" />
                  <p className="text-sm text-slate-400 max-w-xs">
                    Cámara en pausa. Pulsa el botón superior para iniciar el escaneo en vivo.
                  </p>
                  <button
                    onClick={startCamera}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2.5 rounded-xl font-bold text-sm shadow-lg shadow-emerald-900/30"
                  >
                    Iniciar Cámara (S25 Ultra)
                  </button>
                </div>
              )}

              {/* RETÍCULA ÓPTICA DE ESCANEO (200-350 mm Safe Zone) */}
              {isCameraActive && (
                <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
                  <div className="w-72 h-44 border-2 border-dashed border-emerald-400/70 rounded-2xl bg-emerald-500/5 relative shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]">
                    {/* Guías esquineras */}
                    <div className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-emerald-400" />
                    <div className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-emerald-400" />
                    <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-emerald-400" />
                    <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-emerald-400" />
                    <span className="absolute -bottom-6 inset-x-0 text-center text-[10px] font-mono text-emerald-300 drop-shadow">
                      Distancia: 20–35 cm | {opticalMetrics.pixelDensityPxPerMm} px/mm (Nyquist ≥1.8
                      px/mod)
                    </span>
                  </div>
                </div>
              )}

              {/* BANNER / TARJETA DE PROPUESTA ACTIVA (BOTTOM OVERLAY) */}
              {proposal && (
                <div className="absolute bottom-4 inset-x-4 max-w-md mx-auto z-20">
                  {/* POBLACIÓN A: BICI VÁLIDA */}
                  {proposal.population === 'A' && (
                    <div className="bg-slate-900/95 backdrop-blur border-2 border-emerald-500 rounded-2xl p-4 shadow-2xl space-y-3">
                      {proposal.isDuplicateSerial && (
                        <div className="bg-amber-500/20 border border-amber-500/40 rounded-lg p-2 text-xs text-amber-300 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 shrink-0" />
                          <span>
                            Esta caja parece ya contada (#{proposal.candidate.serial}). Toca para
                            confirmar si es requerida.
                          </span>
                        </div>
                      )}

                      <div className="flex items-start justify-between">
                        <div>
                          <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1">
                            <Bike className="w-3.5 h-3.5" /> Bici en Orden #
                            {proposal.targetOrderNumber}
                          </span>
                          <h3 className="text-xl font-mono font-black text-white">
                            {proposal.candidate.sku}
                          </h3>
                          <p className="text-xs text-slate-300 line-clamp-1">
                            {proposal.matchedItem?.name || 'Bicicleta Jamis'}
                          </p>
                          {proposal.candidate.serial && (
                            <span className="text-[11px] font-mono text-slate-400 block mt-0.5">
                              Serial: {proposal.candidate.serial}
                            </span>
                          )}
                        </div>
                        <span className="text-xs font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-800 px-2 py-1 rounded">
                          {proposal.matchedItem?.verifiedQuantity} /{' '}
                          {proposal.matchedItem?.quantity}
                        </span>
                      </div>

                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={handleDismissProposal}
                          className="px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                        >
                          Descartar
                        </button>
                        <button
                          onClick={handleConfirmBox}
                          className="flex-1 py-3.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-sm font-black flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/50"
                        >
                          <CheckCircle2 className="w-5 h-5" /> CONFIRMAR CAJA (1 TOQUE)
                        </button>
                      </div>
                    </div>
                  )}

                  {/* POBLACIÓN B: ALIEN BOX */}
                  {proposal.population === 'B' && (
                    <div className="bg-slate-900/95 backdrop-blur border-2 border-rose-500 rounded-2xl p-4 shadow-2xl space-y-3">
                      <div className="flex items-start gap-2 text-rose-400">
                        <AlertOctagon className="w-6 h-6 shrink-0 mt-0.5" />
                        <div>
                          <h3 className="text-base font-bold text-white">⚠️ ALERTA: CAJA AJENA</h3>
                          <p className="text-xs text-slate-300 mt-0.5">
                            El SKU{' '}
                            <b className="font-mono text-rose-300">{proposal.candidate.sku}</b> NO
                            pertenece a ninguna orden del grupo.
                          </p>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={handleDismissProposal}
                          className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
                        >
                          Ignorar
                        </button>
                        <button
                          onClick={handleConfirmBox}
                          className="flex-1 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold"
                        >
                          Registrar como Ajena
                        </button>
                      </div>
                    </div>
                  )}

                  {/* POBLACIÓN C: CAJA DE PARTES / REPUESTOS */}
                  {proposal.population === 'C' && (
                    <div className="bg-slate-900/95 backdrop-blur border-2 border-cyan-500 rounded-2xl p-4 shadow-2xl space-y-3">
                      <div>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1">
                          <Package className="w-3.5 h-3.5" /> Caja de Partes • #
                          {proposal.targetOrderNumber}
                        </span>
                        <h3 className="text-lg font-mono font-bold text-white">
                          {proposal.candidate.sku}
                        </h3>
                        <p className="text-xs text-slate-300 line-clamp-1">
                          {proposal.matchedItem?.name}
                        </p>
                        <span className="text-xs text-cyan-300 block mt-1">
                          Pendiente por verificar:{' '}
                          {proposal.matchedItem
                            ? proposal.matchedItem.quantity - proposal.matchedItem.verifiedQuantity
                            : 0}{' '}
                          uds.
                        </span>
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={handleDismissProposal}
                          className="px-3 py-2.5 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold"
                        >
                          Ignorar
                        </button>
                        <button
                          onClick={() => handleBatchConfirmParts(proposal.candidate.sku)}
                          className="flex-1 py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold flex items-center justify-center gap-1.5"
                        >
                          <CheckCircle2 className="w-4 h-4" /> Confirmar Lote Completo
                        </button>
                      </div>
                    </div>
                  )}

                  {/* COMPLETED IN GROUP */}
                  {proposal.population === 'COMPLETED_IN_GROUP' && (
                    <div className="bg-slate-900/95 backdrop-blur border-2 border-amber-500 rounded-2xl p-4 shadow-2xl space-y-3">
                      <div>
                        <span className="text-[11px] font-bold text-amber-400">
                          ℹ️ SKU COMPLETO EN EL GRUPO
                        </span>
                        <h3 className="text-lg font-mono font-bold text-white">
                          {proposal.candidate.sku}
                        </h3>
                        <p className="text-xs text-slate-300">
                          Todas las unidades requeridas de este modelo ya fueron verificadas.
                        </p>
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={handleDismissProposal}
                          className="flex-1 py-2.5 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold"
                        >
                          Descartar
                        </button>
                        <button
                          onClick={handleConfirmBox}
                          className="flex-1 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold"
                        >
                          Añadir como Extra
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* CHECKLIST DE ÓRDENES DEL GRUPO */}
          {activeTab === 'checklist' && (
            <div className="flex-1 p-4 overflow-y-auto space-y-4">
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400">
                Detalle por Orden del Grupo
              </h2>

              {sessionState.orders.map((order) => {
                const orderItems = sessionState.items.filter((i) => i.orderId === order.id);
                const orderBikes = orderItems.filter((i) => i.isBike);
                const orderParts = orderItems.filter((i) => !i.isBike);

                return (
                  <div
                    key={order.id}
                    className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                      <div>
                        <h3 className="text-base font-bold font-mono text-white">
                          #{order.orderNumber}
                        </h3>
                        {order.customerName && (
                          <p className="text-xs text-slate-400">{order.customerName}</p>
                        )}
                      </div>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                        {order.status}
                      </span>
                    </div>

                    {/* LISTA DE ÍTEMS */}
                    <div className="space-y-2">
                      {orderBikes.map((item) => {
                        const isDone = item.verifiedQuantity >= item.quantity;
                        return (
                          <div
                            key={item.id}
                            className={`flex items-center justify-between p-2.5 rounded-lg border text-xs ${
                              isDone
                                ? 'bg-emerald-950/20 border-emerald-900/40 text-emerald-200'
                                : 'bg-slate-800/50 border-slate-700/50 text-slate-200'
                            }`}
                          >
                            <div>
                              <span className="font-mono font-bold text-white block">
                                {item.sku}
                              </span>
                              <span className="text-[11px] text-slate-400 line-clamp-1">
                                {item.name}
                              </span>
                            </div>
                            <span className="font-mono font-bold text-sm px-2 py-0.5 rounded bg-slate-900/80">
                              {item.verifiedQuantity} / {item.quantity}
                            </span>
                          </div>
                        );
                      })}

                      {orderParts.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between p-2.5 rounded-lg border border-cyan-900/40 bg-cyan-950/20 text-xs text-cyan-200"
                        >
                          <div>
                            <span className="font-mono font-bold block">{item.sku} (Partes)</span>
                            <span className="text-[11px] text-cyan-400 line-clamp-1">
                              {item.name}
                            </span>
                          </div>
                          <button
                            onClick={() => handleBatchConfirmParts(item.sku)}
                            className="bg-cyan-700 hover:bg-cyan-600 text-white px-2 py-1 rounded text-[11px] font-bold font-mono"
                          >
                            {item.verifiedQuantity} / {item.quantity} [Confirmar]
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* HISTORIAL DE CAJAS CONFIRMADAS */}
          {activeTab === 'history' && (
            <div className="flex-1 p-4 overflow-y-auto space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400">
                  Cajas Verificadas ({sessionState.confirmedBoxes.length})
                </h2>
                {sessionState.confirmedBoxes.length > 0 && (
                  <button
                    onClick={handleUndo}
                    className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 font-semibold"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Deshacer última
                  </button>
                )}
              </div>

              {sessionState.confirmedBoxes.length === 0 ? (
                <p className="text-xs text-slate-500 py-8 text-center">
                  No hay cajas confirmadas aún.
                </p>
              ) : (
                <div className="space-y-2">
                  {[...sessionState.confirmedBoxes].reverse().map((box, idx) => (
                    <div
                      key={box.id}
                      className="p-3 bg-slate-900 border border-slate-800 rounded-xl flex items-center justify-between text-xs"
                    >
                      <div>
                        <span className="font-mono font-bold text-white block">{box.sku}</span>
                        <span className="text-[11px] text-slate-400">
                          Orden #{box.targetOrderNumber} •{' '}
                          {box.serial ? `Serial: ${box.serial}` : 'Sin serial'}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-slate-500">
                        #{sessionState.confirmedBoxes.length - idx}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* BARRA INFERIOR DE PESTAÑAS Y FINALIZACIÓN */}
          <footer className="bg-slate-900 border-t border-slate-800 p-2 shrink-0 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setActiveTab('camera')}
                className={`px-3 py-2 rounded-lg text-xs font-semibold ${
                  activeTab === 'camera'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Cámara
              </button>
              <button
                onClick={() => setActiveTab('checklist')}
                className={`px-3 py-2 rounded-lg text-xs font-semibold ${
                  activeTab === 'checklist'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Checklist ({sessionState.stats.totalBikesConfirmed}/
                {sessionState.stats.totalBikesRequired})
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`px-3 py-2 rounded-lg text-xs font-semibold ${
                  activeTab === 'history'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Historial ({sessionState.confirmedBoxes.length})
              </button>
            </div>

            {/* BOTÓN FINALIZAR */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleCompleteOrders(true)}
                disabled={isCompleting || sessionState.confirmedBoxes.length === 0}
                className="px-3 py-2 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold disabled:opacity-40"
              >
                Dry-Run
              </button>

              <button
                onClick={() => handleCompleteOrders(false)}
                disabled={isCompleting || sessionState.confirmedBoxes.length === 0}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-bold disabled:opacity-40 flex items-center gap-1.5 shadow-md"
              >
                <ShieldCheck className="w-4 h-4" />
                {isCompleting ? 'Finalizando...' : 'Finalizar Verificación'}
              </button>
            </div>
          </footer>
        </div>
      )}
    </div>
  );
};
