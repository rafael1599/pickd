/**
 * Lo que se saca de una foto de pallet leída, sin pantalla (idea-247 F0,
 * `docs/prds/pick-pallet-by-pallet.md`).
 *
 * Rafael, 6 oct 2026: «el posprocesamiento de la foto para extraer la
 * información necesaria para ordenar las pallets, identificar las bicicletas
 * que sí van o no van en esa orden, etc. debe continuar en el background
 * aunque el usuario ya no esté en la misma orden». Hasta ese día esto vivía
 * dentro de Double Check y se tiraba al cambiar de orden.
 *
 * Dos resultados, los dos sólo con SKUs (nunca texto de la etiqueta):
 *
 * - **Alertas**: un SKU leído que no es de la orden. Si se parece a una línea
 *   que sí es (`lookalikeSkus.ts`), es `wrong_pick` —casi seguro esa línea se
 *   recogió mal (#881828: 2 × 03-4547MN por 03-4537GY)—; si no, `not_in_order`.
 * - **Frente**: si la foto ubicó ≥ 4 etiquetas, de qué tarima es y cómo queda
 *   (`frontRead` + `frontPallet` + `applyFront`), contra las tarimas **como
 *   estaban al tomar la foto** (`snapshot`). Guardarlo en la tarima lo hace
 *   Double Check al abrir la orden, nunca nadie que no la está mirando.
 */
import { photoSuspects } from '../utils/lookalikeSkus';
import type { ShadowBox } from '../utils/dcvShadow';
import { readFront, type FrontBox } from '../pallets/frontRead';
import { applyFront, frontPallet, type FrontCase } from '../pallets/frontApply';
import type { PalletUnit } from '../pallets/palletUnits';

/** Sólo lo que tiene forma de SKU de Jamis: ni «CONFLICTO: …» ni texto suelto. */
const SKU_SHAPE = /^\d{2}-\d{4}[A-Z]*$/;

const readSku = (b: Pick<ShadowBox, 'sku' | 'resolved_sku'>): string | null => {
  const s = (b.resolved_sku ?? b.sku ?? '').trim().toUpperCase();
  return SKU_SHAPE.test(s) ? s : null;
};

export interface PhotoAlert {
  kind: 'wrong_pick' | 'not_in_order';
  /** Lo que leyó la foto. */
  sku: string;
  count: number;
  /** `wrong_pick`: la línea de la orden a la que se parece. */
  orderSku?: string;
  /** Los caracteres de `orderSku` que los distinguen. */
  positions?: number[];
}

export function photoAlerts(
  boxes: readonly Pick<ShadowBox, 'sku' | 'resolved_sku'>[],
  orderSkus: readonly string[]
): PhotoAlert[] {
  const reads = boxes.map(readSku).filter((s): s is string => !!s);
  const order = new Set(orderSkus.map((s) => s.trim().toUpperCase()));
  const suspects = photoSuspects(reads, orderSkus);
  const out: PhotoAlert[] = [];
  const explained = new Set<string>();
  for (const [orderSku, list] of suspects) {
    for (const s of list) {
      out.push({
        kind: 'wrong_pick',
        sku: s.readSku,
        count: s.count,
        orderSku,
        positions: s.positions,
      });
      explained.add(s.readSku);
    }
  }
  const counts = new Map<string, number>();
  for (const s of reads) if (!order.has(s)) counts.set(s, (counts.get(s) ?? 0) + 1);
  for (const [sku, count] of counts) {
    if (!explained.has(sku)) out.push({ kind: 'not_in_order', sku, count });
  }
  return out;
}

export interface FrontSummary {
  case: FrontCase;
  pallet: number | null;
  candidates: number[];
  boxes: FrontBox[];
  moved: { sku: string; fromLabel: string }[];
  missing: { sku: string; location: string | null }[];
  notInOrder: string[];
  fitRmsIn: number | null;
}

/** El frente de la foto contra las tarimas de cuando se tomó, o `null` si no es un frente. */
export function frontSummary(
  boxes: readonly ShadowBox[],
  snapshot: readonly PalletUnit[]
): FrontSummary | null {
  const read = readFront(boxes.map((b) => ({ sku: b.resolved_sku ?? b.sku, corners: b.corners })));
  if (!read.isFront) return null;
  const where = frontPallet(read.boxes, snapshot);
  const applied = where.pallet != null ? applyFront(where.pallet, read.boxes, snapshot) : null;
  const own = new Set(snapshot.map((u) => u.sku));
  return {
    case: where.case,
    pallet: where.pallet,
    candidates: where.candidates,
    boxes: read.boxes,
    moved: applied?.moved ?? [],
    missing: applied?.missing ?? [],
    notInOrder: read.boxes.filter((b) => !own.has(b.sku)).map((b) => b.sku),
    fitRmsIn: read.fitRmsIn,
  };
}
