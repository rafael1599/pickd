/**
 * El pallet como lo pide el portal del carrier: cuántos, cuánto miden, cuánto
 * pesan — en la lengua de los cuatro números de Ship.
 *
 * Hermano exacto de `electricCartons.ts`: aquél declara la bici a batería como
 * cartón aparte, éste declara el bulto sobre el que viaja. Los dos se declaran,
 * y por eso al pallet se le resta el peso de la eléctrica — no su caja ni su
 * cuenta, que viajan dentro — o la carga pesa dos veces
 * (`docs/prds/ship-pallet-dimensions.md`).
 *
 * **Ship rehace el reparto con las mismas funciones puras que Double Check**
 * (`calculatePalletsWithBikeAwareness` sobre las mismas líneas en el mismo
 * orden), en vez de leer una geometría guardada. Una derivación guardada
 * envejece en silencio cuando la orden se corrige; ésta se recalcula sola. Lo
 * único que se guarda es lo que un humano tecleó, que es lo que no se puede
 * derivar de nada.
 *
 * ## Las partes también viajan encima (22 sep 2026)
 *
 * Hasta hoy una caja de partes no entraba en ninguna fila: el contenedor de
 * partes se saltaba entero, así que su peso no se declaraba y Σ(filas) no
 * cuadraba con el `WEIGHT` de arriba. Medido en prod: **#881517 declaraba 465
 * lbs contra 558** — 92 libras que la báscula del carrier sí ve —, y las 30
 * órdenes de camión de tres meses **sin una sola bici** no enseñaban nada
 * (#881220: 2 pallets y 561 lbs de partes, tabla vacía).
 *
 * Así que una parte **se sube a un bulto**: el operador dice a cuál, y lo que no
 * reparta viaja en el último — que es donde acaba la caja cuando nadie decide.
 */
import {
  DECK_WEIGHT_LBS,
  effectivePalletSize,
  estimatePallet,
  kidsBikesNeedTape,
  palletSizeForClipboard,
  type EffectivePalletSize,
  type PalletBoxMeta,
  type PalletDimsEntry,
  type PalletLine,
} from '../../utils/palletDims';

/** Un pallet listo para declarar. */
export interface DeclaredPallet {
  /** Ordinal dentro de la orden, 1-based — el mismo que enseña Double Check. */
  pallet: number;
  /** `null` cuando hay que medirlo y nadie lo ha medido: se declara como `?`. */
  size: EffectivePalletSize | null;
  /** Este bulto son las bicis de niño: lo arma el picker y se mide con la cinta. */
  needsTape: boolean;
  /** Cajas apiladas en el bulto, eléctricas incluidas — lo que le da su forma. */
  boxes: number;
  /** Lo que se declara como bicis: todas las cajas, eléctricas incluidas. */
  bikes: number;
  /** Unidades de parte que viajan encima de este bulto. */
  parts: number;
  /** `true` cuando ese número lo tecleó alguien; `false` = reparto por defecto. */
  partsTyped: boolean;
  /** Bicis + tarima + las partes que lleva encima. */
  weightLbs: number;
  /** Cuántas de esas cajas nadie ha medido. */
  unmeasured: number;
  /** El bulto de las bicis de niño, que se nombra aparte en la fila. */
  isKids: boolean;
}

/** Un pallet tal como lo reparte `calculatePalletsWithBikeAwareness`. */
export interface PalletForDeclaration {
  id: number;
  isParts?: boolean;
  /** `'smallBikes'` es el bulto de las bicis de niño; `'parts'`, la caja de partes. */
  containerKind?: 'parts' | 'smallBikes';
  items: PalletLine[];
}

/** Lo que la orden sabe de sí misma y la geometría no puede deducir. */
export interface DeclarationContext {
  /** Unidades de bici de niño en la carga — ver `kidsBikesNeedTape`. */
  kidsUnits?: number;
  /** Unidades de parte de la orden: el mismo número que enseña `PARTS`. */
  partUnits?: number;
  /** Lo que pesa de media una unidad de parte aquí — la media de `totalWeight`. */
  partUnitWeight?: number;
  /**
   * Lo que la estación tecleó en `Pallets`. **Sólo se usa cuando no hay ni una
   * bici**: ahí PickD no tiene geometría de la que sacar filas y el único que
   * sabe cuántas tarimas salen es quien armó la carga. Con bicis manda el
   * reparto calculado y un desacuerdo se dice en ámbar — nunca se inventa una
   * fila para cuadrar.
   */
  palletsQty?: number | null;
}

/** Una fila antes de repartirle las partes. */
interface RawRow {
  pallet: number;
  estimate: ReturnType<typeof estimatePallet>;
  isKids: boolean;
}

/**
 * Cuántas unidades de parte lleva cada fila.
 *
 * Lo tecleado manda. Lo que quede sin repartir viaja en **el último bulto que no
 * sea el de las de niño** — ése lo arma el picker a ojo y cargarle cajas que
 * nadie le puso sería inventar. Si alguien ya tecleó esa fila, el resto no se le
 * suma por detrás: se queda sin repartir y la cabecera lo dice.
 */
function distributeParts(
  rows: readonly RawRow[],
  entries: readonly PalletDimsEntry[],
  partUnits: number
): { parts: number; partsTyped: boolean }[] {
  const typed = rows.map((row) => {
    const value = entries.find((e) => e.pallet === row.pallet)?.parts;
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? Math.floor(value)
      : null;
  });
  const assigned = typed.reduce((sum: number, value) => sum + (value ?? 0), 0);
  const remainder = partUnits - assigned;

  let home = rows.length - 1;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (!rows[i].isKids) {
      home = i;
      break;
    }
  }

  return rows.map((_, i) => ({
    parts: (typed[i] ?? 0) + (i === home && typed[i] == null && remainder > 0 ? remainder : 0),
    partsTyped: typed[i] != null,
  }));
}

export function buildPalletDeclaration(
  pallets: readonly PalletForDeclaration[],
  entries: readonly PalletDimsEntry[],
  metaFor: (sku: string) => PalletBoxMeta | undefined,
  context: DeclarationContext = {}
): DeclaredPallet[] {
  const { kidsUnits = 0, partUnits = 0, partUnitWeight = 0, palletsQty = null } = context;
  const tape = kidsBikesNeedTape(kidsUnits);
  const built: RawRow[] = [];
  for (const pallet of pallets) {
    const isKids = pallet.containerKind === 'smallBikes';
    // La caja de partes no es un bulto de LTL: viaja encima de uno, y eso lo
    // reparte `distributeParts`. El de las bicis de niño sí lo es —pesa y ocupa
    // su propia tarima—, pero sólo se abre como fila propia pasadas dos: una o
    // dos caben en un hueco del pallet de al lado sin mover nada. Se recogen al
    // final (ROW 42), así que su bulto queda el último.
    if (pallet.isParts && !isKids) continue;
    if (isKids && !tape) continue;
    const estimate = estimatePallet(pallet.items, metaFor);
    if (estimate) built.push({ pallet: pallet.id, estimate, isKids });
  }

  /**
   * Una carga de puras partes también sale en tarimas, y hasta hoy no se
   * declaraba ninguna. Sin bicis no hay geometría que calcular, así que las
   * filas salen de lo que tecleó la estación —una si no tecleó nada— y sus tres
   * medidas nacen vacías, listas para la cinta.
   */
  if (built.length === 0 && partUnits > 0) {
    const rows = Math.max(1, Math.floor(palletsQty ?? 1) || 1);
    for (let i = 1; i <= rows; i += 1) built.push({ pallet: i, estimate: null, isKids: false });
  }

  const spread = distributeParts(built, entries, partUnits);

  return built.map(({ pallet, estimate, isKids }, i) => {
    // El montón que arma el picker a ojo es el de las de niño, y sólo ése: los
    // pallets de bicis grandes vuelven a ser calculables en cuanto las juveniles
    // tienen su propio sitio.
    const needsTape = isKids;
    const entry = entries.find((e) => e.pallet === pallet);
    const { parts, partsTyped } = spread[i];
    return {
      pallet,
      size: effectivePalletSize(entry, estimate, estimate?.boxes ?? 0, !needsTape),
      needsTape,
      isKids,
      boxes: estimate?.boxes ?? 0,
      bikes: estimate?.bikes ?? 0,
      parts,
      partsTyped,
      weightLbs: (estimate?.weightLbs ?? DECK_WEIGHT_LBS) + parts * partUnitWeight,
      unmeasured: estimate?.unmeasured ?? 0,
    };
  });
}

/**
 * Lo que falta por repartir: `0` es lo normal, positivo son partes que no van en
 * ningún bulto y negativo son más de las que la orden tiene. Sólo puede pasar
 * cuando alguien teclea a mano, y entonces la cabecera lo dice en ámbar en vez
 * de corregirlo por su cuenta.
 */
export const partsBalance = (declared: readonly DeclaredPallet[], partUnits: number): number =>
  partUnits - declared.reduce((sum, d) => sum + d.parts, 0);

const sameSize = (a: EffectivePalletSize | null, b: EffectivePalletSize | null): boolean =>
  a != null &&
  b != null &&
  Math.ceil(a.length) === Math.ceil(b.length) &&
  Math.ceil(a.width) === Math.ceil(b.width) &&
  Math.ceil(a.height) === Math.ceil(b.height);

/**
 * True cuando todos los pallets miden lo mismo — el caso normal, las mismas
 * bicis en el mismo armado. Entonces se dicen en una línea en vez de en tres.
 */
export function allSameSize(declared: readonly DeclaredPallet[]): boolean {
  return declared.length > 1 && declared.every((d) => sameSize(d.size, declared[0].size));
}

export const totalDeclaredWeight = (declared: readonly DeclaredPallet[]): number =>
  declared.reduce((sum, d) => sum + d.weightLbs, 0);

/**
 * Lo que se pega en el portal. `x` ASCII y pulgadas enteras redondeadas hacia
 * arriba: el portal es un campo de texto ajeno y un bulto nunca se declara más
 * chico de lo que es.
 */
/** `55x43x83 in`, o `size ?` cuando falta medirlo — nunca se calla. */
const sizeText = (d: DeclaredPallet): string =>
  d.size ? `${palletSizeForClipboard(d.size)} in` : 'size ?';

export function palletClipboard(declared: readonly DeclaredPallet[]): string {
  if (declared.length === 0) return '';
  const total = Math.round(totalDeclaredWeight(declared));
  if (allSameSize(declared)) {
    const each = Math.round(declared[0].weightLbs);
    return `${declared.length} pallets, ${sizeText(declared[0])}, ${each} lbs each, ${total} lbs total`;
  }
  if (declared.length === 1) {
    return `1 pallet, ${sizeText(declared[0])}, ${total} lbs`;
  }
  return declared
    .map(
      (d) =>
        `${d.isKids ? 'kids pallet' : `pallet ${d.pallet}`}, ${sizeText(d)}, ${Math.round(d.weightLbs)} lbs`
    )
    .join('\n');
}
