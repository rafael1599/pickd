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
  size: EffectivePalletSize;
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
  metaFor: (sku: string) => PalletBoxMeta | undefined
): DeclaredPallet[] {
  const declared: DeclaredPallet[] = [];
  for (const pallet of pallets) {
    // Un contenedor de partes o de bicis pequeñas no es un bulto de LTL.
    if (pallet.isParts) continue;
    const estimate = estimatePallet(pallet.items, metaFor);
    if (!estimate) continue;
    const entry = entries.find((e) => e.pallet === pallet.id);
    const size = effectivePalletSize(entry, estimate, estimate.boxes);
    if (!size) continue;
    declared.push({
      pallet: pallet.id,
      size,
      boxes: estimate.boxes,
      weightLbs: estimate.weightLbs,
      unmeasured: estimate.unmeasured,
    });
  }
  return declared;
}

const sameSize = (a: EffectivePalletSize, b: EffectivePalletSize): boolean =>
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
export function palletClipboard(declared: readonly DeclaredPallet[]): string {
  if (declared.length === 0) return '';
  const total = Math.round(totalDeclaredWeight(declared));
  if (allSameSize(declared)) {
    const each = Math.round(declared[0].weightLbs);
    return `${declared.length} pallets, ${palletSizeForClipboard(declared[0].size)} in, ${each} lbs each, ${total} lbs total`;
  }
  if (declared.length === 1) {
    return `1 pallet, ${palletSizeForClipboard(declared[0].size)} in, ${total} lbs`;
  }
  return declared
    .map(
      (d) =>
        `pallet ${d.pallet}, ${palletSizeForClipboard(d.size)} in, ${Math.round(d.weightLbs)} lbs`
    )
    .join('\n');
}
