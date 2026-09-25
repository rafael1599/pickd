/**
 * Los bultos que salen por la puerta, como una tabla de cifras.
 *
 * Audit Source cotiza una carga regular por bultos: cuántos, cuánto pesan y
 * —en LTL— cuánto miden. Esto es lo que la estación lee y teclea allí.
 *
 * ## Una cabecera, no una etiqueta por fila (Rafael, 22 sep 2026)
 *
 * «arriba de cada dato ya tiene un título y además están color coded, ya no se
 * tiene que repetir en cada línea». Así que los títulos van una vez y **cada
 * columna hereda el color del número que tiene justo encima**, para que el ojo
 * las empareje sin leyenda: `#` verde como PALLETS, `bikes` azul como BIKES,
 * `parts` naranja como PARTS, `lbs` morado como WEIGHT. `dims` no tiene pareja
 * arriba y lleva **rose-400**, que es el rojizo que PickD ya usa para hablar de
 * medidas de cartón (`UnratedCartonsBanner`) y que no es el rojo de «esto frena
 * el envío».
 *
 * **Ámbar sigue significando una sola cosa**: esta cifra no la ha visto una
 * cinta — o se midió con otro número de cajas, o detrás hay cartones sin medir.
 *
 * ## Se teclea aquí
 *
 * Donde no hay medida no se pone un `?`: se ponen **las tres casillas vacías**
 * (Rafael, 22 sep 2026), porque el sitio donde alguien se entera de que falta
 * es éste. Una cifra que ya existe se toca para corregirla. Lo tecleado va al
 * mismo `pallet_dims` que escribe Double Check, fusionado por ordinal.
 *
 * La columna `parts` funciona igual: sólo aparece si la orden trae partes, la
 * cifra en claro es la que alguien repartió y la apagada es el reparto por
 * defecto — todo lo que nadie asignó viaja en el último bulto.
 *
 * Sin botón de copiar por fila: uno para el bloque entero.
 */
import React, { useState } from 'react';
import { CopyButton } from '../ui/CopyButton';
import {
  KIDS_SPLIT_MAX,
  palletClipboard,
  partsBalance,
  totalDeclaredWeight,
  type DeclaredPallet,
} from './declaredPallets';
import { formatPalletSize, sanitizeCount, sanitizeInches } from '../../utils/palletDims';

type Axis = 'length_in' | 'width_in' | 'height_in';
const AXES: Axis[] = ['length_in', 'width_in', 'height_in'];

interface PalletDeclarationProps {
  pallets: DeclaredPallet[];
  /** True mientras la orden no está enviada — el punto late. */
  pulse: boolean;
  /**
   * El número de Pallets de arriba, que teclea la estación: es quien armó la
   * carga, así que cuando no coincide con el reparto calculado manda él y el
   * bloque lo dice. Nunca se inventa una fila para cuadrar.
   */
  palletsQty?: number | null;
  /** Las unidades de parte de la orden — el número `Parts` de arriba. */
  partUnits?: number;
  /** Teclear una medida. Sin esto la tabla es de sólo lectura. */
  onDimChange?: (pallet: number, axis: Axis, value: number | null, boxes: number) => void;
  /** Decir cuántas partes viajan en un bulto. `null` vuelve al reparto por defecto. */
  onPartsChange?: (pallet: number, value: number | null, boxes: number) => void;
  /**
   * Cuántas tarimas son las bicis de niño. El picker las arma a ojo y PickD no
   * lo puede calcular, así que la estación lo dice con «+» / «–» en su fila.
   */
  onKidsSplitChange?: (kidsPallet: number, value: number | null, boxes: number) => void;
}

/** Una cifra de la tabla. El valor lleva el color; el título va en la cabecera. */
const Cell: React.FC<{ children: React.ReactNode; className?: string; title?: string }> = ({
  children,
  className = '',
  title,
}) => (
  <div
    title={title}
    className={`font-heading font-bold text-xl leading-none tabular-nums whitespace-nowrap ${className}`}
  >
    {children}
  </div>
);

const Head: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => (
  <div
    className={`text-[10px] font-black uppercase tracking-widest text-muted whitespace-nowrap ${className}`}
  >
    {children}
  </div>
);

/** El estilo de las casillas que se teclean dentro de la tabla. */
const inputClass = (tone: 'rose' | 'orange') =>
  `w-9 rounded-md border bg-card px-0.5 py-1 text-center text-[13px] font-black tabular-nums placeholder:text-muted/40 focus:outline-none disabled:opacity-50 ${
    tone === 'rose'
      ? 'border-rose-500/30 text-rose-400 focus:border-rose-400'
      : 'border-orange-500/30 text-orange-400 focus:border-orange-400'
  }`;

/** Las tres casillas, o la cifra que ya hay — un toque la abre para corregirla. */
const Dims: React.FC<{
  declared: DeclaredPallet;
  editable: boolean;
  open: boolean;
  onOpen: () => void;
  onChange: (axis: Axis, value: number | null) => void;
}> = ({ declared, editable, open, onOpen, onChange }) => {
  const [typing, setTyping] = useState<{ axis: Axis; text: string } | null>(null);
  const size = declared.size;
  const suspect = size?.stale || (size != null && declared.unmeasured > 0);

  if (size && !open) {
    return (
      <Cell
        className={
          suspect
            ? 'text-amber-500'
            : size.source === 'manual'
              ? 'text-rose-400'
              : 'text-rose-400/60'
        }
        title={
          size.stale
            ? `Measured when this pallet had ${declared.boxes === 0 ? 'another' : 'a different'} box count — measure again or leave it`
            : declared.unmeasured > 0
              ? `${declared.unmeasured} of ${declared.boxes} cartons never measured — this is an estimate`
              : size.source === 'manual'
                ? 'Measured here or in Double Check'
                : 'Computed from the build — tap to correct'
        }
      >
        <button
          type="button"
          disabled={!editable}
          onClick={onOpen}
          className="disabled:cursor-default"
        >
          {formatPalletSize(size)}
        </button>
      </Cell>
    );
  }

  const inches = (axis: Axis): number | null =>
    size
      ? Math.ceil(
          axis === 'length_in' ? size.length : axis === 'width_in' ? size.width : size.height
        )
      : null;
  /** El campo lleva lo tecleado; lo calculado va de placeholder, nunca de valor. */
  const saved = (axis: Axis) => {
    const v = inches(axis);
    return v != null && size?.source === 'manual' ? String(v) : '';
  };

  return (
    <div className="flex items-center gap-1">
      {AXES.map((axis, i) => (
        <div key={axis} className="flex items-center gap-1">
          {i > 0 && <span className="text-muted/40 text-[11px] font-bold">×</span>}
          <input
            type="text"
            inputMode="decimal"
            disabled={!editable}
            aria-label={`Pallet ${declared.pallet} ${axis.replace('_in', '')}`}
            value={typing?.axis === axis ? typing.text : saved(axis)}
            placeholder={size && size.source !== 'manual' ? String(inches(axis)) : '–'}
            onChange={(e) => setTyping({ axis, text: e.target.value })}
            onBlur={(e) => {
              const value = sanitizeInches(e.target.value);
              setTyping(null);
              onChange(axis, value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            className={inputClass('rose')}
          />
        </div>
      ))}
    </div>
  );
};

/**
 * Cuántas partes van encima de este bulto. La cifra apagada es el reparto por
 * defecto —lo que nadie asignó viaja en el último—, la encendida la tecleó
 * alguien, y un toque abre la casilla para cambiarla. Vaciarla la devuelve al
 * reparto, que no es lo mismo que teclear un 0.
 */
const Parts: React.FC<{
  declared: DeclaredPallet;
  editable: boolean;
  open: boolean;
  onOpen: () => void;
  onChange: (value: number | null) => void;
}> = ({ declared, editable, open, onOpen, onChange }) => {
  const [text, setText] = useState<string | null>(null);

  if (!open) {
    return (
      <Cell
        className={
          declared.parts === 0
            ? 'text-muted/40'
            : declared.partsTyped
              ? 'text-orange-400'
              : 'text-orange-400/60'
        }
        title={
          declared.partsTyped
            ? 'Someone put these parts on this pallet — tap to change it'
            : 'Parts nobody assigned ride on the last pallet — tap to move them'
        }
      >
        <button
          type="button"
          disabled={!editable}
          onClick={onOpen}
          className="disabled:cursor-default"
        >
          {declared.parts === 0 ? '–' : declared.parts}
        </button>
      </Cell>
    );
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      autoFocus
      disabled={!editable}
      aria-label={`Pallet ${declared.pallet} parts`}
      value={text ?? (declared.partsTyped ? String(declared.parts) : '')}
      placeholder={declared.parts > 0 ? String(declared.parts) : '–'}
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => {
        const value = sanitizeCount(e.target.value);
        setText(null);
        onChange(value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      className={inputClass('orange')}
    />
  );
};

export const PalletDeclaration: React.FC<PalletDeclarationProps> = ({
  pallets,
  pulse,
  palletsQty,
  partUnits = 0,
  onDimChange,
  onPartsChange,
  onKidsSplitChange,
}) => {
  const [openDims, setOpenDims] = useState<number | null>(null);
  const [openParts, setOpenParts] = useState<number | null>(null);
  if (pallets.length === 0) return null;

  const total = Math.round(totalDeclaredWeight(pallets));
  const mismatch = palletsQty != null && palletsQty > 0 && palletsQty !== pallets.length;
  // La columna sólo existe si la orden trae partes (Rafael, 22 sep 2026).
  const showParts = partUnits > 0;
  const unassigned = showParts ? partsBalance(pallets, partUnits) : 0;

  return (
    <div
      role="note"
      className="w-full pt-4 border-t border-dashed border-subtle flex flex-col gap-3"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[#22c55e]">
          <span className="relative flex shrink-0 h-2 w-2">
            {pulse && (
              <span className="absolute inline-flex h-full w-full rounded-full bg-[#22c55e] opacity-75 motion-safe:animate-ping" />
            )}
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#22c55e]" />
          </span>
          Pallet — size
        </span>
        {pallets.length > 1 && (
          <span className="text-[10px] font-bold text-muted">· {total} lbs total</span>
        )}
        {mismatch && (
          <span
            className="text-[10px] font-black uppercase tracking-widest text-amber-500"
            title="Pallets is typed at the station by whoever built the load, and it wins. This table shows the computed split of the lines."
          >
            · Pallets says {palletsQty}
          </span>
        )}
        {unassigned !== 0 && (
          <span
            className="text-[10px] font-black uppercase tracking-widest text-amber-500"
            title="What is typed by hand is respected. These parts are not on any pallet, so their weight is not in any row."
          >
            {unassigned > 0
              ? `· ${unassigned} parts unassigned`
              : `· ${-unassigned} parts too many`}
          </span>
        )}
        <div className="ml-auto">
          <CopyButton value={palletClipboard(pallets)} label="Pallets" />
        </div>
      </div>

      {/* El mismo orden y los mismos colores que los números de arriba, con dims
          intercalada antes del peso porque son las dos que se teclean juntas en
          el portal. `parts` sólo si la orden trae. */}
      <div
        className={`grid ${
          showParts
            ? 'grid-cols-[auto_auto_auto_1fr_auto] gap-x-3'
            : 'grid-cols-[auto_auto_1fr_auto] gap-x-4'
        } gap-y-1 items-center`}
      >
        <Head>#</Head>
        <Head>Bikes</Head>
        {showParts && <Head>Parts</Head>}
        <Head>Dims (in)</Head>
        <Head className="text-right">Lbs</Head>

        {pallets.map((d) => (
          <React.Fragment key={d.pallet}>
            <div className="flex items-center gap-1">
              <Cell
                className="text-[#22c55e]"
                title={
                  d.isKids ? 'Kids bikes: their own pallet, picked last off ROW 42' : undefined
                }
              >
                #{d.pallet}
              </Cell>
              {/* Una tarima más de niño, o una menos: sólo en la última de ellas,
                  que es donde se ve cuántas son. */}
              {d.isKids &&
                onKidsSplitChange &&
                d.kidsOf != null &&
                d.pallet === d.kidsOf + (d.kidsSplit ?? 1) - 1 && (
                  <>
                    {(d.kidsSplit ?? 1) > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          onKidsSplitChange(d.kidsOf!, (d.kidsSplit ?? 1) - 1, d.boxes)
                        }
                        aria-label="One kids pallet less"
                        title="One kids pallet less"
                        className="h-6 w-6 rounded-md border border-[#22c55e]/40 text-[#22c55e] text-sm font-black leading-none active:scale-95"
                      >
                        –
                      </button>
                    )}
                    {(d.kidsSplit ?? 1) < KIDS_SPLIT_MAX && d.bikes > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          onKidsSplitChange(d.kidsOf!, (d.kidsSplit ?? 1) + 1, d.boxes)
                        }
                        aria-label="One more kids pallet"
                        title="The kids bikes took one more pallet on the floor"
                        className="h-6 w-6 rounded-md border border-[#22c55e]/40 text-[#22c55e] text-sm font-black leading-none active:scale-95"
                      >
                        +
                      </button>
                    )}
                  </>
                )}
            </div>
            <Cell className={d.bikes === 0 ? 'text-muted/40' : 'text-blue-400'}>
              {d.bikes === 0 ? '–' : d.bikes}
            </Cell>
            {showParts && (
              <Parts
                declared={d}
                editable={onPartsChange != null}
                open={openParts === d.pallet}
                onOpen={() => setOpenParts(d.pallet)}
                onChange={(value) => {
                  setOpenParts(null);
                  onPartsChange?.(d.pallet, value, d.boxes);
                }}
              />
            )}
            <Dims
              declared={d}
              editable={onDimChange != null}
              open={openDims === d.pallet}
              onOpen={() => setOpenDims(d.pallet)}
              onChange={(axis, value) => onDimChange?.(d.pallet, axis, value, d.boxes)}
            />
            <Cell className="text-purple-400 text-right">{Math.round(d.weightLbs)}</Cell>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};
