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
import {
  TemporalConsensusFilter,
  type RawBarcodeDetection,
  type ProposedBoxCandidate,
  extractCandidateFromBarcode,
} from './liveBarcodeScanner';
import { SessionUpcCatalog, persistSkuUpcMapping } from './upcCatalogResolver';
import { normalizeSkuForCompare } from './groupReconciler';
import { warmupOcrService, runClientOcr } from '../../../lib/recognition/clientOcr';
import { parseJamisFactoryQr } from '../../../lib/recognition/barcodeText';
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
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import Copy from 'lucide-react/dist/esm/icons/copy';
import Check from 'lucide-react/dist/esm/icons/check';
import ScanText from 'lucide-react/dist/esm/icons/scan-text';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles';
import { isBikeSku } from '../../../utils/bikeDetection';

export interface BoxTelemetryRecord {
  boxIndex: number;
  sku: string;
  serial: string | null;
  qrRaw: string | null;
  format: string | null;
  framesProcessed: number;
  framesWithSerial: number;
  framesWithQr: number;
  framesToFirstRead: number;
  hadCollision: boolean;
  confirmedAt: number;
}

export interface LiveSessionDiagnostics {
  totalFramesProcessed: number;
  framesWithQr: number;
  framesWithSerial: number;
  framesToFirstQr: number | null;
  framesToFirstSerial: number | null;
  framesToFirstSku: number | null;
  identifierCollisions: number;
  boxRecords: BoxTelemetryRecord[];
  sessionStartedAt: number | null;
}

export interface ActiveFloorOrderSummary {
  id: string;
  orderNumber: string;
  groupId: string | null;
  status: string;
  customerName: string | null;
  totalBikes: number;
  totalUnits: number;
  siblingNumbers: string[];
}

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
  const [activeFloorOrders, setActiveFloorOrders] = useState<ActiveFloorOrderSummary[]>([]);
  const [loadingFloorOrders, setLoadingFloorOrders] = useState(false);
  const [copiedResult, setCopiedResult] = useState(false);
  const [isOcrProcessing, setIsOcrProcessing] = useState(false);
  const [ocrStatusMessage, setOcrStatusMessage] = useState<string | null>(null);
  const reticleRef = useRef<HTMLDivElement | null>(null);
  const lastOcrAutoTriggerRef = useRef<{ code: string; timestamp: number } | null>(null);
  const isOcrProcessingRef = useRef(false);
  isOcrProcessingRef.current = isOcrProcessing;

  // Precarga y warmup de PP-OCRv6 en background para eliminar latencia de arranque
  useEffect(() => {
    warmupOcrService().catch((err) => {
      console.warn('[LiveCheckScreen] OCR warmup non-fatal error:', err);
    });
  }, []);

  const diagnosticsRef = useRef<LiveSessionDiagnostics>({
    totalFramesProcessed: 0,
    framesWithQr: 0,
    framesWithSerial: 0,
    framesToFirstQr: null,
    framesToFirstSerial: null,
    framesToFirstSku: null,
    identifierCollisions: 0,
    boxRecords: [],
    sessionStartedAt: null,
  });

  const currentBoxMetricsRef = useRef({
    framesProcessed: 0,
    framesWithSerial: 0,
    framesWithQr: 0,
    hadCollision: false,
  });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionUpcCatalogRef = useRef<SessionUpcCatalog>(new SessionUpcCatalog());
  const consensusFilterRef = useRef<TemporalConsensusFilter>(
    new TemporalConsensusFilter({ requiredFrames: 2, windowMs: 600 }, sessionUpcCatalogRef.current)
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

      // Precargar catálogo de UPCs para los SKUs de las órdenes de la sesión
      const orderSkus: string[] = [];
      for (const ord of allOrders) {
        if (Array.isArray(ord.items)) {
          for (const it of ord.items) {
            if (
              it &&
              typeof it === 'object' &&
              'sku' in it &&
              typeof (it as any).sku === 'string'
            ) {
              orderSkus.push((it as any).sku);
            }
          }
        }
      }
      await sessionUpcCatalogRef.current.preloadFromDatabase(supabase, orderSkus);
    } catch (err: any) {
      setCameraError(err?.message || 'Error cargando orden');
    } finally {
      setLoadingOrders(false);
    }
  }, []);

  const fetchActiveFloorOrders = useCallback(async () => {
    setLoadingFloorOrders(true);
    try {
      const { data, error } = await supabase
        .from('picking_lists')
        .select(
          `
          id,
          order_number,
          status,
          group_id,
          items,
          customer:customers(name)
        `
        )
        .in('status', ['ready_to_double_check', 'double_checking', 'active', 'needs_correction'])
        .order('created_at', { ascending: false })
        .limit(40);

      if (error || !data) return;

      const groupMap = new Map<string, typeof data>();
      const standalone: typeof data = [];

      for (const row of data) {
        if (row.group_id) {
          const existing = groupMap.get(row.group_id) || [];
          existing.push(row);
          groupMap.set(row.group_id, existing);
        } else {
          standalone.push(row);
        }
      }

      const summaries: ActiveFloorOrderSummary[] = [];

      for (const [groupId, rows] of groupMap.entries()) {
        let totalBikes = 0;
        let totalUnits = 0;
        const orderNumbers: string[] = [];
        for (const r of rows) {
          if (r.order_number) {
            orderNumbers.push(r.order_number);
          }
          const items = Array.isArray(r.items) ? (r.items as any[]) : [];
          for (const item of items) {
            const qty = Number(item.quantity ?? item.qty ?? 1);
            totalUnits += qty;
            if (isBikeSku(item.sku, item.sku_metadata)) {
              totalBikes += qty;
            }
          }
        }
        const primary = rows[0];
        summaries.push({
          id: primary.id,
          orderNumber: primary.order_number || '',
          groupId,
          status: rows.some((r) => r.status === 'double_checking')
            ? 'double_checking'
            : rows.some((r) => r.status === 'ready_to_double_check')
              ? 'ready_to_double_check'
              : primary.status || '',
          customerName: (primary.customer as any)?.name ?? null,
          totalBikes,
          totalUnits,
          siblingNumbers: orderNumbers,
        });
      }

      for (const row of standalone) {
        let totalBikes = 0;
        let totalUnits = 0;
        const items = Array.isArray(row.items) ? (row.items as any[]) : [];
        for (const item of items) {
          const qty = Number(item.quantity ?? item.qty ?? 1);
          totalUnits += qty;
          if (isBikeSku(item.sku, item.sku_metadata)) {
            totalBikes += qty;
          }
        }
        summaries.push({
          id: row.id,
          orderNumber: row.order_number || '',
          groupId: null,
          status: row.status || '',
          customerName: (row.customer as any)?.name ?? null,
          totalBikes,
          totalUnits,
          siblingNumbers: row.order_number ? [row.order_number] : [],
        });
      }

      setActiveFloorOrders(summaries);
    } catch (err) {
      console.error('Error cargando órdenes activas de piso:', err);
    } finally {
      setLoadingFloorOrders(false);
    }
  }, []);

  useEffect(() => {
    if (paramOrderNumber) {
      loadOrderData(paramOrderNumber);
    } else if (sessionState.orders.length === 0) {
      fetchActiveFloorOrders();
    }
  }, [paramOrderNumber, sessionState.orders.length, loadOrderData, fetchActiveFloorOrders]);

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
        if (diagnosticsRef.current.sessionStartedAt === null) {
          diagnosticsRef.current.sessionStartedAt = Date.now();
        }
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
    setIsCameraActive(false);
  }, []);

  // Función de lectura OCR por demanda o auto-disparo sobre la zona de la retícula
  const runOcrOnReticle = useCallback(
    async (linkedUpc?: string | null) => {
      if (!videoRef.current || isOcrProcessingRef.current) return;
      const video = videoRef.current;
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

      setIsOcrProcessing(true);
      setOcrStatusMessage('Analizando texto de etiqueta en retícula con OCR...');

      try {
        let cropX = 0;
        let cropY = 0;
        let cropW = video.videoWidth;
        let cropH = video.videoHeight;

        if (reticleRef.current) {
          const videoRect = video.getBoundingClientRect();
          const reticleRect = reticleRef.current.getBoundingClientRect();

          const scale = Math.max(
            videoRect.width / video.videoWidth,
            videoRect.height / video.videoHeight
          );
          const renderW = video.videoWidth * scale;
          const renderH = video.videoHeight * scale;
          const offsetX = (renderW - videoRect.width) / 2;
          const offsetY = (renderH - videoRect.height) / 2;

          const rx = reticleRect.left - videoRect.left;
          const ry = reticleRect.top - videoRect.top;

          // Padding 25% para abarcar el SKU aún con encuadre imperfecto
          const padX = (reticleRect.width / scale) * 0.25;
          const padY = (reticleRect.height / scale) * 0.25;

          cropX = Math.max(0, (rx + offsetX) / scale - padX);
          cropY = Math.max(0, (ry + offsetY) / scale - padY);
          cropW = Math.min(video.videoWidth - cropX, reticleRect.width / scale + padX * 2);
          cropH = Math.min(video.videoHeight - cropY, reticleRect.height / scale + padY * 2);
        }

        const canvas = document.createElement('canvas');
        canvas.width = Math.round(cropW);
        canvas.height = Math.round(cropH);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('No se pudo inicializar canvas 2D');

        ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);

        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/jpeg', 0.92)
        );
        if (!blob) throw new Error('Error generando recorte de cámara');

        const ocrResult = await runClientOcr(blob);
        const extracted = ocrResult.extracted;

        const expectedSkus = sessionState.items.map((i) => i.sku);
        const allOcrCandidates = extracted.skuCandidates?.map((c) => c.sku) || [];
        if (extracted.sku && !allOcrCandidates.includes(extracted.sku)) {
          allOcrCandidates.unshift(extracted.sku);
        }

        let matchedSku: string | null = null;

        for (const cand of allOcrCandidates) {
          const normCand = normalizeSkuForCompare(cand);
          const foundExpected = expectedSkus.find((s) => normalizeSkuForCompare(s) === normCand);
          if (foundExpected) {
            matchedSku = foundExpected;
            break;
          }
        }

        // Una lectura de OCR que no coincide con nada que la orden espera NO se
        // asciende a SKU. Tomar el primer candidato porque es el único que hay
        // es inventar: el OCR confunde 8 con B y 0 con D, y el resultado sería
        // una caja confirmada con un SKU que nadie verificó. Se muestra lo
        // leído y el operador decide.
        const isExpected = matchedSku !== null;
        const readSku = matchedSku ?? allOcrCandidates[0] ?? null;

        if (readSku) {
          try {
            if (navigator.vibrate) navigator.vibrate(isExpected ? [30, 40, 30] : [20]);
          } catch {
            // ignore
          }

          const targetUpc = linkedUpc || sessionState.activeProposal?.candidate.upc || null;

          if (isExpected) {
            setOcrStatusMessage(`✓ SKU detectado: ${readSku}`);

            // Dos canales independientes concuerdan —las barras traen el UPC y
            // el texto impreso trae un SKU que la orden espera—, así que el
            // par se aprende para que la próxima caja se lea en 15 ms.
            if (targetUpc) {
              sessionUpcCatalogRef.current.register(targetUpc, readSku);
              void persistSkuUpcMapping(supabase, readSku, targetUpc).then((outcome) => {
                if (outcome === 'conflict') {
                  setOcrStatusMessage(
                    `⚠ ${readSku} ya tenía otro UPC en el catálogo. No se sobreescribió.`
                  );
                }
              });
            }
          } else {
            // Se leyó texto, pero no es de esta orden. Puede ser una caja de
            // otra orden del grupo, un error de lectura o una caja ajena de
            // verdad: las tres se ven igual desde aquí.
            setOcrStatusMessage(`Leído "${readSku}" — no está en esta orden. Verificá a mano.`);
          }

          const ocrCandidate: ProposedBoxCandidate = {
            sku: isExpected ? readSku : null,
            rawBarcode: readSku,
            format: 'OCR_TEXT',
            serial: extracted.serial || null,
            upc: targetUpc,
            conflict: isExpected ? null : `OCR leyó "${readSku}", que la orden no espera`,
            resolvedVia: isExpected ? 'ocr_text' : 'none',
            consecutiveFrames: 1,
            // El OCR es un canal más débil que las barras incluso cuando acierta:
            // aquí la certeza viene de que la orden esperaba justo ese SKU.
            confidence: isExpected ? 0.85 : 0.3,
            firstDetectedAt: Date.now(),
            lastDetectedAt: Date.now(),
          };

          setSessionState((prev) => setCandidateProposal(prev, ocrCandidate));
        } else {
          setOcrStatusMessage('No se detectó un SKU legible en la retícula. Acerque la cámara.');
        }
      } catch (err) {
        console.warn('[LiveCheck] Error en OCR de retícula:', err);
        setOcrStatusMessage(`Error OCR: ${err instanceof Error ? err.message : 'Lectura fallida'}`);
      } finally {
        setIsOcrProcessing(false);
        setTimeout(() => setOcrStatusMessage(null), 3500);
      }
    },
    [sessionState.items, sessionState.activeProposal]
  );

  const runOcrOnReticleRef = useRef(runOcrOnReticle);
  runOcrOnReticleRef.current = runOcrOnReticle;

  // 3. Loop de Escaneo de Cuadros en Tiempo Real
  useEffect(() => {
    if (!isCameraActive) return;

    let isScanning = true;
    let detector: any = null;

    if ('BarcodeDetector' in window) {
      try {
        detector = new (window as any).BarcodeDetector({
          formats: ['code_128', 'code_39', 'qr_code', 'upc_a', 'ean_13', 'itf'],
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
        diagnosticsRef.current.totalFramesProcessed++;
        currentBoxMetricsRef.current.framesProcessed++;

        if (detector) {
          try {
            const barcodes = await detector.detect(videoRef.current);
            if (barcodes && barcodes.length > 0) {
              let frameHasQr = false;
              let frameHasSerial = false;
              let frameHasCollision = false;

              for (const b of barcodes) {
                const isQr =
                  b.format === 'qr_code' ||
                  b.format === 'QRCode' ||
                  /^\d{2}\d{2}JC/i.test(b.rawValue);
                if (isQr) {
                  frameHasQr = true;
                  if (diagnosticsRef.current.framesToFirstQr === null) {
                    diagnosticsRef.current.framesToFirstQr =
                      diagnosticsRef.current.totalFramesProcessed;
                  }
                }

                const parsed = extractCandidateFromBarcode(b.rawValue);
                const factoryQr = isQr ? parseJamisFactoryQr(b.rawValue) : null;
                const detectedSerial = parsed.serial || factoryQr?.frame || null;

                if (detectedSerial) {
                  frameHasSerial = true;
                  if (diagnosticsRef.current.framesToFirstSerial === null) {
                    diagnosticsRef.current.framesToFirstSerial =
                      diagnosticsRef.current.totalFramesProcessed;
                  }

                  const collision = sessionState.confirmedBoxes.some(
                    (cb) => cb.serial && cb.serial.toUpperCase() === detectedSerial.toUpperCase()
                  );
                  if (collision) {
                    frameHasCollision = true;
                  }
                }

                if (parsed.sku && diagnosticsRef.current.framesToFirstSku === null) {
                  diagnosticsRef.current.framesToFirstSku =
                    diagnosticsRef.current.totalFramesProcessed;
                }

                const raw: RawBarcodeDetection = {
                  rawValue: b.rawValue,
                  format: b.format,
                  timestamp: Date.now(),
                };
                const candidate = consensusFilterRef.current.pushFrame(raw, {
                  catalogResolver: sessionUpcCatalogRef.current,
                });
                if (candidate) {
                  if (candidate.sku && diagnosticsRef.current.framesToFirstSku === null) {
                    diagnosticsRef.current.framesToFirstSku =
                      diagnosticsRef.current.totalFramesProcessed;
                  }
                  if (factoryQr?.frame && !candidate.serial) {
                    candidate.serial = factoryQr.frame;
                  }
                  setSessionState((prev) => setCandidateProposal(prev, candidate));

                  // Auto-disparo inteligente de OCR en retícula si el código es un UPC/GTIN sin SKU en catálogo
                  if (!candidate.sku && candidate.upc && !isOcrProcessingRef.current) {
                    const now = Date.now();
                    const last = lastOcrAutoTriggerRef.current;
                    if (!last || last.code !== candidate.upc || now - last.timestamp > 2000) {
                      lastOcrAutoTriggerRef.current = { code: candidate.upc, timestamp: now };
                      void runOcrOnReticleRef.current(candidate.upc);
                    }
                  }

                  break; // Una propuesta activa a la vez
                }
              }

              if (frameHasQr) {
                diagnosticsRef.current.framesWithQr++;
                currentBoxMetricsRef.current.framesWithQr++;
              }
              if (frameHasSerial) {
                diagnosticsRef.current.framesWithSerial++;
                currentBoxMetricsRef.current.framesWithSerial++;
              }
              if (frameHasCollision) {
                diagnosticsRef.current.identifierCollisions++;
                currentBoxMetricsRef.current.hadCollision = true;
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
  }, [isCameraActive, sessionState.confirmedBoxes]);

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

    const activeCandidate = sessionState.activeProposal?.candidate;
    if (!activeCandidate?.sku) return;
    const activeBoxIndex = sessionState.confirmedBoxes.length + 1;

    diagnosticsRef.current.boxRecords.push({
      boxIndex: activeBoxIndex,
      sku: activeCandidate?.sku || 'UNKNOWN',
      serial: activeCandidate?.serial || null,
      qrRaw: activeCandidate?.format?.toLowerCase().includes('qr')
        ? activeCandidate.rawBarcode
        : null,
      format: activeCandidate?.format || null,
      framesProcessed: currentBoxMetricsRef.current.framesProcessed,
      framesWithSerial: currentBoxMetricsRef.current.framesWithSerial,
      framesWithQr: currentBoxMetricsRef.current.framesWithQr,
      framesToFirstRead: activeCandidate?.consecutiveFrames || 0,
      hadCollision: currentBoxMetricsRef.current.hadCollision,
      confirmedAt: Date.now(),
    });

    currentBoxMetricsRef.current = {
      framesProcessed: 0,
      framesWithSerial: 0,
      framesWithQr: 0,
      hadCollision: false,
    };

    setSessionState((prev) => {
      const { state } = confirmActiveBox(prev);
      return state;
    });
    consensusFilterRef.current.reset();
    lastOcrAutoTriggerRef.current = null;
    setOcrStatusMessage(null);
  };

  const handleDismissProposal = () => {
    setSessionState((prev) => clearActiveProposal(prev));
    consensusFilterRef.current.reset();
    lastOcrAutoTriggerRef.current = null;
    setOcrStatusMessage(null);
  };

  const handleUndo = () => {
    try {
      if (navigator.vibrate) navigator.vibrate(25);
    } catch {
      // Ignore vibration error
    }
    if (diagnosticsRef.current.boxRecords.length > 0) {
      diagnosticsRef.current.boxRecords.pop();
    }
    setSessionState((prev) => undoLastConfirmation(prev));
  };

  const handleCopyResult = useCallback(() => {
    const diag = diagnosticsRef.current;
    const payload = {
      tipo: 'TELEMETRIA_BARRIDO_LIVE_CHECK_R15',
      timestamp: new Date().toISOString(),
      resumen_sesion: {
        ordenes: sessionState.orders.map((o) => o.orderNumber),
        grupo_id: sessionState.groupId,
        cajas_confirmadas: sessionState.confirmedBoxes.length,
        bicis_requeridas: sessionState.stats.totalBikesRequired,
        cuadros_totales_procesados: diag.totalFramesProcessed,
        cuadros_con_qr: diag.framesWithQr,
        cuadros_con_serial: diag.framesWithSerial,
        tasa_lectura_qr:
          diag.totalFramesProcessed > 0
            ? `${((diag.framesWithQr / diag.totalFramesProcessed) * 100).toFixed(1)}%`
            : '0%',
        tasa_lectura_serial:
          diag.totalFramesProcessed > 0
            ? `${((diag.framesWithSerial / diag.totalFramesProcessed) * 100).toFixed(1)}%`
            : '0%',
        cuadros_hasta_primer_sku: diag.framesToFirstSku,
        cuadros_hasta_primer_qr: diag.framesToFirstQr,
        cuadros_hasta_primer_serial: diag.framesToFirstSerial,
        colisiones_identificador: diag.identifierCollisions,
        duracion_segundos: diag.sessionStartedAt
          ? Math.round((Date.now() - diag.sessionStartedAt) / 1000)
          : 0,
      },
      cajas_detalle: diag.boxRecords,
      cajas_confirmadas_sesion: sessionState.confirmedBoxes.map((b) => ({
        sku: b.sku,
        orden: b.targetOrderNumber,
        serial: b.serial,
      })),
    };

    const text = JSON.stringify(payload, null, 2);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        setCopiedResult(true);
        setTimeout(() => setCopiedResult(false), 2500);
      });
    }
  }, [sessionState]);

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

        {/* CONTROLES DE CÁMARA Y TELEMETRÍA */}
        <div className="flex items-center gap-2">
          {sessionState.orders.length > 0 && (
            <>
              <button
                type="button"
                onClick={handleCopyResult}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold shadow-sm transition-all active:scale-[0.98]"
                title="Copiar telemetría y diagnóstico del barrido"
              >
                {copiedResult ? (
                  <Check className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Copy className="w-4 h-4 text-slate-400" />
                )}
                <span>{copiedResult ? 'Copiado' : 'Copiar resultado'}</span>
              </button>

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
            </>
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

            {/* ÓRDENES ACTIVAS EN PISO (DINÁMICAS EN TIEMPO REAL) */}
            <div className="pt-2 border-t border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5 text-emerald-400" />
                  Órdenes listas en piso ({activeFloorOrders.length})
                </span>
                <button
                  type="button"
                  onClick={fetchActiveFloorOrders}
                  disabled={loadingFloorOrders}
                  className="p-1 text-slate-400 hover:text-white transition-colors"
                  title="Refrescar lista de órdenes"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${loadingFloorOrders ? 'animate-spin text-emerald-400' : ''}`}
                  />
                </button>
              </div>

              {loadingFloorOrders && activeFloorOrders.length === 0 ? (
                <p className="text-xs text-slate-500 py-3 text-center">
                  Cargando órdenes del almacén...
                </p>
              ) : activeFloorOrders.length > 0 ? (
                <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                  {activeFloorOrders.map((ord) => {
                    const isGroup = ord.siblingNumbers.length > 1;
                    return (
                      <button
                        key={ord.id}
                        type="button"
                        onClick={() => {
                          setInputOrderNumber(ord.orderNumber);
                          loadOrderData(ord.orderNumber);
                        }}
                        className="w-full p-2.5 rounded-xl bg-slate-800/80 border border-slate-700/60 hover:border-emerald-500 text-left transition-all flex items-center justify-between group"
                      >
                        <div className="min-w-0 flex-1 mr-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-mono font-bold text-emerald-400">
                              {isGroup
                                ? ord.siblingNumbers.map((n) => `#${n}`).join(' + ')
                                : `#${ord.orderNumber}`}
                            </span>
                            {isGroup && (
                              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                                Grupo ({ord.siblingNumbers.length})
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-slate-400 block truncate">
                            {ord.customerName || (isGroup ? 'Orden combinada' : 'Orden individual')}
                          </span>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-xs font-mono font-bold text-white block">
                            {ord.totalBikes} {ord.totalBikes === 1 ? 'bici' : 'bicis'}
                          </span>
                          <span className="text-[10px] text-slate-500 uppercase font-semibold">
                            {ord.status === 'ready_to_double_check'
                              ? 'Ready DC'
                              : ord.status === 'double_checking'
                                ? 'En revisión'
                                : ord.status}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-slate-500 py-2 text-center">
                  No hay órdenes pendientes en este momento.
                </p>
              )}
            </div>

            {/* CANDIDATOS DE PISO RECOMENDADOS (L-0) */}
            <div className="pt-2 border-t border-slate-800/80">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">
                Órdenes de prueba de referencia (Sub-fase L-0):
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

              {/* HUD ÓPTICO SUPERIOR (Galaxy S25 Ultra 20–35 cm) */}
              {isCameraActive && (
                <div className="absolute top-3 inset-x-0 flex justify-center pointer-events-none z-10 px-4">
                  <div className="bg-slate-900/85 backdrop-blur border border-emerald-500/30 text-emerald-300 px-3 py-1 rounded-full text-[11px] font-mono shadow-md flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>Distancia: 20–35 cm</span>
                    <span className="text-slate-500">|</span>
                    <span>{opticalMetrics.pixelDensityPxPerMm} px/mm (Nyquist ≥1.8 px/mod)</span>
                  </div>
                </div>
              )}

              {/* BOTÓN RÁPIDO OCR (SUPERIOR DERECHA) */}
              {isCameraActive && (
                <button
                  onClick={() => runOcrOnReticle()}
                  disabled={isOcrProcessing}
                  title="Escanear texto de SKU con OCR"
                  className="absolute top-3 right-4 z-20 bg-slate-900/90 backdrop-blur hover:bg-slate-800 active:bg-cyan-950 border border-slate-700 hover:border-cyan-400 text-white px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 shadow-lg transition-all disabled:opacity-50"
                >
                  {isOcrProcessing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                  ) : (
                    <ScanText className="w-3.5 h-3.5 text-cyan-400" />
                  )}
                  <span className="text-cyan-200 font-mono text-[11px]">OCR</span>
                </button>
              )}

              {/* MENSAJE DE ESTADO OCR FLOTANTE */}
              {ocrStatusMessage && (
                <div className="absolute top-12 inset-x-0 flex justify-center pointer-events-none z-20 px-4">
                  <div className="bg-slate-900/95 backdrop-blur border border-cyan-500/60 text-cyan-300 px-3.5 py-1.5 rounded-full text-xs font-medium shadow-xl flex items-center gap-2 animate-in fade-in zoom-in duration-150">
                    {isOcrProcessing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400 shrink-0" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    )}
                    <span>{ocrStatusMessage}</span>
                  </div>
                </div>
              )}

              {/* RETÍCULA ÓPTICA DE ESCANEO (200-350 mm Safe Zone) */}
              {isCameraActive && (
                <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
                  <div
                    ref={reticleRef}
                    onClick={() => runOcrOnReticle()}
                    className={`w-72 h-44 border-2 border-dashed ${
                      isOcrProcessing
                        ? 'border-cyan-400 animate-pulse bg-cyan-500/10'
                        : 'border-emerald-400/70 bg-emerald-500/5 hover:border-emerald-300'
                    } rounded-2xl relative shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] pointer-events-auto cursor-pointer flex items-end justify-center pb-2 transition-colors`}
                  >
                    {/* Guías esquineras */}
                    <div className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-emerald-400" />
                    <div className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-emerald-400" />
                    <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-emerald-400" />
                    <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-emerald-400" />

                    <span className="text-[10px] font-medium bg-slate-900/85 px-2.5 py-0.5 rounded-full text-slate-300 backdrop-blur border border-slate-700/70 flex items-center gap-1 shadow">
                      {isOcrProcessing ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin text-cyan-400" />
                          <span>Leyendo texto...</span>
                        </>
                      ) : (
                        <>
                          <ScanText className="w-3 h-3 text-emerald-400" />
                          <span>Toca para leer SKU</span>
                        </>
                      )}
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
                          onClick={() =>
                            proposal.candidate.sku &&
                            handleBatchConfirmParts(proposal.candidate.sku)
                          }
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

                  {/* UNIDENTIFIED (CÓDIGO LEÍDO PERO SKU NO RESUELTO) */}
                  {proposal.population === 'UNIDENTIFIED' && (
                    <div className="bg-slate-900/95 backdrop-blur border-2 border-slate-700 rounded-2xl p-4 shadow-2xl space-y-3">
                      <div className="flex items-start gap-2.5 text-slate-300">
                        <Search className="w-5 h-5 shrink-0 text-cyan-400 mt-0.5" />
                        <div>
                          <h3 className="text-sm font-bold text-white">
                            Código leído • SKU no identificado
                          </h3>
                          <p className="text-xs text-slate-300 mt-1">{proposal.statusMessage}</p>
                          <p className="text-[11px] text-slate-400 mt-1">
                            Alinee el SKU impreso en la caja (ej. 03-3869BL) dentro de la retícula
                            para leerlo con OCR.
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2">
                        <button
                          onClick={() => runOcrOnReticle(proposal.candidate.upc)}
                          disabled={isOcrProcessing}
                          className="w-full py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 active:bg-cyan-700 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-cyan-950/50 transition-all"
                        >
                          {isOcrProcessing ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              <span>Leyendo texto con OCR...</span>
                            </>
                          ) : (
                            <>
                              <ScanText className="w-4 h-4" />
                              <span>Leer SKU Impreso con OCR</span>
                            </>
                          )}
                        </button>

                        <button
                          onClick={handleDismissProposal}
                          className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                        >
                          Entendido / Seguir Escaneando
                        </button>
                      </div>
                    </div>
                  )}

                  {/* CONFLICT (DISCREPANCIA O AMBIGÜEDAD) */}
                  {proposal.population === 'CONFLICT' && (
                    <div className="bg-slate-900/95 backdrop-blur border-2 border-amber-500 rounded-2xl p-4 shadow-2xl space-y-3">
                      <div className="flex items-start gap-2 text-amber-400">
                        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                        <div>
                          <h3 className="text-sm font-bold text-white">
                            ⚠️ Conflicto de Identidad
                          </h3>
                          <p className="text-xs text-slate-300 mt-1">{proposal.statusMessage}</p>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={handleDismissProposal}
                          className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
                        >
                          Descartar Lectura
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
