/**
 * Read a whole pallet from one photo, and paint what it read back onto it.
 *
 * The scanner this replaces looked for the QR that PickD prints. A factory
 * carton does not carry one — the pallet in front of the operator is Taiwanese
 * labels, MK numbers and GTINs — so pointing the camera at a real load and
 * getting nothing back was the normal outcome, not the edge case.
 *
 * What is on screen is the photo itself, dimmed, with every label it recognised
 * lit on top of it, each landing as it finishes rather than all at the end. The
 * point of drawing on the photo instead of listing SKUs underneath is that the
 * operator can check the answer without trusting it: the box is either around
 * the label he is looking at or it is not.
 *
 * **Purple is what the photo says. Green is what the catalogue confirms.** They
 * are two different claims and they are never merged — the same rule the engine
 * follows field by field (`recognizeMultiBoxClient`). Comparing any of this
 * against the order is a later step and deliberately not here yet.
 *
 * **The camera is not a choice** (Rafael, 23 sep 2026: "no dar a elegir al
 * usuario, mandarle directo a tomar la foto"). Tapping Take Photo opens the
 * camera, as it always did; the photo arrives here as `initialFile`. Uploading
 * one instead lives in the bottom-left corner, where the phone's own camera
 * keeps its gallery thumbnail — there for whoever looks for it, never in the
 * way of the person who just wants to shoot the pallet.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Camera from 'lucide-react/dist/esm/icons/camera';
import ImageUp from 'lucide-react/dist/esm/icons/image-up';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import X from 'lucide-react/dist/esm/icons/x';
import {
  recognizeMultiBoxClient,
  type DetectedBoxResult,
} from '../../../lib/recognition/recognizeMultiBoxClient';
import { toOverlayRect, type OverlayImageFrame } from '../../../lib/recognition/overlayBoxes';
import { lookupCatalogSku } from '../catalogLookup';

interface PalletScanSheetProps {
  /**
   * La foto que ya disparó quien abrió la hoja. El `click()` a la cámara tiene
   * que pasar dentro del mismo gesto que la pidió o el navegador lo descarta,
   * así que ese input vive en la pantalla que tiene el botón, no aquí.
   */
  initialFile?: File | null;
  /** Para el título: qué foto de cuántas es ésta. */
  photoCount?: number;
  photoTotal?: number;
  /**
   * Cada foto, tal cual. La hoja no sube nada ni sabe de órdenes: quien la abre
   * decide qué hacer con el archivo.
   */
  onPhoto?: (file: File) => void;
  onClose: () => void;
}

/** Sólo se pinta lo que tiene SKU: un recuadro sin nombre no dice nada. */
const namedBoxes = (boxes: readonly DetectedBoxResult[]): DetectedBoxResult[] =>
  boxes.filter((b) => !!b.sku.photoValue);

const isConfirmed = (box: DetectedBoxResult): boolean => box.catalogStatus === 'found';

/** `Foto 2 de 1` no es una frase: el total sólo se dice mientras signifique algo. */
function photoLabel(count?: number, total?: number): string {
  const n = Math.max(1, count ?? 1);
  if (total && n <= total) return `Foto ${n} de ${total}`;
  return `Foto ${n}`;
}

export const PalletScanSheet: React.FC<PalletScanSheetProps> = ({
  initialFile,
  photoCount,
  photoTotal,
  onPhoto,
  onClose,
}) => {
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<string | null>(null);
  const startedRef = useRef<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [frame, setFrame] = useState<OverlayImageFrame>({});
  const [boxes, setBoxes] = useState<DetectedBoxResult[]>([]);
  const [expected, setExpected] = useState<number | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // An object URL outlives the state that pointed at it unless someone revokes
  // it, and this sheet makes a new one per photo.
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    []
  );

  const processFile = useCallback(
    async (file: File) => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(file);
      setPhotoUrl(urlRef.current);
      setBoxes([]);
      setExpected(null);
      setFrame({});
      setError(null);
      setDone(false);
      setStep('Leyendo la foto…');
      onPhoto?.(file);

      try {
        const result = await recognizeMultiBoxClient(file, file.name, {
          catalog: lookupCatalogSku,
          onProgress: setStep,
          // Each label lands on the photo the moment it is read, instead of the
          // whole pallet appearing at once when the last catalogue call returns.
          onBox: (box, totalExpected) => {
            setExpected(totalExpected);
            setBoxes((prev) => [...prev, box]);
          },
        });
        setFrame(result.image);
        setBoxes(result.boxes);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo leer la foto.');
      } finally {
        setStep(null);
        setDone(true);
      }
    },
    [onPhoto]
  );

  // La foto que venía de la cámara arranca sola, sin un toque más.
  useEffect(() => {
    if (initialFile && startedRef.current !== initialFile) {
      startedRef.current = initialFile;
      void processFile(initialFile);
    }
  }, [initialFile, processFile]);

  const handleInput = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // The same input is reused for the next pallet, so it has to forget.
      event.target.value = '';
      if (file) void processFile(file);
    },
    [processFile]
  );

  const painted = namedBoxes(boxes);
  const confirmedCount = painted.filter(isConfirmed).length;
  const busy = !!step;

  return (
    // Acoplada abajo, como el sheet de registrar una caja y como el panel de
    // live-check: lo de detrás sigue ahí, atenuado. Una foto no es una pantalla
    // — es algo que se consulta y se cierra (Rafael, 23 sep 2026).
    <div className="fixed inset-0 z-[180] flex flex-col bg-black/70 backdrop-blur-sm">
      <button type="button" aria-label="Cerrar" onClick={onClose} className="flex-1" />
      <div className="flex max-h-[88vh] flex-col rounded-t-2xl border-t border-white/10 bg-black/95">
        <div className="flex shrink-0 items-start justify-between border-b border-white/10 px-4 py-3">
          <div>
            <h2 className="text-sm font-black uppercase tracking-wider text-white">
              Escanear pallet
            </h2>
            <p className="mt-0.5 text-[11px] text-white/60">{photoLabel(photoCount, photoTotal)}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="-mr-2 -mt-1 shrink-0 rounded-full p-2 text-white/60 transition-colors hover:bg-white/10"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto p-4">
          {!photoUrl && (
            <p className="max-w-xs text-center text-[11px] font-bold uppercase tracking-wider text-white/40">
              De frente al pallet, con las etiquetas dentro del cuadro
            </p>
          )}

          {photoUrl && (
            <div className="relative inline-block max-w-lg">
              {/* `inline-block` se encoge a la imagen, así que los recuadros en
                porcentaje siguen cayendo sobre la etiqueta aunque mande la
                altura y no el ancho. */}
              <img src={photoUrl} alt="" className="block max-h-[52vh] w-auto rounded-xl" />
              {/* El filtro oscuro: la foto sigue ahí para comprobar, pero lo que
                manda es lo que se reconoció. */}
              <div className="pointer-events-none absolute inset-0 rounded-xl bg-black/60" />

              {painted.map((box) => {
                const rect = toOverlayRect(box.bbox, frame);
                if (!rect) return null;
                const confirmed = isConfirmed(box);
                return (
                  <div
                    key={box.id}
                    className={`pointer-events-none absolute animate-in fade-in zoom-in rounded-md border-2 duration-200 ${
                      confirmed
                        ? 'border-emerald-400 bg-emerald-400/20'
                        : 'border-violet-400 bg-violet-500/25'
                    }`}
                    style={{
                      left: `${rect.leftPct}%`,
                      top: `${rect.topPct}%`,
                      width: `${rect.widthPct}%`,
                      height: `${rect.heightPct}%`,
                    }}
                  >
                    <span
                      className={`absolute -top-2 left-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-black tracking-wider ${
                        confirmed ? 'bg-emerald-400 text-black' : 'bg-violet-500 text-white'
                      }`}
                    >
                      {box.sku.photoValue}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {step && (
            <p className="mt-4 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-white/70">
              <Loader2 size={12} className="animate-spin" />
              {step}
              {expected != null && ` · ${painted.length} de ${expected}`}
            </p>
          )}

          {error && <p className="mt-4 text-[11px] font-bold text-red-400">{error}</p>}

          {done && !error && painted.length === 0 && (
            <p className="mt-4 text-[11px] font-bold uppercase tracking-wider text-white/70">
              Ninguna etiqueta legible en esta foto
            </p>
          )}
        </div>

        <div className="shrink-0 border-t border-white/10 px-4 py-3">
          {photoUrl && (
            <div className="mb-3 flex items-baseline gap-4">
              <span className="text-2xl font-black text-violet-400">
                {painted.length}
                <span className="ml-1.5 text-[10px] font-black uppercase tracking-widest text-white/50">
                  {painted.length === 1 ? 'sku' : 'skus'}
                </span>
              </span>
              <span className="text-2xl font-black text-emerald-400">
                {confirmedCount}
                <span className="ml-1.5 text-[10px] font-black uppercase tracking-widest text-white/50">
                  en catálogo
                </span>
              </span>
            </div>
          )}
          {/* Subir a la izquierda, donde la cámara del teléfono tiene el carrete;
            la foto, a la derecha y ancha, que es lo que se pulsa. */}
          <div className="flex gap-2">
            <button
              onClick={() => uploadRef.current?.click()}
              disabled={busy}
              className="flex shrink-0 items-center gap-2 rounded-xl border border-white/20 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white transition-transform active:scale-[0.99] disabled:opacity-40"
            >
              <ImageUp size={16} />
              Subir
            </button>
            <button
              onClick={() => cameraRef.current?.click()}
              disabled={busy}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/20 py-2.5 text-xs font-black uppercase tracking-widest text-white transition-transform active:scale-[0.99] disabled:opacity-40"
            >
              <Camera size={14} />
              {photoUrl ? 'Otra foto' : 'Tomar foto'}
            </button>
          </div>
        </div>

        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleInput}
          className="hidden"
        />
        {/* Sin `capture`: el mismo selector de archivos de siempre, que en el
          teléfono es el carrete y en el escritorio es el disco. */}
        <input
          ref={uploadRef}
          type="file"
          accept="image/*"
          onChange={handleInput}
          className="hidden"
        />
      </div>
    </div>
  );
};

export default PalletScanSheet;
