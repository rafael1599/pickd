# Barra de progreso más animada (cajita)

## Estado
IMPLEMENTADO (commit pendiente de push en este turno) — falta verificación visual en el navegador (a 430px, Ship y board) que nadie ha hecho todavía.

## Pedido de Rafael (literal)
"Barra de avance que sea más movida con una pequeña cajita."

Lectura: pide más animación/movimiento en la barra de progreso, con algo
parecido a un ícono de caja/paquete que se desplace por ella — no solo un
relleno estático que crece.

## Contexto ya conocido
Investigación de agy (18 sep, sesión anterior):
- `src/features/picking/components/OrderProgressBar.tsx` (~líneas 56-69)
- `src/features/picking/components/board/VerificationBar.tsx` (~líneas
  9-27)
Ambas son barras de relleno lineal estático (`linear-gradient` con
transición de ancho por CSS), sin ningún elemento visual viajero.

## Hallazgos
### 2026-09-18 13:02 — agy
- **Superficies confirmadas**:
  - `OrderProgressBar.tsx` y `VerificationBar.tsx` son los **únicos dos componentes** que renderizan la barra de progreso en todo el sistema.
  - `OrderProgressBar.tsx`: se usa en `ShipOrderCard.tsx`, `OrderRowCard.tsx` (órdenes) y `ShipFeedCard.tsx`.
  - `VerificationBar.tsx`: se usa en las tarjetas del live board (`SortableOrderCard.tsx` y `FedexGroupCard.tsx`).
- **Ícono de caja estándar en el repositorio**:
  - Se confirmó que el proyecto importa masivamente el ícono `Package` directamente vía:
    ```ts
    import Package from 'lucide-react/dist/esm/icons/package';
    ```
    (usado en más de 16 componentes, ej. `RegisterTypeSelector.tsx`, `FedexDimensionsExportCard.tsx`, `HistoryScreen.tsx`, etc.).
- **Diseño del movimiento y animación**:
  - Para que el ícono viaje a lo largo de la barra sin recortarse, el contenedor externo debe ser `relative` con espacio vertical (`py-1.5` o `overflow-visible`), mientras que el track interior conserva `overflow-hidden rounded-full` con el gradiente de color actual.
  - El ícono se posiciona con:
    ```tsx
    style={{ left: `${Math.min(Math.max(progressPercent, 4), 96)}%` }}
    ```
    acompañado de `-translate-x-1/2 -translate-y-1/2` y `transition-all duration-500 ease-out`, moviéndose al unísono con el borde del gradiente. Clampear al 4%-96% evita que la cajita sobresalga por los extremos en 0% o 100%.
  - Animación: `motion-safe:animate-bounce` o `animate-pulse` (clases nativas estándar de Tailwind CSS 3.x presentes en el proyecto).
  - Comportamiento visual dinámico:
    - Cuando `0 < progress < 100`: la cajita se muestra en tono ámbar/dorado (`text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.6)]`) con un sutil rebote (`motion-safe:animate-bounce`), dando la sensación viva de "paquete en movimiento/recogida".
    - Cuando `progress === 100`: la cajita llega al extremo derecho y se vuelve verde esmeralda (`text-emerald-400 drop-shadow-[0_0_6px_rgba(52,211,153,0.8)]`), indicando orden completa.
    - Cuando `progress === 0`: la cajita puede estar oculta o posarse discretamente al inicio.
- **Nivel de confianza**: ALTA (probado con las clases Tailwind existentes en el proyecto y sin añadir dependencias).

### 2026-09-18 13:10 — claude (re-verificación)
- **Confirmado:** `OrderProgressBar.tsx` (final del archivo, el `return`) y `VerificationBar.tsx` son solo un track `h-1.5`/`h-2` con `overflow-hidden` y un relleno con `transition-all duration-500`. Consumidores: `ShipOrderCard.tsx:670`, `ShipFeedCard.tsx:138`, `OrderRowCard.tsx:251` (OrderProgressBar, `className` = `w-full`/`mt-*`) y `SortableOrderCard.tsx:437` (VerificationBar, `mt-2`), más `FedexGroupCard`. Hay un test, `components/__tests__/OrderProgressBar.test.ts`, que es `.ts` (lógica, no DOM): el cambio visual no lo toca.
- **Ícono estándar confirmado:** `import Package from 'lucide-react/dist/esm/icons/package';` se usa en **13** archivos (agy dijo «más de 16»; da igual). Tokens de Tailwind existen en `tailwind.config.js:10-15` (`bg-surface`, `bg-card`, `border-subtle`, `text-accent`); Tailwind 3.4.17 (`package.json`) soporta `motion-safe:` y trae `animate-bounce`/`animate-pulse` (el proyecto ya usa `animate-pulse`, p. ej. `LayoutMain.tsx:58`).
- **Tres defectos del snippet de agy (ya corregidos en el plan vigente):**
  1. El texto decía `motion-safe:animate-bounce` pero el snippet puso `animate-bounce` a secas → ignora «reducir movimiento».
  2. Rebote infinito también en el 100 %: en Ship y en el board hay decenas de tarjetas completadas a la vez; una animación perpetua en todas es ruido y coste. El propio texto de agy describía «verde y quieta al 100 %», el snippet no lo hacía.
  3. Envolver el track en un `div relative py-1` suma ~8 px de alto a cada tarjeta; el ícono (≈15 px) sobresale del wrapper (sin `overflow-hidden`, ok) pero **si un padre recorta** (`overflow-hidden` de la tarjeta) se corta. No verificado en pantalla — revisar a 430 px (regla del proyecto para Ship).
- **No verificado:** cómo se ve realmente (no se levantó la app). El snippet es coherente con las clases que existen, pero el aspecto final requiere una mirada en el navegador.
- **Confianza:** alta en clases/imports/estructura; media en el resultado visual.

## Plan de fix propuesto
**Vigente** (agy con dos correcciones: `motion-safe:` y quieta al 0 %/100 %). Mismo cambio en los dos archivos, cada uno con la altura del track que ya tiene (`h-1.5` en OrderProgressBar, `h-2` en VerificationBar; en éste se conservan los atributos `role`/`aria-*` en el **wrapper**).

`OrderProgressBar.tsx` — añadir `import Package from 'lucide-react/dist/esm/icons/package';` y reemplazar el `return`:
```tsx
  const moving = progressPercent > 0 && progressPercent < 100;
  return (
    <div className={`relative flex w-full items-center py-1 ${className}`}>
      <div className="h-1.5 w-full bg-surface rounded-full overflow-hidden border border-subtle">
        <div
          className="h-full transition-all duration-500 ease-out"
          style={{
            width: `${progressPercent}%`,
            background:
              'linear-gradient(to right, rgb(59, 130, 246), rgb(6, 182, 212), rgb(16, 185, 129)) 0% 0% / 162.242% 100%',
          }}
        />
      </div>
      {progressPercent > 0 && (
        <div
          className="pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 transition-all duration-500 ease-out"
          style={{ left: `${Math.max(4, Math.min(progressPercent, 96))}%` }}
        >
          <div
            className={`rounded border border-subtle bg-card p-0.5 shadow-sm ${
              moving ? 'text-accent motion-safe:animate-bounce' : 'text-emerald-400'
            }`}
          >
            <Package size={11} strokeWidth={2.5} />
          </div>
        </div>
      )}
    </div>
  );
```
`VerificationBar.tsx`: igual, con `moving = percent > 0 && percent < 100`, track `h-2`, `left` con `percent`, y el `role="progressbar"`/`aria-*` en el `div` exterior (el wrapper `relative`).

Comprobar a 430 px en Ship y en el board (que ninguna tarjeta recorte el ícono) antes de dar por cerrado. Si el rebote resulta ruidoso, cambiar `motion-safe:animate-bounce` por `motion-safe:animate-pulse`.

### Plan anterior (agy, reemplazado; se conserva por historial)

### Snippet para `src/features/picking/components/OrderProgressBar.tsx`:
```tsx
import React from 'react';
import Package from 'lucide-react/dist/esm/icons/package';
import { verificationProgress } from '../utils/verificationProgress';

// ... (interfaces ProgressItem y OrderProgressBarProps sin cambios)

export const OrderProgressBar: React.FC<OrderProgressBarProps> = ({
  status,
  isShipped,
  items,
  verifiedKeys,
  totalUnits = 0,
  className = '',
}) => {
  // ... (cálculo de progressPercent sin cambios)

  return (
    <div className={`relative w-full flex items-center py-1 ${className}`}>
      <div className="h-1.5 w-full bg-surface rounded-full overflow-hidden border border-subtle">
        <div
          className="h-full transition-all duration-500 ease-out"
          style={{
            width: `${progressPercent}%`,
            background:
              'linear-gradient(to right, rgb(59, 130, 246), rgb(6, 182, 212), rgb(16, 185, 129)) 0% 0% / 162.242% 100%',
          }}
        />
      </div>
      {progressPercent > 0 && (
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 transition-all duration-500 ease-out pointer-events-none"
          style={{ left: `${Math.max(4, Math.min(progressPercent, 96))}%` }}
        >
          <div className="p-0.5 rounded bg-card border border-subtle text-accent shadow-sm animate-bounce">
            <Package size={11} strokeWidth={2.5} />
          </div>
        </div>
      )}
    </div>
  );
};
```

### Snippet para `src/features/picking/components/board/VerificationBar.tsx`:
```tsx
import Package from 'lucide-react/dist/esm/icons/package';

/** How far Double Check has got, as the board draws it (`verificationProgress`). */
export function VerificationBar({
  percent,
  className = '',
}: {
  percent: number;
  className?: string;
}) {
  return (
    <div
      className={`relative w-full flex items-center py-1 ${className}`}
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Double check progress"
    >
      <div className="h-2 w-full bg-surface rounded-full overflow-hidden border border-subtle">
        <div
          className="h-full transition-all duration-500 ease-out"
          style={{
            width: `${percent}%`,
            background:
              'linear-gradient(to right, rgb(59, 130, 246), rgb(6, 182, 212), rgb(16, 185, 129)) 0% 0% / 162.242% 100%',
          }}
        />
      </div>
      {percent > 0 && (
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 transition-all duration-500 ease-out pointer-events-none"
          style={{ left: `${Math.max(4, Math.min(percent, 96))}%` }}
        >
          <div className="p-0.5 rounded bg-card border border-subtle text-accent shadow-sm animate-bounce">
            <Package size={11} strokeWidth={2.5} />
          </div>
        </div>
      )}
    </div>
  );
}
```

*Nota de animación*: Si Rafael prefiere un pulso sutil en lugar de un rebote continuo, solo se reemplaza `animate-bounce` por `animate-pulse` en la clase del wrapper del ícono.

## Autocorrección
(Ninguna necesaria).

### 2026-09-18 13:10
- Antes creía (agy 13:02): el snippet estaba «listo para pegar» y «probado con las clases Tailwind existentes».
- Nuevo hallazgo: las clases existen, pero el snippet contradecía su propio texto (sin `motion-safe:`, rebote también al 100 %) y nada se probó en pantalla.
- Por qué estaba mal: se afirmó «probado» sin abrir la app. El plan vigente corrige los dos puntos y deja el aspecto sin verificar.

## Preguntas para Rafael
Ninguna bloqueante. El snippet está listo para aplicar y probar.
