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

interface PalletScanSheetProps {
  /** Para el título: qué foto de cuántas es ésta. */
  photoCount?: number;
  photoTotal?: number;
  /**
   * Cada foto tomada, tal cual. La hoja no sube nada ni sabe de órdenes: quien
   * la abre decide qué hacer con el archivo.
   */
  onPhoto?: (file: File) => void;
  onClose: () => void;
}

/** Sólo se pinta lo que tiene SKU: un recuadro sin nombre no dice nada. */
const namedBoxes = (boxes: readonly DetectedBoxResult[]): DetectedBoxResult[] =>
  boxes.filter((b) => !!b.sku.photoValue);

const isConfirmed = (box: DetectedBoxResult): boolean => box.catalogStatus === 'found';

export const PalletScanSheet: React.FC<PalletScanSheetProps> = ({
  photoCount,
  photoTotal,
  onPhoto,
  onClose,
}) => {
  // Dos entradas y no una: `capture` manda a la cámara de una, que es el gesto
  // del piso, pero deja fuera la foto que ya está en el carrete — y probar esto
  // con una foto vieja de un pallet es media hora menos que bajar a buscarlo.
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<string | null>(null);
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

  const handleFile = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // The same input is reused for the next pallet, so it has to forget.
      event.target.value = '';
      if (!file) return;

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

  const painted = namedBoxes(boxes);
  const confirmedCount = painted.filter(isConfirmed).length;

  return (
    <div className="fixed inset-0 z-[180] flex flex-col bg-black/90">
      <div className="flex shrink-0 items-start justify-between border-b border-white/10 px-4 py-3">
        <div>
          <h2 className="text-sm font-black uppercase tracking-wider text-white">
            Escanear pallet
          </h2>
          <p className="mt-0.5 text-[11px] text-white/60">
            {photoTotal
              ? `Foto ${Math.max(1, photoCount ?? 1)} de ${photoTotal}`
              : 'Una foto de frente al pallet'}
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Cerrar"
          className="-mr-2 -mt-1 shrink-0 rounded-full p-2 text-white/60 transition-colors hover:bg-white/10"
        >
          <X size={20} />
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto p-4">
        {!photoUrl && (
          <div className="flex w-full max-w-sm flex-col items-center gap-3">
            <button
              onClick={() => cameraRef.current?.click()}
              className="flex w-full flex-col items-center gap-2 rounded-2xl border border-dashed border-white/25 px-4 py-12 text-white/70 transition-transform active:scale-[0.99]"
            >
              <Camera size={30} className="text-violet-400" />
              <span className="text-xs font-black uppercase tracking-wider text-white">
                Tomar foto del pallet
              </span>
            </button>
            <button
              onClick={() => uploadRef.current?.click()}
              className="flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-black uppercase tracking-widest text-white/60 transition-colors hover:text-white"
            >
              <ImageUp size={14} />
              Subir una foto
            </button>
          </div>
        )}

        {photoUrl && (
          <div className="relative w-full max-w-lg">
            <img src={photoUrl} alt="" className="block w-full rounded-xl" />
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
                  className={`pointer-events-none absolute animate-in fade-in zoom-in duration-200 rounded-md border-2 ${
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

      {photoUrl && (
        <div className="shrink-0 border-t border-white/10 px-4 py-3">
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
          <div className="flex gap-2">
            <button
              onClick={() => cameraRef.current?.click()}
              disabled={!!step}
              className="flex-1 rounded-xl border border-white/20 py-2.5 text-xs font-black uppercase tracking-widest text-white transition-transform active:scale-[0.99] disabled:opacity-40"
            >
              Otra foto
            </button>
            <button
              onClick={() => uploadRef.current?.click()}
              disabled={!!step}
              aria-label="Subir una foto"
              className="shrink-0 rounded-xl border border-white/20 px-4 text-white transition-transform active:scale-[0.99] disabled:opacity-40"
            >
              <ImageUp size={16} />
            </button>
          </div>
        </div>
      )}

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFile}
        className="hidden"
      />
      {/* Sin `capture`: el mismo selector de archivos de siempre, que en el
          teléfono es el carrete y en el escritorio es el disco. */}
      <input
        ref={uploadRef}
        type="file"
        accept="image/*"
        onChange={handleFile}
        className="hidden"
      />
    </div>
  );
};

export default PalletScanSheet;
