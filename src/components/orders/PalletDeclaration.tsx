/**
 * El bulto que sale por la puerta, en la lengua de los cuatro números.
 *
 * Audit Source cotiza una carga regular por bultos: cuántos pallets, cuánto
 * pesan y —en LTL— cuánto miden. Las medidas las teclea el operador en Double
 * Check con el pallet delante; lo que no teclea sale del armado real. Aquí sólo
 * se leen y se copian.
 *
 * Mismo sitio y misma gramática que `ElectricCartonDeclaration`, que va debajo:
 * cifra grande + etiqueta corta, una talla menos que los cuatro números para que
 * ésos sigan siendo los más fuertes, y sin partir de línea nunca
 * (`useFitFontSize`). Los dos bloques se quedan — declaran cosas distintas.
 *
 * Ámbar es «esto todavía no lo ha visto una cinta métrica»: cajas sin medir, o
 * una medida tomada cuando el pallet tenía otras unidades. Se dice, no se
 * esconde.
 */
import { useRef } from 'react';
import { CopyButton } from '../ui/CopyButton';
import {
  allSameSize,
  palletClipboard,
  totalDeclaredWeight,
  type DeclaredPallet,
} from './declaredPallets';
import { formatPalletSize } from '../../utils/palletDims';
import { useFitFontSize } from './useFitFontSize';

interface PalletDeclarationProps {
  pallets: DeclaredPallet[];
  /** True mientras la orden no está enviada — el punto late. */
  pulse: boolean;
  /**
   * El número de Pallets de arriba, que **teclea la estación**: es quien armó la
   * carga, así que cuando no coincide con el reparto calculado manda él. Medido
   * en prod (3 meses, 184 órdenes sueltas): 172 coinciden y **12 no, siempre con
   * el tecleado por encima** — «armamos 3» contra una aritmética que dice 1. Lo
   * que no puede pasar es que la tarjeta diga dos cosas distintas sin avisar, así
   * que se dice. Nunca se inventa una fila para cuadrar.
   */
  palletsQty?: number | null;
}

const Figure: React.FC<{
  value: string | number;
  label: string;
  title?: string;
  amber?: boolean;
  small?: boolean;
}> = ({ value, label, title, amber = false, small = false }) => (
  <div className="flex flex-col gap-1 min-w-0 shrink-0" title={title}>
    <span
      data-fit-figure
      style={{ fontSize: small ? 'calc(var(--stat-size) * 0.66)' : 'var(--stat-size)' }}
      className={`font-heading font-bold leading-none whitespace-nowrap ${
        amber ? 'text-amber-500' : 'text-[#22c55e]'
      }`}
    >
      {value}
    </span>
    <span className="text-[10px] font-black uppercase tracking-widest text-muted whitespace-nowrap">
      {label}
    </span>
  </div>
);

const PalletRow: React.FC<{
  /** Cuántos pallets representa esta fila: >1 cuando todos miden igual. */
  count: number;
  declared: DeclaredPallet;
  /** Lo que se copia — la fila colapsada copia la orden entera. */
  clipboard: string;
}> = ({ count, declared, clipboard }) => {
  const rowRef = useRef<HTMLDivElement>(null);
  const dims = declared.size;
  const size = useFitFontSize(rowRef, 48, 22, [
    count,
    dims?.length,
    dims?.width,
    dims?.height,
    declared.weightLbs,
  ]);
  const unmeasured = declared.unmeasured > 0;
  const estimated = dims != null && dims.source !== 'manual';

  return (
    <div
      ref={rowRef}
      style={{ ['--stat-size' as string]: `${size}px` }}
      className="flex flex-nowrap items-end gap-x-4 w-full"
    >
      <Figure
        value={count}
        label={
          count > 1 ? 'Pallets' : declared.isKids ? 'Kids pallet' : `Pallet ${declared.pallet}`
        }
        title={
          count > 1
            ? 'Same size, every one of them'
            : declared.isKids
              ? 'Kids bikes: their own pallet, picked last off ROW 42'
              : undefined
        }
      />
      <Figure
        value={dims ? formatPalletSize(dims) : '?'}
        label={dims ? 'In' : 'Measure it'}
        small
        amber={dims == null || dims.stale}
        title={
          dims == null
            ? 'Kids bikes ride on this one and the picker stacks them by hand — measure it in Double Check'
            : dims.stale
              ? 'Measured when the pallet had a different box count — measure again or leave it'
              : estimated
                ? 'Computed from the build (L × W × H, whole inches rounded up)'
                : 'Measured in Double Check'
        }
      />
      <Figure
        value={Math.round(declared.weightLbs)}
        label={count === 1 ? 'Lbs' : 'Lbs each'}
        title="Las cajas más 40 lb de tarima"
      />
      <Figure
        value={declared.boxes}
        label={count === 1 ? 'Boxes' : 'Boxes each'}
        amber={unmeasured}
        title={
          unmeasured
            ? `${declared.unmeasured} de ${declared.boxes} sin medir — la medida es una estimación`
            : undefined
        }
      />
      <div className="pb-4 shrink-0">
        <CopyButton value={clipboard} label={`Pallet ${declared.pallet}`} />
      </div>
    </div>
  );
};

export const PalletDeclaration: React.FC<PalletDeclarationProps> = ({
  pallets,
  pulse,
  palletsQty,
}) => {
  if (pallets.length === 0) return null;

  // Todos iguales es el caso normal — las mismas bicis en el mismo armado — y
  // tres filas idénticas no dicen nada que no diga una.
  const collapsed = allSameSize(pallets);
  const clipboard = palletClipboard(pallets);
  const total = Math.round(totalDeclaredWeight(pallets));

  return (
    <div
      role="note"
      className="w-full pt-4 border-t border-dashed border-subtle flex flex-col gap-4"
    >
      <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[#22c55e]">
        <span className="relative flex shrink-0 h-2 w-2">
          {pulse && (
            <span className="absolute inline-flex h-full w-full rounded-full bg-[#22c55e] opacity-75 motion-safe:animate-ping" />
          )}
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[#22c55e]" />
        </span>
        Pallet — size
        {pallets.length > 1 && (
          <span className="text-muted normal-case tracking-normal font-bold">
            · {total} lbs total
          </span>
        )}
        {palletsQty != null && palletsQty > 0 && palletsQty !== pallets.length && (
          <span
            className="text-amber-500 normal-case tracking-normal font-bold"
            title="Pallets is typed at the station by whoever built the load, and it wins. This block shows the computed split of the lines."
          >
            · Pallets says {palletsQty}
          </span>
        )}
      </span>

      {collapsed ? (
        <PalletRow count={pallets.length} declared={pallets[0]} clipboard={clipboard} />
      ) : (
        pallets.map((declared) => (
          <PalletRow
            key={declared.pallet}
            count={1}
            declared={declared}
            clipboard={pallets.length === 1 ? clipboard : palletClipboard([declared])}
          />
        ))
      )}
    </div>
  );
};
