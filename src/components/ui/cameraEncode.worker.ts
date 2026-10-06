/**
 * Codifica la foto de la cámara fuera del hilo principal (`CameraCaptureSheet`).
 *
 * Un JPEG de 4K tarda en el Android de Bay lo bastante para trabar la pantalla
 * después de cada disparo (5 oct 2026). Aquí llega el cuadro elegido como
 * `ImageBitmap` (transferido, sin copia) y el giro que lo endereza; vuelve un
 * Blob. Si algo falla devuelve el cuadro, y la hoja lo codifica en el hilo
 * principal: un disparo nunca se pierde.
 */
interface EncodeRequest {
  id: number;
  bitmap: ImageBitmap;
  rotateDeg: number;
  quality: number;
}

self.onmessage = async (event: MessageEvent<EncodeRequest>) => {
  const { id, bitmap, rotateDeg, quality } = event.data;
  try {
    const turned = rotateDeg % 180 !== 0;
    const width = turned ? bitmap.height : bitmap.width;
    const height = turned ? bitmap.width : bitmap.height;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d');
    ctx.translate(width / 2, height / 2);
    ctx.rotate((rotateDeg * Math.PI) / 180);
    ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    bitmap.close();
    (self as unknown as Worker).postMessage({ id, blob });
  } catch {
    (self as unknown as Worker).postMessage({ id, blob: null, bitmap }, [bitmap]);
  }
};
