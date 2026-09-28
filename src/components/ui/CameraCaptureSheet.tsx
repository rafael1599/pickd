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
 *
 * ## Girar el teléfono no mueve nada, sólo los iconos (28 sep 2026)
 *
 * Rafael, con el iPhone: al pasar a horizontal «se aleja la imagen, se pone
 * negro, después gira, otra vez pantalla negra y después aparece». Eran tres
 * cosas: la animación del sistema, **esta pantalla cambiando de forma** (el
 * visor pasaba de columna a fila y el vídeo se reencajaba: primer negro) y
 * Safari **reconfigurando la cámara** para la orientación nueva (segundo negro;
 * WebKit 176843 y relacionados, sin arreglo). La segunda la quitamos: como la
 * cámara del teléfono, la hoja se queda en el mismo borde físico —se deshace el
 * giro de la interfaz con un `rotate`— y sólo los iconos giran para leerse. El
 * vídeo, que llega derecho respecto al mundo, se vuelve a girar dentro. La
 * tercera se tapa: al girar se congela el último cuadro hasta que llega uno
 * nuevo. La primera es del sistema y Safari no deja bloquear la orientación.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Camera from 'lucide-react/dist/esm/icons/camera';
import ImageUp from 'lucide-react/dist/esm/icons/image-up';
import Check from 'lucide-react/dist/esm/icons/check';
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw';

interface CameraCaptureSheetProps {
  /** Cuántas fotos lleva y cuántas espera — el único número en pantalla. */
  count?: number;
  total?: number;
  /** Cada disparo y cada foto elegida del carrete, como archivo. */
  onCapture: (file: File) => void;
  onClose: () => void;
  /**
   * Una sola foto que sustituye a otra (la del SKU, la etiqueta de un retorno):
   * se ve antes de guardarla, con Repetir y Usar, y Usar la entrega y cierra.
   */
  single?: boolean;
}

const stamp = (): string => `pallet-${Date.now()}.jpg`;

/**
 * Cuánto giró la interfaz respecto al teléfono en vertical, en grados CSS
 * (horario positivo): 0, 90 o -90. `screen.orientation.angle` donde existe
 * (iOS 16.4+, Android) y si no el viejo `window.orientation`; ambos dicen 90
 * con el teléfono girado a la izquierda. Boca abajo se trata como vertical.
 */
function readInterfaceAngle(): 0 | 90 | -90 {
  const raw =
    typeof screen !== 'undefined' &&
    screen.orientation &&
    typeof screen.orientation.angle === 'number'
      ? screen.orientation.angle
      : typeof window !== 'undefined' &&
          typeof (window as unknown as { orientation?: number }).orientation === 'number'
        ? (window as unknown as { orientation: number }).orientation
        : 0;
  const a = ((raw % 360) + 360) % 360;
  return a === 90 ? 90 : a === 270 ? -90 : 0;
}

/**
 * El ángulo, y un aviso **antes** de aplicarlo: congelar el cuadro tiene que
 * pasar en el evento de giro, antes de que Safari ponga el vídeo en negro.
 */
function useInterfaceAngle(onTurn?: () => void): 0 | 90 | -90 {
  const [angle, setAngle] = useState(readInterfaceAngle);
  const onTurnRef = useRef(onTurn);
  useEffect(() => {
    onTurnRef.current = onTurn;
  });
  useEffect(() => {
    let last = readInterfaceAngle();
    const update = () => {
      const next = readInterfaceAngle();
      if (next === last) return;
      last = next;
      onTurnRef.current?.();
      setAngle(next);
    };
    screen.orientation?.addEventListener?.('change', update);
    window.addEventListener('orientationchange', update);
    window.addEventListener('resize', update);
    return () => {
      screen.orientation?.removeEventListener?.('change', update);
      window.removeEventListener('orientationchange', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return angle;
}

export const CameraCaptureSheet: React.FC<CameraCaptureSheetProps> = ({
  count,
  total,
  onCapture,
  onClose,
  single = false,
}) => {
  const [pending, setPending] = useState<{ file: File; url: string } | null>(null);
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
  // El último cuadro, congelado mientras Safari reconfigura la cámara al girar.
  const freezeRef = useRef<HTMLCanvasElement>(null);
  const [frozen, setFrozen] = useState(false);
  const thawRef = useRef<() => void>(() => {});
  const freeze = useCallback(() => {
    const video = videoRef.current;
    const canvas = freezeRef.current;
    if (!video || !canvas || !video.videoWidth) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    thawRef.current();
    setFrozen(true);
    let done = false;
    const fallback = setTimeout(() => thaw(), 1500);
    const thaw = () => {
      if (done) return;
      done = true;
      clearTimeout(fallback);
      video.removeEventListener('resize', onResize);
      setFrozen(false);
    };
    // Se descongela con el primer cuadro nuevo después de que el vídeo cambie
    // de forma; si no llega, a los 1,5 s de todas formas.
    const onResize = () => {
      const v = video as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: () => void) => number;
      };
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => thaw());
      else setTimeout(thaw, 150);
    };
    video.addEventListener('resize', onResize);
    thawRef.current = thaw;
  }, []);
  useEffect(() => () => thawRef.current(), []);
  const angle = useInterfaceAngle(freeze);

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
      if (single) {
        setPending({ file, url });
        return;
      }
      setShots((prev) => [...prev, { id: `${Date.now()}-${prev.length}`, url }]);
      onCapture(file);
    },
    [onCapture, single]
  );

  const confirmPending = useCallback(() => {
    if (!pending) return;
    onCapture(pending.file);
    onClose();
  }, [pending, onCapture, onClose]);

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

  const turned = angle !== 0;
  // La hoja siempre en vertical respecto al teléfono: con la interfaz girada se
  // le cambian ancho y alto y se deshace el giro. Lo que tiene que leerse
  // (iconos, contador) gira `angle` para quedar derecho.
  const sheetStyle: React.CSSProperties = turned
    ? {
        width: '100vh',
        height: '100vw',
        top: '50%',
        left: '50%',
        transform: `translate(-50%, -50%) rotate(${-angle}deg)`,
      }
    : { inset: 0 };
  const upright: React.CSSProperties = {
    transform: `rotate(${angle}deg)`,
    transition: 'transform 200ms ease-out',
  };
  // El vídeo y la foto llegan derechos respecto al mundo: dentro de la hoja
  // girada se vuelven a girar, con ancho y alto del visor cambiados (`cqh`/`cqw`).
  const worldStyle: React.CSSProperties = turned
    ? {
        position: 'absolute',
        top: '50%',
        left: '50%',
        width: '100cqh',
        height: '100cqw',
        // La base de Tailwind pone `max-width: 100%` a video/img/canvas: sin
        // anularlo el vídeo girado se queda en el ancho del visor.
        maxWidth: 'none',
        transform: `translate(-50%, -50%) rotate(${angle}deg)`,
      }
    : { position: 'absolute', inset: 0, width: '100%', height: '100%' };

  return (
    // Above every modal it can open from (they reach z-[300]), below the toasts.
    <div className="fixed z-[400] flex flex-col bg-black" style={sheetStyle}>
      <div className="relative flex-1 overflow-hidden" style={{ containerType: 'size' }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="object-cover"
          style={worldStyle}
        />
        <canvas
          ref={freezeRef}
          aria-hidden="true"
          className={`pointer-events-none object-cover ${frozen ? '' : 'hidden'}`}
          style={worldStyle}
        />

        {flash && <div className="pointer-events-none absolute inset-0 bg-white/70" />}

        {pending && (
          <img src={pending.url} alt="" className="bg-black object-contain" style={worldStyle} />
        )}

        {total ? (
          <span className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-[11px] font-black uppercase tracking-widest text-white">
            <span className="inline-block" style={upright}>
              {count ?? 0} / {total}
            </span>
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

      {/* Miniaturas y controles bajo el visor, siempre en el mismo borde físico. */}
      <div className="flex shrink-0 flex-col pb-[env(safe-area-inset-bottom)]">
        {shots.length > 0 && (
          <div className="flex shrink-0 gap-2 overflow-x-auto px-4 pt-3">
            {shots.map((shot) => (
              <img
                key={shot.id}
                src={shot.url}
                alt=""
                style={upright}
                className="h-14 w-14 shrink-0 rounded-lg border border-white/20 object-cover"
              />
            ))}
          </div>
        )}

        {/* Galería, disparador, listo. Nada más. */}
        <div className="flex shrink-0 items-center justify-between px-8 py-6">
          {pending ? (
            <button
              onClick={() => setPending(null)}
              aria-label="Repetir la foto"
              className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/25 text-white active:scale-95"
            >
              <RotateCcw size={22} style={upright} />
            </button>
          ) : (
            <button
              onClick={() => galleryRef.current?.click()}
              aria-label="Subir una foto de la galería"
              className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/25 text-white active:scale-95"
            >
              <ImageUp size={22} style={upright} />
            </button>
          )}

          <button
            onClick={shoot}
            disabled={!!error || !!pending}
            aria-label="Tomar la foto"
            className="h-20 w-20 rounded-full border-4 border-white/40 bg-white transition-transform active:scale-90 disabled:opacity-30"
          >
            <Camera size={26} className="mx-auto text-black" strokeWidth={2.5} style={upright} />
          </button>

          <button
            onClick={pending ? confirmPending : onClose}
            aria-label={pending ? 'Usar la foto' : 'Listo'}
            className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500 text-white active:scale-95"
          >
            <Check size={24} strokeWidth={3} style={upright} />
          </button>
        </div>
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
