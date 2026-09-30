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
 * Y `bikes` también (Rafael, 28 sep 2026): el piso arma a veces otra cuenta que
 * la calculada —#881677 salió en 10 y 15 donde PickD decía 13 y 12—. Se teclea
 * la de un pallet y los demás se reacomodan solos en orden de recogida, con sus
 * pesos; vaciarla devuelve el pallet al cálculo.
 *
 * Sin botón de copiar por fila: uno para el bloque entero.
 *
 * ## Cómo armarla, plegado al final (Rafael, 29 sep 2026)
 *
 * La medida calculada sale de un armado concreto (`layoutPallet`): niveles de
 * canto de abajo arriba, las más altas abajo, y hasta dos acostadas encima.
 * `How to stack` la arma en 3D, caja por caja y con medidas reales
 * (`pallet3d/`), para que el piso arme lo que PickD declara; sin WebGL2, en
 * texto. Va cerrado y al final a propósito: es una consulta, no un paso, y
 * Double Check no lo lleva («no quiero hacer más engorroso el double check»).
 */
import React, { Suspense, lazy, useMemo, useState } from 'react';
import { webgl2Supported } from './pallet3d/support';
import { CopyButton } from '../ui/CopyButton';
import {
  KIDS_SPLIT_MAX,
  palletClipboard,
  partsBalance,
  totalDeclaredWeight,
  type DeclaredPallet,
  type StackRow,
} from './declaredPallets';
import { formatPalletSize, sanitizeCount, sanitizeInches } from '../../utils/palletDims';

/** El 3D se descarga sólo cuando alguien abre «How to stack». */
const PalletBuilder3D = lazy(() => import('./pallet3d/PalletBuilder3D'));

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
  /** Decir cuántas bicis lleva un pallet. `null` vuelve al reparto calculado. */
  onBikesChange?: (pallet: number, value: number | null, boxes: number) => void;
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
const TONE_INPUT = {
  rose: 'border-rose-500/30 text-rose-400 focus:border-rose-400',
  orange: 'border-orange-500/30 text-orange-400 focus:border-orange-400',
  blue: 'border-blue-500/30 text-blue-400 focus:border-blue-400',
} as const;
type Tone = keyof typeof TONE_INPUT;

const inputClass = (tone: Tone) =>
  `w-9 rounded-md border bg-card px-0.5 py-1 text-center text-[13px] font-black tabular-nums placeholder:text-muted/40 focus:outline-none disabled:opacity-50 ${TONE_INPUT[tone]}`;

/** La cifra encendida, la apagada (calculada) y la vacía de cada tono. */
const TONE_TEXT: Record<Exclude<Tone, 'rose'>, { typed: string; computed: string }> = {
  orange: { typed: 'text-orange-400', computed: 'text-orange-400/60' },
  blue: { typed: 'text-blue-400', computed: 'text-blue-400/60' },
};

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
 * Una cantidad por bulto que se puede corregir: partes encima o bicis dentro.
 * La cifra apagada es el reparto calculado, la encendida la tecleó alguien, y
 * un toque abre la casilla para cambiarla. Vaciarla la devuelve al cálculo, que
 * no es lo mismo que teclear un 0.
 */
const Count: React.FC<{
  label: string;
  value: number;
  typed: boolean;
  tone: Exclude<Tone, 'rose'>;
  titles: { typed: string; computed: string };
  pallet: number;
  editable: boolean;
  open: boolean;
  onOpen: () => void;
  onChange: (value: number | null) => void;
}> = ({ label, value, typed, tone, titles, pallet, editable, open, onOpen, onChange }) => {
  const [text, setText] = useState<string | null>(null);

  if (!open) {
    return (
      <Cell
        className={
          value === 0 && !typed
            ? 'text-muted/40'
            : typed
              ? TONE_TEXT[tone].typed
              : TONE_TEXT[tone].computed
        }
        title={typed ? titles.typed : titles.computed}
      >
        <button
          type="button"
          disabled={!editable}
          onClick={onOpen}
          className="disabled:cursor-default"
        >
          {value === 0 && !typed ? '–' : value}
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
      aria-label={`Pallet ${pallet} ${label}`}
      value={text ?? (typed ? String(value) : '')}
      placeholder={value > 0 ? String(value) : '–'}
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => {
        const next = sanitizeCount(e.target.value);
        setText(null);
        onChange(next);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      className={inputClass(tone)}
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
  onBikesChange,
  onKidsSplitChange,
}) => {
  const [openDims, setOpenDims] = useState<number | null>(null);
  const [openParts, setOpenParts] = useState<number | null>(null);
  const [openBikes, setOpenBikes] = useState<number | null>(null);
  const [showStacking, setShowStacking] = useState(false);
  const has3d = useMemo(() => webgl2Supported(), []);
  if (pallets.length === 0) return null;
  const stackable = pallets.some((d) => d.stacking && d.stacking.levels.length > 0);

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

        {pallets.map((d, index) => (
          <React.Fragment key={d.pallet}>
            <div className="flex items-center gap-1">
              <Cell
                className="text-[#22c55e]"
                title={
                  d.isKids ? 'Kids bikes: their own pallet, picked last off ROW 42' : undefined
                }
              >
                {/* La posición, como en Double Check («3/5»), no el ordinal interno. */}#
                {index + 1}
              </Cell>
              {/* Una tarima más de niño, o una menos: sólo en la última de ellas,
                  que es donde se ve cuántas son. */}
              {d.isKids &&
                onKidsSplitChange &&
                d.kidsOf != null &&
                d.pallet ===
                  Math.max(
                    ...pallets.filter((p) => p.kidsOf === d.kidsOf).map((p) => p.pallet)
                  ) && (
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
            <Count
              label="bikes"
              value={d.bikes}
              typed={d.bikesTyped}
              tone="blue"
              titles={{
                typed: 'The floor said this pallet carries these bikes — tap to change it',
                computed: 'Computed split — tap if the floor built it differently',
              }}
              pallet={d.pallet}
              editable={onBikesChange != null}
              open={openBikes === d.pallet}
              onOpen={() => setOpenBikes(d.pallet)}
              onChange={(value) => {
                setOpenBikes(null);
                onBikesChange?.(d.pallet, value, d.boxes);
              }}
            />
            {showParts && (
              <Count
                label="parts"
                value={d.parts}
                typed={d.partsTyped}
                tone="orange"
                titles={{
                  typed: 'Someone put these parts on this pallet — tap to change it',
                  computed: 'Parts nobody assigned ride on the last pallet — tap to move them',
                }}
                pallet={d.pallet}
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

      {stackable && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowStacking((v) => !v)}
            aria-expanded={showStacking}
            className="self-start text-[10px] font-black uppercase tracking-widest text-muted hover:text-content transition-colors"
          >
            How to stack {showStacking ? '▴' : '▾'}
          </button>
          {showStacking && has3d && (
            <Suspense
              fallback={<div className="h-[400px] w-full animate-pulse rounded-2xl bg-[#0e131b]" />}
            >
              <PalletBuilder3D pallets={pallets} />
            </Suspense>
          )}
          {/* Sin WebGL2 (un teléfono muy viejo), la misma instrucción en texto. */}
          {showStacking &&
            !has3d &&
            pallets.map((d, index) =>
              d.stacking && d.stacking.levels.length > 0 ? (
                <StackingGuide key={d.pallet} position={index + 1} stacking={d.stacking} />
              ) : null
            )}
        </div>
      )}
    </div>
  );
};

const StackLine: React.FC<{ rows: StackRow[] }> = ({ rows }) => (
  <span className="text-[12px] font-bold text-content/80">
    {rows.map((r, i) => (
      <React.Fragment key={`${r.sku}-${i}`}>
        {i > 0 && <span className="text-muted/50"> · </span>}
        <span className="text-blue-400 tabular-nums">{r.qty}×</span> {r.label ?? r.sku}
      </React.Fragment>
    ))}
  </span>
);

/** Una tarima: niveles de abajo arriba, y lo acostado al final. */
const StackingGuide: React.FC<{
  position: number;
  stacking: NonNullable<DeclaredPallet['stacking']>;
}> = ({ position, stacking }) => (
  <div className="flex gap-3 items-baseline">
    <span className="font-heading font-bold text-sm text-[#22c55e] shrink-0">#{position}</span>
    <div className="flex flex-col gap-0.5 min-w-0">
      {stacking.levels.map((rows, i) => (
        <div key={i} className="flex gap-2 items-baseline min-w-0">
          <span className="text-[10px] font-black uppercase tracking-widest text-muted shrink-0">
            {i === 0 ? 'Bottom' : `Level ${i + 1}`}
          </span>
          <StackLine rows={rows} />
        </div>
      ))}
      {stacking.flat.length > 0 && (
        <div className="flex gap-2 items-baseline min-w-0">
          <span className="text-[10px] font-black uppercase tracking-widest text-muted shrink-0">
            Flat on top
          </span>
          <StackLine rows={stacking.flat} />
        </div>
      )}
    </div>
  </div>
);
