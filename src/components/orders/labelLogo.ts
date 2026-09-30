/**
 * El logo del carrier listo para una etiqueta impresa: el PNG en blanco y negro
 * (`TRANSPORT_LOGOS_BW`) como data URL, derecho y girado 90° a la derecha —el
 * girado es para la última etiqueta, la que se lee de lado—. Se gira aquí, en
 * un canvas, y no en jsPDF: su `addImage` gira sobre una esquina y mueve la
 * imagen, y así el PDF sólo coloca rectángulos.
 *
 * `null` si el carrier no tiene logo (PICK UP) o no se pudo cargar: la etiqueta
 * escribe entonces el nombre.
 */
import { transportLogoBwSrc } from './transportLogos';

export interface LabelLogo {
  /** Derecho: ancho × alto en píxeles. */
  dataUrl: string;
  width: number;
  height: number;
  /** Girado 90° a la derecha: su ancho es el alto del derecho. */
  rotatedDataUrl: string;
}

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

export async function loadLabelLogo(carrier: string | null | undefined): Promise<LabelLogo | null> {
  const src = transportLogoBwSrc(carrier);
  if (!src) return null;
  try {
    const img = await loadImage(src);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const upright = document.createElement('canvas');
    upright.width = w;
    upright.height = h;
    upright.getContext('2d')!.drawImage(img, 0, 0);
    const turned = document.createElement('canvas');
    turned.width = h;
    turned.height = w;
    const c = turned.getContext('2d')!;
    c.translate(h, 0);
    c.rotate(Math.PI / 2);
    c.drawImage(img, 0, 0);
    return {
      dataUrl: upright.toDataURL('image/png'),
      width: w,
      height: h,
      rotatedDataUrl: turned.toDataURL('image/png'),
    };
  } catch {
    return null;
  }
}
