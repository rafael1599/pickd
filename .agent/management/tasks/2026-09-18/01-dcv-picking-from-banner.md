# Ocultar banner "Picking from" en DCV

## Estado
IMPLEMENTADO

## Pedido de Rafael (literal)
"En dcv no quiero ver esta alerta: Picking from: 03-3740BK: ROW 1 · E /
03-3743GN: ROW 29 · E / ... (lista de SKU: ROW · sublocation). Quiere que
esa alerta/banner deje de mostrarse."

## Contexto ya conocido
Investigación de agy (18 sep, sesión anterior): al abrir una orden para
verificar/recoger, `planPickForList` (llamado desde el hook de abajo)
replanifica ubicaciones. Si detecta movimientos o asigna ubicaciones a
líneas sin congelar, dispara:

- `src/features/picking/hooks/usePickingActions.ts` líneas ~660-673:
  `toast(\`Picking from:\n${summary}\`, { duration: 8000, icon: '📍' })`
- Línea ~265 (mismo hook): un toast hermano, "Moved since this order was
  built...", con el mismo propósito informativo.

Confianza de agy: muy alta (100%). No toca ningún archivo que Claude
modificó en sesiones previas.

## Hallazgos

## Plan de fix propuesto
Verificar en `usePickingActions.ts` líneas ~256-269 y ~660-673 el snippet
exacto (puede haber cambiado de línea desde que agy lo leyó). Eliminar (o
convertir en solo-log de consola, sin toast visible) ambos `toast(...)` de
"Picking from" y "Moved since this order was built". Confirmar que no hay
lógica funcional escondida en el mismo bloque (algunos toasts en este
archivo también disparan un side-effect además de mostrar mensaje — leer
las ~15 líneas alrededor antes de borrar, no solo la línea del toast).

## Autocorrección

## Preguntas para Rafael
Ninguna — es una eliminación de UI directa.
