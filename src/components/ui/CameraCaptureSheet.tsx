/**
 * La cámara dentro de PickD: se ve el visor y se dispara sin salir de la app.
 *
 * El `capture="environment"` de un input abre la cámara del sistema, que es una
 * pantalla ajena y sellada: no se le puede poner al lado el botón del carrete,
 * y en ese modo Android tampoco lo trae. Con el visor propio las dos cosas
 * caben en la misma pantalla, que es lo que hacía falta (Rafael, 23 sep 2026:
 * «al mismo tiempo veo la cámara, un botón de capturar y uno que me lleve a la
 * galería, todo lo demás minimalista»).
 *
 * Disparar **añade** — el visor se queda abierto, así que tres pallets son tres
 * toques y no tres viajes por el menú. Cada foto aparece **al instante** abajo,
 * desde el archivo que se acaba de sacar y no desde la que vuelve de R2: quien
 * está delante del pallet necesita saber que salió antes de moverse, y la
 * subida tarda lo que tarde. Nada más: ni lectura de etiquetas, ni retícula, ni
 * ajustes. Lo que sale de aquí es un archivo.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Camera from 'lucide-react/dist/esm/icons/camera';
import ImageUp from 'lucide-react/dist/esm/icons/image-up';
import X from 'lucide-react/dist/esm/icons/x';

interface CameraCaptureSheetProps {
  /** Cuántas fotos lleva y cuántas espera — el único número en pantalla. */
  count?: number;
  total?: number;
  /** Cada disparo y cada foto elegida del carrete, como archivo. */
  onCapture: (file: File) => void;
  onClose: () => void;
}

const stamp = (): string => `pallet-${Date.now()}.jpg`;

export const CameraCaptureSheet: React.FC<CameraCaptureSheetProps> = ({
  count,
  total,
  onCapture,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const systemCameraRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [shots, setShots] = useState<{ id: string; url: string }[]>([]);
  // La lista para devolver las URLs se lleva aparte: se escribe al disparar, que
  // es un evento, y no durante el render.
  const urlsRef = useRef<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      try {
        // Se pide todo lo que la cámara quiera dar: el navegador baja al modo
        // más cercano que exista, y una foto de pallet con más píxeles es la
        // misma foto, sólo que legible.
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 3840 },
            height: { ideal: 2160 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'No se pudo abrir la cámara.');
        }
      }
    };
    void start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  // Las miniaturas viven mientras el visor esté abierto, y cada una es una URL
  // que hay que devolver a mano.
  useEffect(
    () => () => {
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    },
    []
  );

  const addPhoto = useCallback(
    (file: File) => {
      const url = URL.createObjectURL(file);
      urlsRef.current.push(url);
      setShots((prev) => [...prev, { id: `${Date.now()}-${prev.length}`, url }]);
      onCapture(file);
    },
    [onCapture]
  );

  const shoot = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
    canvas.toBlob(
      (blob) => {
        if (blob) addPhoto(new File([blob], stamp(), { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.92
    );
  }, [addPhoto]);

  const handleInput = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) addPhoto(file);
    },
    [addPhoto]
  );

  return (
    <div className="fixed inset-0 z-[180] flex flex-col bg-black">
      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />

        {flash && <div className="pointer-events-none absolute inset-0 bg-white/70" />}

        {total ? (
          <span className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-[11px] font-black uppercase tracking-widest text-white">
            {count ?? 0} / {total}
          </span>
        ) : null}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-[11px] font-bold uppercase tracking-wider text-white/70">
              No se pudo abrir la cámara
            </p>
            <button
              onClick={() => systemCameraRef.current?.click()}
              className="rounded-xl border border-white/25 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white"
            >
              Usar la cámara del teléfono
            </button>
          </div>
        )}
      </div>

      {shots.length > 0 && (
        <div className="flex shrink-0 gap-2 overflow-x-auto px-4 pt-3">
          {shots.map((shot) => (
            <img
              key={shot.id}
              src={shot.url}
              alt=""
              className="h-14 w-14 shrink-0 rounded-lg border border-white/20 object-cover"
            />
          ))}
        </div>
      )}

      {/* Galería, disparador, cerrar. Nada más. */}
      <div className="flex shrink-0 items-center justify-between px-8 py-6">
        <button
          onClick={() => galleryRef.current?.click()}
          aria-label="Subir una foto de la galería"
          className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/25 text-white active:scale-95"
        >
          <ImageUp size={22} />
        </button>

        <button
          onClick={shoot}
          disabled={!!error}
          aria-label="Tomar la foto"
          className="h-20 w-20 rounded-full border-4 border-white/40 bg-white transition-transform active:scale-90 disabled:opacity-30"
        >
          <Camera size={26} className="mx-auto text-black" strokeWidth={2.5} />
        </button>

        <button
          onClick={onClose}
          aria-label="Cerrar"
          className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/25 text-white active:scale-95"
        >
          <X size={22} />
        </button>
      </div>

      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        onChange={handleInput}
        className="hidden"
      />
      <input
        ref={systemCameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleInput}
        className="hidden"
      />
    </div>
  );
};
