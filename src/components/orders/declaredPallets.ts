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
  /** Este bulto lleva las bicis de niño encima y se mide con la cinta. */
  needsTape: boolean;
  /** Cajas declaradas: las unidades del pallet menos las eléctricas. */
  boxes: number;
  weightLbs: number;
  /** Cuántas de esas cajas nadie ha medido. */
  unmeasured: number;
}

/** Un pallet tal como lo reparte `calculatePalletsWithBikeAwareness`. */
export interface PalletForDeclaration {
  id: number;
  isParts?: boolean;
  items: PalletLine[];
}

export function buildPalletDeclaration(
  pallets: readonly PalletForDeclaration[],
  entries: readonly PalletDimsEntry[],
  metaFor: (sku: string) => PalletBoxMeta | undefined,
  /** Unidades de bici de niño en la carga — ver `kidsBikesNeedTape`. */
  kidsUnits = 0
): DeclaredPallet[] {
  const built: { pallet: number; estimate: NonNullable<ReturnType<typeof estimatePallet>> }[] = [];
  for (const pallet of pallets) {
    // Un contenedor de partes o de bicis pequeñas no es un bulto de LTL.
    if (pallet.isParts) continue;
    const estimate = estimatePallet(pallet.items, metaFor);
    if (estimate) built.push({ pallet: pallet.id, estimate });
  }

  // Las de niño se recogen al final (ROW 42), así que van en el último bulto —
  // y a ése lo arma el picker a ojo. El último, no el primero.
  const tapeOn = kidsBikesNeedTape(kidsUnits) && built.length > 0 ? built.length - 1 : -1;

  return built.map(({ pallet, estimate }, i) => {
    const needsTape = i === tapeOn;
    const entry = entries.find((e) => e.pallet === pallet);
    return {
      pallet,
      size: effectivePalletSize(entry, estimate, estimate.boxes, !needsTape),
      needsTape,
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
    .map((d) => `pallet ${d.pallet}, ${sizeText(d)}, ${Math.round(d.weightLbs)} lbs`)
    .join('\n');
}
