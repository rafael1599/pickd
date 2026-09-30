/**
 * «How to stack» en 3D: la tarima se arma sola delante del operador, caja por
 * caja, con sus medidas reales (Rafael, 29 sep 2026: «interactivo en 3D, como
 * si fuese videojuego»).
 *
 * - La siguiente caja brilla en su sitio —el «fantasma» del Tetris— y cae con
 *   gravedad; al asentarse destella, la cámara tiembla y el teléfono zumba.
 * - ◀ ▶ paso a paso, ▶ reproduce el armado entero, ⏮ empieza de cero.
 * - Arrastrar gira, pellizcar acerca, doble toque recentra, tocar una caja dice
 *   qué es y en qué nivel va.
 * - El medidor de la derecha sube hacia la línea de 90".
 * - Armada, salen las cotas; si alguien midió con cinta, se dice al lado.
 * - Cada caja lleva **su etiqueta**, recortada de la foto de Double Check donde
 *   el lector la encontró (`labelAtlas.ts`); tocarla la enseña en grande.
 *
 * Se carga aparte (`React.lazy`) y sólo cuando alguien abre el botón. Los
 * colores son fijos a propósito: es una escena, no un panel de la app, y se ve
 * igual en claro y en oscuro.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import Pause from 'lucide-react/dist/esm/icons/pause';
import Play from 'lucide-react/dist/esm/icons/play';
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw';
import SkipForward from 'lucide-react/dist/esm/icons/skip-forward';
import type { DeclaredPallet, PlacedBoxView } from '../declaredPallets';
import { halfHeight, PalletScene, type SceneBox, type SceneLabel } from './scene';
import { fetchLabelReads, LabelAtlas, LOGO_RECT } from './labelAtlas';

/** Lo que mide la etiqueta a lo largo de la caja, en pulgadas. */
const LABEL_LONG_IN = 10;

const STEP_MS = 520;
const MAX_HEIGHT_IN = 90;

interface Props {
  pallets: DeclaredPallet[];
  /** Las órdenes del envío: de sus fotos de Double Check salen las etiquetas. */
  listIds?: string[];
}

const levelName = (box: PlacedBoxView) =>
  box.level == null ? 'Flat on top' : box.level === 0 ? 'Bottom' : `Level ${box.level + 1}`;

const inches = (n: number) =>
  Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1);

const boxDims = (b: PlacedBoxView) =>
  `${inches(b.box.length)} × ${inches(b.box.width)} × ${inches(b.box.height)}`;

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function PalletBuilder3D({ pallets, listIds = [] }: Props) {
  const buildable = useMemo(
    () => pallets.filter((p) => p.placed && p.placed.length > 0 && p.plan),
    [pallets]
  );
  const [index, setIndex] = useState(0);
  const pallet = buildable[Math.min(index, buildable.length - 1)];
  // Ship recalcula sus tarimas a menudo (realtime, cada guardado): la escena sólo
  // vuelve a armarse cuando cambia la geometría, no cuando llega un objeto nuevo.
  const signature = pallet
    ? `${pallet.pallet}|${(pallet.placed ?? [])
        .map((b) => `${b.sku}:${b.x.toFixed(1)},${b.y.toFixed(1)},${b.sx},${b.sy},${b.sz}`)
        .join(';')}|${pallet.plan?.height}`
    : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const boxes = useMemo(() => pallet?.placed ?? [], [signature]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const plan = useMemo(() => pallet?.plan ?? null, [signature]);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<PalletScene | null>(null);
  const still = useMemo(() => reducedMotion(), []);
  const atlasRef = useRef<LabelAtlas | null>(null);
  const boxesRef = useRef(boxes);
  boxesRef.current = boxes;
  const [atlasVersion, setAtlasVersion] = useState(0);
  const [bigLabel, setBigLabel] = useState(false);

  /** Sube las etiquetas de la tarima que se ve a la escena, sin reiniciar el armado. */
  const applyLabels = useCallback(() => {
    const scene = sceneRef.current;
    const atlas = atlasRef.current;
    if (!scene || !atlas) return;
    const labels: (SceneLabel | null)[] = boxesRef.current.map((b) => {
      const cell = atlas.cell(b.sku);
      if (!cell) return null;
      const long = Math.min(LABEL_LONG_IN, b.sz * 0.3);
      return { ...cell, widthIn: long, heightIn: long * cell.aspect };
    });
    scene.setLabels(atlas.canvas, labels, { ...LOGO_RECT, widthIn: 0, heightIn: 0 });
  }, []);

  // La escena vive lo que vive el componente.
  useEffect(() => {
    if (!canvasRef.current || !overlayRef.current) return;
    try {
      sceneRef.current = new PalletScene(canvasRef.current, overlayRef.current, {
        reducedMotion: still,
        onLand: () => {
          try {
            navigator.vibrate?.(8);
          } catch {
            /* sin vibración */
          }
        },
        onTap: (i) => setSelected((prev) => (i == null || prev === i ? null : i)),
      });
    } catch {
      setFailed(true);
    }
    return () => {
      sceneRef.current?.destroy();
      sceneRef.current = null;
    };
  }, [still]);

  // Otra tarima: se arma desde cero, sola (o de golpe con movimiento reducido).
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !plan) return;
    const sceneBoxes: SceneBox[] = boxes.map((b) => ({
      x: b.x,
      y: b.y,
      z: b.z,
      sx: b.sx,
      sy: b.sy,
      sz: b.sz,
      tilt: b.tilt,
      flat: b.level == null,
      kind: b.electric ? 'electric' : b.kid ? 'kid' : 'big',
    }));
    const first = still ? boxes.length : 0;
    scene.setPallet(sceneBoxes, plan, first);
    applyLabels();
    setStep(first);
    setSelected(null);
    setPlaying(!still);
  }, [plan, boxes, still, applyLabels]);

  // Las etiquetas del envío: primero dibujadas con el catálogo, y cada foto que
  // llega sustituye las suyas por el recorte real.
  const skuKey = useMemo(
    () =>
      [
        ...new Set(
          buildable.flatMap((p) => (p.placed ?? []).map((b) => `${b.sku}\t${b.label ?? ''}`))
        ),
      ]
        .sort()
        .join('\n'),
    [buildable]
  );
  const idsKey = listIds.join(',');
  useEffect(() => {
    if (!skuKey) return;
    let alive = true;
    const atlas = new LabelAtlas();
    atlasRef.current = atlas;
    const entries = skuKey.split('\n').map((line) => line.split('\t'));
    for (const [sku, label] of entries) atlas.drawn(sku, label || null);
    applyLabels();
    setAtlasVersion((v) => v + 1);
    const ids = idsKey ? idsKey.split(',') : [];
    void fetchLabelReads(ids).then((reads) => {
      if (!alive) return;
      return atlas.loadPhotos(reads, new Set(entries.map(([sku]) => sku)), () => {
        if (!alive) return;
        applyLabels();
        setAtlasVersion((v) => v + 1);
      });
    });
    return () => {
      alive = false;
    };
  }, [skuKey, idsKey, applyLabels]);

  useEffect(() => {
    sceneRef.current?.setStep(step);
  }, [step]);

  useEffect(() => {
    sceneRef.current?.setSelected(selected);
    setBigLabel(false);
  }, [selected]);

  useEffect(() => {
    if (!playing) return;
    if (step >= boxes.length) {
      setPlaying(false);
      return;
    }
    const id = window.setTimeout(() => setStep((s) => s + 1), step === 0 ? 900 : STEP_MS);
    return () => window.clearTimeout(id);
  }, [playing, step, boxes.length]);

  const go = useCallback(
    (next: number) => {
      setPlaying(false);
      setSelected(null);
      setStep(Math.max(0, Math.min(boxes.length, next)));
    },
    [boxes.length]
  );

  if (failed || buildable.length === 0 || !pallet || !plan) return null;

  const done = step >= boxes.length;
  const next = boxes[step];
  const picked = selected != null ? boxes[selected] : null;
  // atlasVersion en la dependencia implícita: cada foto nueva vuelve a pintar esto.
  const pickedCell = picked && atlasVersion >= 0 ? atlasRef.current?.cell(picked.sku) : undefined;
  const top = boxes.slice(0, step).reduce((h, b) => Math.max(h, b.y + halfHeight(b)), 5);
  const measured = pallet.size?.source === 'manual' ? pallet.size : null;
  const position = pallets.indexOf(pallet) + 1;

  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl select-none"
      style={{
        height: 400,
        background: 'radial-gradient(120% 90% at 50% 38%, #1c2533 0%, #0e131b 62%, #080b10 100%)',
        touchAction: 'none',
      }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full cursor-grab active:cursor-grabbing"
      />
      <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />

      {/* Arriba: qué tarima, en qué paso. */}
      <div className="pointer-events-none absolute left-3 right-14 top-3 flex items-center gap-2">
        {buildable.length > 1 ? (
          <div className="pointer-events-auto flex gap-1">
            {buildable.map((p, i) => (
              <button
                key={p.pallet}
                type="button"
                onClick={() => setIndex(i)}
                className={`h-7 min-w-7 rounded-lg px-2 text-[12px] font-black tabular-nums transition-colors ${
                  p === pallet
                    ? 'bg-[#22c55e] text-[#06210f]'
                    : 'bg-white/10 text-white/70 hover:bg-white/20'
                }`}
              >
                #{pallets.indexOf(p) + 1}
              </button>
            ))}
          </div>
        ) : (
          <span className="text-[13px] font-black text-[#22c55e]">#{position}</span>
        )}
        <span className="ml-auto text-[10px] font-black uppercase tracking-widest text-white/60 tabular-nums">
          {done ? 'Built' : `Box ${step + 1} / ${boxes.length}`}
        </span>
      </div>

      {/* La etiqueta de la caja tocada, como se lee de pie. Un toque la agranda. */}
      {picked && pickedCell?.thumb && (
        <button
          type="button"
          onClick={() => setBigLabel((v) => !v)}
          className="absolute left-3 top-12 flex flex-col items-center gap-1 rounded-xl bg-black/60 p-1.5 backdrop-blur-sm transition-all"
          style={{ width: bigLabel ? 172 : 86 }}
          aria-label={bigLabel ? 'Smaller label' : 'Bigger label'}
        >
          <img
            src={pickedCell.thumb}
            alt={`Label of ${picked.label ?? picked.sku}`}
            className="w-full rounded-md"
            style={{ aspectRatio: '1 / 2', objectFit: 'fill' }}
          />
          <span
            className={`text-[9px] font-black uppercase tracking-widest ${
              pickedCell.source === 'photo' ? 'text-[#67e8f9]' : 'text-amber-400'
            }`}
          >
            {pickedCell.source === 'photo' ? 'From photo' : 'Not read · drawn'}
          </span>
        </button>
      )}

      {/* Derecha: el alto, subiendo hacia el tope de 90". */}
      <div className="pointer-events-none absolute right-3 top-3 bottom-[88px] flex w-7 flex-col items-center">
        <span className="text-[9px] font-black text-[#fb7185]">90″</span>
        <div className="relative mt-1 w-2 flex-1 rounded-full bg-white/10">
          <div
            className="absolute bottom-0 left-0 right-0 rounded-full transition-all duration-500"
            style={{
              height: `${Math.min(100, (top / MAX_HEIGHT_IN) * 100)}%`,
              background:
                top > MAX_HEIGHT_IN - 6
                  ? 'linear-gradient(#fb7185, #f43f5e)'
                  : 'linear-gradient(#67e8f9, #22c55e)',
            }}
          />
        </div>
        <span className="mt-1 text-[11px] font-black tabular-nums text-white">{inches(top)}″</span>
      </div>

      {/* Abajo: lo que toca ahora, y los mandos. */}
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 bg-gradient-to-t from-[#080b10] via-[#080b10]/85 to-transparent px-3 pb-3 pt-6">
        <div className="min-h-[34px] text-white" aria-live="polite">
          {picked ? (
            <>
              <div className="text-[10px] font-black uppercase tracking-widest text-[#67e8f9]">
                {levelName(picked)} · box {picked.order + 1}
              </div>
              <div className="truncate text-[14px] font-black">
                {picked.label ?? picked.sku}
                <span className="ml-2 text-[12px] font-bold text-white/60 tabular-nums">
                  {boxDims(picked)}
                  {picked.measured ? '' : ' · not measured'}
                </span>
              </div>
            </>
          ) : done ? (
            <>
              <div className="text-[10px] font-black uppercase tracking-widest text-[#22c55e]">
                Pallet built · {boxes.length} boxes
              </div>
              <div className="text-[14px] font-black tabular-nums">
                <span className="text-[#fb7185]">
                  {inches(plan.length)} × {inches(plan.width)} × {inches(plan.height)} in
                </span>
                {measured && (
                  <span className="ml-2 text-[12px] font-bold text-white/60">
                    tape {inches(measured.length)} × {inches(measured.width)} ×{' '}
                    {inches(measured.height)}
                  </span>
                )}
              </div>
            </>
          ) : next ? (
            <>
              <div className="text-[10px] font-black uppercase tracking-widest text-[#67e8f9]">
                Next → {levelName(next)}
              </div>
              <div className="truncate text-[14px] font-black">
                {next.label ?? next.sku}
                <span className="ml-2 text-[12px] font-bold text-white/60 tabular-nums">
                  {boxDims(next)}
                </span>
              </div>
            </>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <Ctl label="Start over" onClick={() => go(0)}>
            <RotateCcw size={16} strokeWidth={2.5} />
          </Ctl>
          <Ctl label="Previous box" onClick={() => go(step - 1)} disabled={step === 0}>
            <ChevronLeft size={18} strokeWidth={3} />
          </Ctl>
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              if (done) {
                setStep(0);
                setPlaying(true);
              } else setPlaying((p) => !p);
            }}
            className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-[#22c55e] text-[12px] font-black uppercase tracking-widest text-[#06210f] active:scale-95 transition-transform"
          >
            {playing ? <Pause size={16} strokeWidth={3} /> : <Play size={16} strokeWidth={3} />}
            {playing ? 'Pause' : done ? 'Build again' : step === 0 ? 'Build' : 'Continue'}
          </button>
          <Ctl label="Next box" onClick={() => go(step + 1)} disabled={done}>
            <ChevronRight size={18} strokeWidth={3} />
          </Ctl>
          <Ctl label="Show it built" onClick={() => go(boxes.length)} disabled={done}>
            <SkipForward size={16} strokeWidth={2.5} />
          </Ctl>
        </div>
      </div>
    </div>
  );
}

const Ctl: React.FC<{
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ label, onClick, disabled, children }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    disabled={disabled}
    className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-white active:scale-95 transition-transform disabled:opacity-30"
  >
    {children}
  </button>
);
