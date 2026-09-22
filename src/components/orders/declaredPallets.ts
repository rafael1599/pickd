/**
 * El pallet como lo pide el portal del carrier: cuántos, cuánto miden, cuánto
 * pesan — en la lengua de los cuatro números de Ship.
 *
 * Hermano exacto de `electricCartons.ts`: aquél declara la bici a batería como
 * cartón aparte, éste declara el bulto sobre el que viaja. Los dos se declaran,
 * y por eso la eléctrica se le resta al pallet — o la carga se cuenta dos veces
 * (`docs/prds/ship-pallet-dimensions.md`).
 *
 * **Ship rehace el reparto con las mismas funciones puras que Double Check**
 * (`calculatePalletsWithBikeAwareness` sobre las mismas líneas en el mismo
 * orden), en vez de leer una geometría guardada. Una derivación guardada
 * envejece en silencio cuando la orden se corrige; ésta se recalcula sola. Lo
 * único que se guarda es lo que un humano tecleó, que es lo que no se puede
 * derivar de nada.
 */
import {
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
  /** Cajas declaradas: las unidades del pallet menos las eléctricas. */
  boxes: number;
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

export function buildPalletDeclaration(
  pallets: readonly PalletForDeclaration[],
  entries: readonly PalletDimsEntry[],
  metaFor: (sku: string) => PalletBoxMeta | undefined,
  /** Unidades de bici de niño en la carga — ver `kidsBikesNeedTape`. */
  kidsUnits = 0
): DeclaredPallet[] {
  const tape = kidsBikesNeedTape(kidsUnits);
  const built: {
    pallet: number;
    estimate: NonNullable<ReturnType<typeof estimatePallet>>;
    isKids: boolean;
  }[] = [];
  for (const pallet of pallets) {
    const isKids = pallet.containerKind === 'smallBikes';
    // La caja de partes no es un bulto de LTL. El de las bicis de niño sí lo es
    // —pesa y ocupa su propia tarima—, pero sólo se abre como fila propia
    // pasadas dos: una o dos caben en un hueco del pallet de al lado sin mover
    // nada. Se recogen al final (ROW 42), así que su bulto queda el último.
    if (pallet.isParts && !isKids) continue;
    if (isKids && !tape) continue;
    const estimate = estimatePallet(pallet.items, metaFor);
    if (estimate) built.push({ pallet: pallet.id, estimate, isKids });
  }

  return built.map(({ pallet, estimate, isKids }) => {
    // El montón que arma el picker a ojo es el de las de niño, y sólo ése: los
    // pallets de bicis grandes vuelven a ser calculables en cuanto las juveniles
    // tienen su propio sitio.
    const needsTape = isKids;
    const entry = entries.find((e) => e.pallet === pallet);
    return {
      pallet,
      size: effectivePalletSize(entry, estimate, estimate.boxes, !needsTape),
      needsTape,
      isKids,
      boxes: estimate.boxes,
      weightLbs: estimate.weightLbs,
      unmeasured: estimate.unmeasured,
    };
  });
}

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
