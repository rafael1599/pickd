/**
 * Las etiquetas de las cajas, sacadas de las fotos de Double Check, en una sola
 * textura (Rafael, 29 sep 2026: «la misma etiqueta que se extrae de las fotos
 * se le puede poner en su lugar a cada bicicleta»).
 *
 * `order_label_reads` dice, por SKU, en qué foto se leyó su etiqueta y dónde
 * (el recuadro en píxeles de la original de 3840 px). La foto ya es pública en
 * su versión de 1200 px, así que el recorte se hace aquí escalando el recuadro:
 * ~56 KB por foto y una descarga por foto, aunque traiga varias etiquetas.
 *
 * La etiqueta va al **frente** de la caja —la punta—, con un logo JAMIS BIKES
 * chico; los costados sólo llevan el logo grande (Rafael, 29 sep 2026). Cada
 * recorte se guarda como sale la FAULTLINE A1 de #881761, que es la punta de
 * una caja acostada: lado largo en horizontal y texto de abajo arriba. Los que
 * salen verticales —la foto se tomó de otra manera— se giran 90°, y el shader
 * los pone de pie en una caja de pie.
 *
 * Un SKU sin lectura lleva una etiqueta dibujada con lo que dice el catálogo, y
 * el HUD lo dice: no es la foto.
 */
import { supabase } from '../../../lib/supabase';
import { warpQuad, type Quad } from '../../../lib/recognition/labelLocator';
// El logo de la app —el mismo del icono de la tarjeta de inventario—, no uno dibujado.
import jamisLogoUrl from '../../../assets/jamis-bikes.webp';

/** Copiado de `ItemDetailView/useDominantColor.ts`; si cambia allá, cambiar acá. */
const R2_PUBLIC = 'https://pub-1a61139939fa4f3ba21ee7909510985c.r2.dev';

export const ATLAS_W = 2048;
export const ATLAS_H = 1024;
const CELL_W = 256;
const CELL_H = 128;
const COLS = 7; // 7 × 256 = 1792; los últimos 256 px son el logo
const ROWS = ATLAS_H / CELL_H;
const LOGO_X = COLS * CELL_W;

export interface LabelCell {
  /** Rectángulo en la textura, normalizado (v hacia abajo, como el canvas). */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** Lado corto / lado largo del recorte: con eso se da su tamaño en pulgadas. */
  aspect: number;
  source: 'photo' | 'drawn';
  /** La etiqueta derecha, para enseñarla en el HUD. */
  thumb: string;
}

/** Donde vive el logo «JAMIS BIKES» dentro de la textura. */
export const LOGO_RECT = {
  u0: LOGO_X / ATLAS_W,
  v0: 0,
  u1: 1,
  v1: 1,
};

interface Read {
  sku: string;
  photo_id: string;
  bbox: { x: number; y: number; w: number; h: number };
  /**
   * Las 4 esquinas en la foto original, en orden de lectura (desde el 30 sep 2026):
   * con ellas la etiqueta se endereza en vez de recortarse torcida y con cartón.
   */
  corners: [number, number][] | null;
  photo_width: number;
  photo_height: number;
}

export async function fetchLabelReads(listIds: string[]): Promise<Read[]> {
  if (listIds.length === 0) return [];
  const { data, error } = await supabase.rpc('order_label_reads', { p_list_ids: listIds });
  if (error || !data) return [];
  return data
    .filter((r) => r.photo_width && r.photo_height && r.bbox && typeof r.bbox === 'object')
    .map((r) => ({
      sku: r.sku,
      photo_id: r.photo_id,
      bbox: r.bbox as unknown as Read['bbox'],
      corners:
        Array.isArray(r.corners) && r.corners.length === 4
          ? (r.corners as unknown as [number, number][])
          : null,
      photo_width: r.photo_width!,
      photo_height: r.photo_height!,
    }));
}

function pixelsOf(img: ImageBitmap): ImageData {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height);
}

export class LabelAtlas {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cells = new Map<string, LabelCell>();
  private next = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = ATLAS_W;
    this.canvas.height = ATLAS_H;
    this.ctx = this.canvas.getContext('2d')!;
    this.ready = this.drawLogo();
  }

  /** Se resuelve cuando el logo ya está en la textura. */
  readonly ready: Promise<void>;

  cell(sku: string): LabelCell | undefined {
    return this.cells.get(sku);
  }

  /** Una celda nueva, o la que ya tenía el SKU. `null` si ya no caben más. */
  private slot(sku: string): { x: number; y: number } | null {
    const existing = this.cells.get(sku);
    if (existing) return { x: existing.u0 * ATLAS_W, y: existing.v0 * ATLAS_H };
    if (this.next >= COLS * ROWS) return null;
    const i = this.next++;
    return { x: (i % COLS) * CELL_W, y: Math.floor(i / COLS) * CELL_H };
  }

  private commit(
    sku: string,
    at: { x: number; y: number },
    aspect: number,
    source: LabelCell['source']
  ) {
    this.cells.set(sku, {
      u0: at.x / ATLAS_W,
      v0: at.y / ATLAS_H,
      u1: (at.x + CELL_W) / ATLAS_W,
      v1: (at.y + CELL_H) / ATLAS_H,
      aspect,
      source,
      thumb: this.thumbOf(at),
    });
  }

  /** La celda girada de vuelta a vertical, como se lee la etiqueta de pie. */
  private thumbOf(at: { x: number; y: number }): string {
    const t = document.createElement('canvas');
    t.width = CELL_H * 2;
    t.height = CELL_W * 2;
    const c = t.getContext('2d')!;
    c.translate(t.width, 0);
    c.rotate(Math.PI / 2);
    c.drawImage(this.canvas, at.x, at.y, CELL_W, CELL_H, 0, 0, t.height, t.width);
    try {
      return t.toDataURL('image/webp', 0.85);
    } catch {
      return '';
    }
  }

  /** Una etiqueta dibujada con lo que sabe el catálogo, para el SKU que no se leyó. */
  drawn(sku: string, label: string | null) {
    if (this.cells.get(sku)?.source === 'photo') return;
    const at = this.slot(sku);
    if (!at) return;
    const c = this.ctx;
    // Se dibuja de pie (vertical, texto horizontal) y se gira a lo largo de la caja.
    c.save();
    c.translate(at.x, at.y + CELL_H);
    c.rotate(-Math.PI / 2);
    const w = CELL_H; // de pie: el ancho es el lado corto
    const h = CELL_W;
    c.fillStyle = '#f5f4ee';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#111';
    c.font = '800 13px ui-sans-serif, system-ui, sans-serif';
    c.fillText('JAMIS', 8, 20);
    const bar = (y: number, text: string, size: number) => {
      c.fillStyle = '#111';
      c.fillRect(6, y, w - 12, size + 8);
      c.fillStyle = '#fff';
      c.font = `800 ${size}px ui-sans-serif, system-ui, sans-serif`;
      c.fillText(text, 10, y + size + 2, w - 20);
    };
    bar(30, sku, 14);
    bar(58, (label ?? '').toUpperCase() || '—', 11);
    c.fillStyle = '#111';
    for (let i = 0; i < 26; i += 1) {
      const bw = (i * 7) % 3 === 0 ? 3 : 1.5;
      c.fillRect(10 + i * 4, 92, bw, 34);
    }
    c.font = '700 9px ui-sans-serif, system-ui, sans-serif';
    c.fillText('QTY: 1 SET', 10, 144);
    c.fillStyle = '#888';
    c.fillText('drawn by PickD', 10, h - 10);
    c.restore();
    this.commit(sku, at, CELL_H / CELL_W, 'drawn');
  }

  /**
   * Los recortes de las fotos, una descarga por foto. `onUpdate` se llama cada
   * vez que entra una, para que la escena suba la textura otra vez.
   */
  async loadPhotos(reads: Read[], skus: Set<string>, onUpdate: () => void) {
    const byPhoto = new Map<string, Read[]>();
    for (const r of reads) {
      if (!skus.has(r.sku)) continue;
      (byPhoto.get(r.photo_id) ?? byPhoto.set(r.photo_id, []).get(r.photo_id)!).push(r);
    }
    await Promise.all(
      [...byPhoto.entries()].map(async ([photoId, list]) => {
        try {
          // Sin caché: Ship ya pinta esta foto en un <img> sin CORS, y reusar esa
          // copia hace fallar el recorte (skill `image-cors-cache-bust`).
          const res = await fetch(`${R2_PUBLIC}/photos/gallery/${photoId}.webp`, {
            mode: 'cors',
            cache: 'no-store',
          });
          if (!res.ok) return;
          const img = await createImageBitmap(await res.blob());
          // Los píxeles sólo hacen falta para enderezar por esquinas.
          const pixels = list.some((r) => r.corners) ? pixelsOf(img) : null;
          for (const r of list) {
            if (r.corners && pixels) this.warpInto(pixels, r);
            else this.cropInto(img, r);
          }
          img.close();
          onUpdate();
        } catch {
          /* se queda la dibujada */
        }
      })
    );
  }

  /** La etiqueta enderezada por sus esquinas, de pie, y girada a lo largo de la caja. */
  private warpInto(px: ImageData, r: Read) {
    const at = this.slot(r.sku);
    if (!at || !r.corners) return;
    const k = px.width / r.photo_width;
    const q = r.corners.map(([x, y]) => [x * k, y * k]) as Quad;
    const up = warpQuad({ width: px.width, height: px.height, data: px.data }, q, 384);
    const t = document.createElement('canvas');
    t.width = up.width;
    t.height = up.height;
    t.getContext('2d')!.putImageData(
      new ImageData(new Uint8ClampedArray(up.data), up.width, up.height),
      0,
      0
    );
    const c = this.ctx;
    c.save();
    c.clearRect(at.x, at.y, CELL_W, CELL_H);
    // de pie (vertical, texto horizontal) → a lo largo de la caja, como `drawn`
    c.translate(at.x, at.y + CELL_H);
    c.rotate(-Math.PI / 2);
    c.drawImage(t, 0, 0, CELL_H, CELL_W);
    c.restore();
    this.commit(r.sku, at, Math.min(up.width, up.height) / Math.max(up.width, up.height), 'photo');
  }

  private cropInto(img: ImageBitmap, r: Read) {
    const at = this.slot(r.sku);
    if (!at) return;
    const k = img.width / r.photo_width;
    const sx = r.bbox.x * k;
    const sy = r.bbox.y * k;
    const sw = r.bbox.w * k;
    const sh = r.bbox.h * k;
    const c = this.ctx;
    c.save();
    c.clearRect(at.x, at.y, CELL_W, CELL_H);
    if (sh > sw) {
      // Vertical en la foto: se gira para que su lado largo corra a lo largo de la caja.
      c.translate(at.x, at.y + CELL_H);
      c.rotate(-Math.PI / 2);
      c.drawImage(img, sx, sy, sw, sh, 0, 0, CELL_H, CELL_W);
    } else {
      c.drawImage(img, sx, sy, sw, sh, at.x, at.y, CELL_W, CELL_H);
    }
    c.restore();
    this.commit(r.sku, at, Math.min(sw, sh) / Math.max(sw, sh), 'photo');
  }

  /**
   * «JAMIS BIKES», el archivo de la app, en su celda alta y angosta: girado para
   * leerse de abajo arriba, como las etiquetas; el shader lo endereza en cada
   * cara. Conserva su proporción (180 × 37) centrado en la celda.
   */
  private drawLogo(): Promise<void> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = this.ctx;
        c.save();
        c.clearRect(LOGO_X, 0, ATLAS_W - LOGO_X, ATLAS_H);
        c.translate(LOGO_X, ATLAS_H);
        c.rotate(-Math.PI / 2);
        // Girado: el largo del logo va a lo alto de la celda (1024), su alto a lo ancho (256).
        const long = ATLAS_H * 0.96;
        const short = Math.min(ATLAS_W - LOGO_X, long * (img.height / img.width));
        c.imageSmoothingEnabled = true;
        c.imageSmoothingQuality = 'high';
        c.drawImage(img, (ATLAS_H - long) / 2, (ATLAS_W - LOGO_X - short) / 2, long, short);
        c.restore();
        resolve();
      };
      img.onerror = () => resolve();
      img.src = jamisLogoUrl;
    });
  }
}
