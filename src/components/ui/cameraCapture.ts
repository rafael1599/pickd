/**
 * Las piezas puras de la cámara de PickD (`CameraCaptureSheet.tsx`).
 *
 * Rafael, 5 oct 2026: «que no salgan fotos movidas y no se siga lageando cuando
 * se gira el teléfono». Lo medido ese día en las 124 fotos de Double Check: el
 * cuarto más borroso leía el 31 % de sus etiquetas y el más nítido el 75 %. La
 * foto era el cuadro del vídeo en el instante del toque —el mismo toque mueve
 * el teléfono—, así que ahora se mira medio segundo de cuadros y se queda el
 * más nítido ({@link sharpness}).
 *
 * Y al girar, como la cámara del teléfono: el visor no se mueve, sólo giran los
 * iconos, y la foto se endereza al guardarla ({@link angleFromGravity},
 * {@link uprightSize}). Donde se puede bloquear la pantalla en vertical
 * (Android); en iPhone Safari no lo deja.
 */

/** Cuánto tiempo, después del toque, se buscan cuadros más nítidos. */
export const STEADY_WINDOW_MS = 500;

/** Lado del recorte central donde se mide la nitidez, en píxeles del vídeo. */
export const SHARPNESS_CROP = 256;

/**
 * Nitidez de un recorte en gris: la varianza del laplaciano. Un cuadro movido
 * borra los bordes y la varianza cae. Sólo compara cuadros de la misma escena
 * entre sí (una foto de lejos también da poco sin estar movida).
 *
 * `rgba` = los bytes de `getImageData` de un recorte `w × h`.
 */
export function sharpness(rgba: Uint8ClampedArray, w: number, h: number): number {
  if (w < 3 || h < 3) return 0;
  const grey = new Float32Array(w * h);
  for (let i = 0, p = 0; i < grey.length; i += 1, p += 4) {
    grey[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
  }
  let n = 0;
  let sum = 0;
  let sum2 = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      const l = grey[i - 1] + grey[i + 1] + grey[i - w] + grey[i + w] - 4 * grey[i];
      n += 1;
      sum += l;
      sum2 += l * l;
    }
  }
  const mean = sum / n;
  return sum2 / n - mean * mean;
}

export type PhoneAngle = 0 | 90 | -90;

/**
 * Cómo está el teléfono según la gravedad (`devicemotion`,
 * `accelerationIncludingGravity`, ejes del dispositivo como en la
 * especificación: con el teléfono derecho, `y` ≈ +9,8). Mismo convenio que
 * `screen.orientation.angle`: 90 = girado a la izquierda (la parte de arriba
 * hacia la izquierda), -90 = a la derecha. Boca abajo cuenta como derecho.
 *
 * Con histéresis: sólo cambia cuando el otro eje gana con margen, para que no
 * baile cerca de los 45°. Plano sobre la mesa no dice nada: se queda `prev`.
 */
export function angleFromGravity(
  x: number | null | undefined,
  y: number | null | undefined,
  prev: PhoneAngle = 0
): PhoneAngle {
  if (x == null || y == null) return prev;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (Math.hypot(x, y) < 3) return prev;
  const margin = 1.25;
  if (ax > ay * margin) return x > 0 ? 90 : -90;
  if (ay > ax * margin) return 0;
  return prev;
}

/**
 * El tamaño de la foto enderezada: con el teléfono de lado, el cuadro vertical
 * del visor bloqueado se guarda girado, con ancho y alto cambiados. El giro del
 * lienzo es `-angle` grados (horario positivo).
 */
export function uprightSize(
  width: number,
  height: number,
  angle: PhoneAngle
): { width: number; height: number; rotateDeg: number } {
  if (angle === 0) return { width, height, rotateDeg: 0 };
  return { width: height, height: width, rotateDeg: -angle };
}
