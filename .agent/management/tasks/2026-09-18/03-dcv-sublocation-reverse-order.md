# DCV: recoger de la letra más alta a la A

## Estado
IMPLEMENTADO (commit pendiente de push en este turno)

## Pedido de Rafael (literal)
"Me refiero a que se recoja de D y después se pase a recoger de C y
después de B y después de A para ir en ese orden. A sigue estando más
cerca del pasillo pero si en todas las sublocations de una row específica
hubiesen items por recoger se mande a D o la más alta que haya antes de
que se llegue a A." Es decir: dentro de una misma row/location, agotar
primero la sublocation con la letra MÁS ALTA que tenga stock, bajando
hasta A. Hoy hace lo contrario (A primero).

## Contexto ya conocido
Investigación de agy (18 sep, sesión anterior), archivos:
- `src/features/picking/components/DoubleCheckView.tsx` líneas ~3000-3013:
  el display toma `[...subs].sort()[0]` — ascendente, A gana.
- `src/features/picking/utils/liveResolution.ts`, función `sortByLocation`
  (~línea 91-102): al desempatar dos items en la misma row compara
  `subA.localeCompare(subB)` — también ascendente.
- `src/features/picking/utils/pickLocation.ts`: `byPickPreference` (líneas
  ~129-141) ordena por cantidad, no por letra de sublocation — no es donde
  vive este bug, pero **este archivo ya fue modificado por Claude** en el
  fix de contenedores 7005N (commit `3d702f98`) — leer el código TAL COMO
  ESTÁ AHORA, no asumir el estado previo a ese commit.
- `DoubleCheckView.tsx` también fue modificado por Claude en el mismo
  commit (import de `isWarehouseContainer`, filtro en `fetchDistributions`
  ~línea 1211-1214) — el cambio de sublocation es una zona de código
  distinta del mismo archivo, no debería chocar, pero confirmarlo.

## Hallazgos

## Plan de fix propuesto
1. En `DoubleCheckView.tsx` (~3000-3013): cambiar `[...subs].sort()[0]` a
   `[...subs].sort().reverse()[0]` o un comparador descendente explícito
   (`(a, b) => b.localeCompare(a)`), verificando primero contra el código
   actual que esa línea sigue en ese rango tras el commit de contenedores.
2. En `liveResolution.ts`, `sortByLocation`: invertir
   `subA.localeCompare(subB)` a `subB.localeCompare(subA, ..., { numeric:
   true, sensitivity: 'base' })`.
3. Verificar si hay un tercer punto donde se decide qué sublocation
   ofrecer primero al picker durante el pick en sí (no solo el display) —
   agy no confirmó si `DoubleCheckView.tsx` y `liveResolution.ts` son las
   ÚNICAS dos rutas de decisión o si falta una tercera en el flujo de
   `planPickForList`/`usePickingActions.ts`. Revisar antes de dar por
   completo el fix.
4. Correr `pickLocation.test.ts` y `liveResolution.test.ts` después del
   cambio — probablemente hay tests que asumen el orden ascendente actual
   y hay que actualizarlos a propósito (no son una señal de regresión,
   son el comportamiento viejo que el pedido de Rafael reemplaza).

## Autocorrección

## Preguntas para Rafael
Ninguna — el pedido ya quedó sin ambigüedad en la aclaración de Rafael.
