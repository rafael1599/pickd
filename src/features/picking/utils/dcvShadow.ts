/**
 * La sombra del lector en Double Check, en funciones puras: qué se guarda de
 * una lectura y de la orden, y si la foto entra en la muestra.
 *
 * La sombra lee cada foto de pallet en segundo plano y guarda el resultado en
 * `dcv_shadow_runs` **sin enseñarle nada al picker**
 * (`docs/label-recognition/09-plan-de-evaluacion.md`, etapa 8 y E4). Lo que
 * vive aquí decide la forma de cada fila; quien la sube está en
 * `api/dcvShadow.ts`.
 */
import type { MultiBoxClientResult } from '../../../lib/recognition/recognizeMultiBoxClient';
import { unmapBoxFromRotation } from '../../../lib/recognition/overlayBoxes';

/** Una caja tal como la leyó el motor. `bbox` en píxeles de la foto ORIGINAL. */
export interface ShadowBox {
  sku: string | null;
  /** Por qué canal salió el SKU: la cadena de procedencia del motor, tal cual. */
  source: string;
  channel: 'barcode' | 'qr' | 'ocr' | 'none';
  /** Media de la confianza del OCR sobre los textos de la etiqueta. */
  confidence: number | null;
  bbox: { x: number; y: number; w: number; h: number } | null;
  model: string | null;
  size: string | null;
  color: string | null;
  upc: string | null;
  gtin: string | null;
  barcodes: number;
}

/** Una línea del grupo en el instante de la foto. */
export interface ShadowGroupLine {
  list_id: string | null;
  sku: string;
  qty: number;
}

export interface ShadowFlag {
  enabled: boolean;
  sampleRate: number;
  timeoutMs: number;
  queueMax: number;
  uploadR2000: boolean;
  /** Si trae ids, sólo esos usuarios corren la sombra (encenderla en uno primero). */
  onlyUsers: string[] | null;
}

export const SHADOW_FLAG_OFF: ShadowFlag = {
  enabled: false,
  sampleRate: 0,
  timeoutMs: 60_000,
  queueMax: 3,
  uploadR2000: true,
  onlyUsers: null,
};

/** Lado largo de la copia `r2000/`: lo que el detector y el recortador ya usan. */
export const R2000_MAX_SIDE = 2000;

const num = (v: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/**
 * La fila de `app_flags` → la configuración. Una fila ausente, rota o apagada
 * es la sombra apagada: nunca se enciende por un valor que no se entiende.
 */
export function parseShadowFlag(
  row: { enabled?: unknown; config?: unknown } | null | undefined
): ShadowFlag {
  if (!row || row.enabled !== true) return SHADOW_FLAG_OFF;
  const c = (row.config && typeof row.config === 'object' ? row.config : {}) as Record<
    string,
    unknown
  >;
  return {
    enabled: true,
    sampleRate: num(c.sample_rate, 0, 0, 1),
    timeoutMs: num(c.timeout_ms, 60_000, 5_000, 300_000),
    queueMax: Math.round(num(c.queue_max, 3, 0, 10)),
    uploadR2000: c.upload_r2000 !== false,
    onlyUsers: Array.isArray(c.only_users)
      ? c.only_users.filter((u): u is string => typeof u === 'string' && u.length > 0)
      : null,
  };
}

/**
 * ¿Corre la sombra para este usuario? Encendida y, si `only_users` trae ids,
 * sólo para ellos. Una lista vacía no es «todos»: es nadie, porque vaciar la
 * lista es la forma natural de sacar al último y no debe encenderla en toda la
 * bodega.
 */
export function shadowRunsFor(flag: ShadowFlag, userId: string | null | undefined): boolean {
  if (!flag.enabled) return false;
  if (flag.onlyUsers === null) return true;
  return !!userId && flag.onlyUsers.includes(userId);
}

/**
 * ¿Entra esta foto en la muestra que se adjudica? Una tirada **por foto** —no
 * por dispositivo ni por usuario—, para que la muestra de cada semana se
 * parezca a todas las fotos (E4).
 */
export function decideSampled(sampleRate: number, random: () => number = Math.random): boolean {
  return sampleRate > 0 && random() < sampleRate;
}

export function skuChannel(source: string): ShadowBox['channel'] {
  const s = source.toLowerCase();
  if (s.startsWith('factory_qr') || s.includes('qrcode')) return 'qr';
  if (s.startsWith('barcode') || s.startsWith('code')) return 'barcode';
  if (s.startsWith('ocr')) return 'ocr';
  return 'none';
}

/**
 * Las cajas del motor → lo que se guarda. Sólo campos de la etiqueta de la
 * caja (SKU, modelo, talla, color, UPC/GTIN): **nunca el texto crudo del OCR**,
 * que en una foto con guía de FedEx trae nombre y dirección del cliente.
 */
export function toShadowBoxes(result: MultiBoxClientResult): ShadowBox[] {
  const { width, height, rotationUsed } = result.image;
  return result.boxes.map((box) => {
    let bbox: ShadowBox['bbox'] = null;
    if (width && height) {
      const b = unmapBoxFromRotation(box.bbox, rotationUsed ?? 0, width, height);
      bbox = {
        x: Math.round(b.x),
        y: Math.round(b.y),
        w: Math.round(b.width),
        h: Math.round(b.height),
      };
    }
    const confs = box.rawCluster.items
      .map((i) => i.confidence)
      .filter((c): c is number => typeof c === 'number' && Number.isFinite(c));
    return {
      sku: box.sku.photoValue,
      source: box.sku.source,
      channel: box.sku.photoValue ? skuChannel(box.sku.source) : 'none',
      confidence: confs.length
        ? Math.round((confs.reduce((a, c) => a + c, 0) / confs.length) * 1000) / 1000
        : null,
      bbox,
      model: box.model.photoValue,
      size: box.size.photoValue,
      color: box.color.photoValue,
      upc: box.upc.value,
      gtin: box.gtin.value,
      barcodes: box.barcodeCount,
    };
  });
}

/**
 * Las líneas del carrito en el instante de la foto, sumadas por orden y SKU.
 * Un carrito combinado trae las de todas las hermanas (`source_list_id`); sin
 * él, la línea es de la orden abierta. Guardarlas en la fila es lo que deja
 * comparar después sin depender de cómo cambie la orden.
 */
export function groupLinesSnapshot(
  items: ReadonlyArray<{ sku: string; pickingQty?: number | null; source_list_id?: string | null }>,
  activeListId: string | null
): ShadowGroupLine[] {
  const byKey = new Map<string, ShadowGroupLine>();
  for (const item of items) {
    if (!item.sku) continue;
    const listId = item.source_list_id ?? activeListId;
    const key = `${listId ?? ''}\u0000${item.sku}`;
    const qty = Number(item.pickingQty) || 0;
    const prev = byKey.get(key);
    if (prev) prev.qty += qty;
    else byKey.set(key, { list_id: listId, sku: item.sku, qty });
  }
  return [...byKey.values()];
}

/** Quién leyó: lo que el navegador dice de sí mismo, sin pedir permiso. */
export interface ShadowDevice {
  label: string;
  ua: string;
  memory_gb: number | null;
  cores: number | null;
}

interface NavigatorWithHints {
  userAgent: string;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  userAgentData?: {
    platform?: string;
    getHighEntropyValues?: (hints: string[]) => Promise<{ model?: string; platform?: string }>;
  };
}

/** `SM-S938U` en Chrome Android (User-Agent Client Hints); si no, la plataforma. */
export async function describeDevice(nav: NavigatorWithHints): Promise<ShadowDevice> {
  let model: string | undefined;
  let platform = nav.userAgentData?.platform;
  try {
    const hints = await nav.userAgentData?.getHighEntropyValues?.(['model', 'platform']);
    model = hints?.model || undefined;
    platform = hints?.platform || platform;
  } catch {
    // Sin hints: nos quedamos con el UA.
  }
  const fromUa = /\(([^;)]+);/.exec(nav.userAgent)?.[1];
  return {
    label: model || platform || fromUa || 'unknown',
    ua: nav.userAgent,
    memory_gb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    cores: typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null,
  };
}
