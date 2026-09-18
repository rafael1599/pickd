# Ocultar banner "Live sync lost" en toda la app

## Estado
IMPLEMENTADO

## Pedido de Rafael (literal)
"En toda la app tampoco quiero ver estas alertas: Live sync lost. Falling
back to slow polling — changes from others may take up to 30s."

## Contexto ya conocido
Investigación de agy (18 sep, sesión anterior): `usePickingSync.ts`,
líneas ~521-525. Cuando el canal Realtime de Supabase agota reintentos
(`maxRetries = 3`) por microcortes o latencia, dispara:
`toast('Live sync lost. Falling back to slow polling...', { duration: 8000,
icon: '⚠️' })`.

Confianza de agy: muy alta (100%). No toca ningún archivo que Claude
modificó en sesiones previas. "Toda la app" — revisar si este mismo texto
o patrón se repite en más de un hook (buscar el string literal, no asumir
que `usePickingSync.ts` es el único emisor).

## Hallazgos

## Plan de fix propuesto
`grep -rn "Live sync lost" src/` para confirmar si hay una sola emisión o
varias (el pedido dice "en toda la app", así que puede haber más de un
sitio si distintas vistas usan hooks de sync distintos). Quitar el toast
en cada uno; el fallback a polling sigue funcionando igual, solo deja de
avisar. Si el mismo hook se usa en múltiples vistas, un solo fix alcanza.

## Autocorrección

## Preguntas para Rafael
Ninguna.
