# Documentar y lanzar el "what's new" de hoy (18 sep)

## Estado
IMPLEMENTADO (en main, `e6054dac`)

## Pedido de Rafael (literal)
"Documenta y lanza las what's new de pickd" — "Con agy".

## Contexto ya conocido
- El mecanismo YA EXISTE, no hay que construir nada: `src/features/
  reports/WhatsNewViewer.tsx` lee `reports/warehouse-updates/YYYY-MM-DD.md`
  + `.html` (el `.html` es lo que de verdad se muestra/imprime; el `.md`
  es la fuente de texto plano hermana, mismo contenido). El script
  `prebuild` en `package.json` copia los `.html` a `public/` y genera
  `index.json` con la lista de fechas — **eso corre solo en cada build**,
  no hay que tocarlo a mano.
- `public/reports/warehouse-updates/` está en `.gitignore` (es build
  artifact). **Lo único que se versiona y hay que commitear es
  `reports/warehouse-updates/*.md` y `*.html`.**
- **Ya existe una entrada para HOY** (`reports/warehouse-updates/
  2026-09-18.md` y `.html`), escrita en una sesión anterior de hoy mismo,
  con 4 puntos (pallet de canceladas, doble descuento en combine, etc. —
  trabajo NO relacionado con esta sesión). **No es de esta tarea, no se
  borra ni se reescribe — se AMPLÍA**, agregando los puntos nuevos de
  abajo como ítems 5, 6, 7... y actualizando "The short version" arriba
  con 2-3 de los más importantes para quien no lee todo.
- **Voz y formato exactos a copiar** (leer `2026-09-18.html` completo
  ANTES de escribir nada — es la plantilla): inglés (la app es para el
  piso de Ludlow, en inglés), tono concreto y "para humano del piso", no
  para developer — nada de nombres de archivo, funciones ni jerga técnica
  en el texto visible. Estructura por punto: `<h3>` con el titular en
  pasado/presente simple, 1-2 `<p>` explicando qué pasaba y qué pasa
  ahora, y cuando aplica un `<div class="screen">` (lo nuevo, en verde) o
  `<div class="was">` (lo que costaba, en rojo) o `<p class="note">`
  (aclaración corta). Ejemplo de esa plantilla en el punto 4 ya escrito:
  `<div class="screen"><b>Now:</b> <i>"Nothing was cancelled..."</i></div>`.
  Los números de orden concretos SOLO se citan si están confirmados en
  código/commit — no inventar ninguno (los del punto 2 ya escrito, p.ej.,
  vienen de una tabla real).

## Qué documentar (los commits/tareas de ESTA sesión, ya en main)
Referencia rápida — el detalle técnico completo de cada uno está en su
`.md` de tarea en esta misma carpeta (01 a 10) y en el commit citado; leer
esos antes de traducir a lenguaje de piso, no inventar el detalle:

1. **Contenedores nunca se ofrecen para recoger** (commit `3d702f98`,
   tarea `01`... en verdad esta specific no tiene .md propio, ver el
   commit). DCV ya no manda a recoger de un contenedor de recepción
   (ej. "7005N") — esos números nunca deberían aparecer como ubicación
   de pickup, y ahora no aparecen en ningún lado: DCV, el plan de picking,
   ni las sugerencias de stock.
2. **El pallet count de una orden combinada ya no se infla** (commit
   `60dcf945`). Antes, combinar dos órdenes podía terminar marcando 2
   pallets donde solo había 1 físico. Ahora una combinación deliberada
   cuenta como un solo pallet real, calculado sobre el carrito completo.
   El mismo fix corrigió los números en Live Board (Priority/FedEx/
   Regular/Waiting/Pulling) que contaban una orden combinada como varias
   órdenes separadas — infladas.
3. **El carrier se sincroniza a las órdenes hermanas de una combinación**
   (commit `f8c73077`) — elegir el carrier en una mitad de una orden
   combinada ya lo refleja en la otra mitad, tanto en Live Board como en
   Ship.
4. **Carrier + Load #/BOL en un solo click** (commits `d843c13a`,
   `43102131`) — antes había que hacer dos clicks separados (elegir
   carrier, después abrir otro cuadro para el load number). Ahora al
   elegir el carrier se abre ahí mismo el campo para escribir el load
   number/BOL. Funciona igual en Live Board y en Ship.
5. **Recoger en DCV va de la letra más alta a la A** (commit `2c49a60a`)
   — si una fila tiene varias sublocaciones con producto por recoger,
   ahora se manda primero a la más alta (ej. D antes que C, C antes que
   B) en vez de al revés.
6. **Dos banners informativos ya no aparecen** (commit `2c49a60a`): el de
   "Picking from: [lista de ubicaciones]" en DCV, y el de "Live sync
   lost. Falling back to slow polling" en toda la app. Seguían
   funcionando por dentro (el reordenamiento y el respaldo de red siguen
   activos) — solo se dejaron de mostrar.
7. **"Done Editing" ya no desaparece mientras se edita un SKU** (commit
   `780b6f15`) — antes, al abrir Replace/Adjust Qty/Remove sobre un ítem,
   el botón "Done Editing" desaparecía y aparecía el panel de edición en
   su lugar; era fácil tocar el botón equivocado por accidente. Ahora
   "Done Editing" se oculta solo mientras ese panel está realmente
   abierto y vuelve al cerrarlo — no compite con los botones Cancel/
   Confirm.
8. **Barra de progreso animada** (commit `780b6f15`) — la barra de avance
   de una orden ahora muestra una cajita que se mueve mientras hay
   trabajo pendiente, y se queda fija cuando la orden está al 100%.
9. **Ship > Waiting ya no pierde órdenes combinadas** (commit `780b6f15`)
   — si una orden combinada tenía una mitad esperando inventario, antes
   podía no aparecer completa en la pestaña Waiting. Ahora si CUALQUIER
   mitad está esperando inventario, la combinación entera aparece ahí.
10. **La dirección de envío en Ship es la del documento, no la genérica
    de la cuenta** (commits `9c32d182`, `25a974be`) — Ship mostraba
    siempre la dirección general guardada para el cliente, que para
    cuentas con varias tiendas/sucursales podía no ser la de ESTA orden.
    Ahora usa la dirección específica que trae el documento de cada
    orden. Y si alguien corrige la dirección a mano en Ship, esa
    corrección ahora sí se guarda ligada a la orden — antes se guardaba
    "flotando" y la orden volvía a mostrar la dirección vieja al
    recargar.
11. **La sesión que se cae ya no deja la app fallando en silencio**
    (commit `7a19448e`) — cuando la sesión expiraba, el nombre de
    usuario podía quedarse mostrando "Unknown" indefinidamente, y subir
    una foto, completar una orden o imprimir labels podían fallar con un
    error genérico sin avisar que había que volver a iniciar sesión.
    Ahora la app se entera cuando la sesión expiró y fuerza el
    re-login automáticamente en vez de quedarse fallando calladamente;
    el nombre de usuario también se recupera solo al volver a la
    pantalla o al desbloquear el teléfono. **Nota para el "short
    version": esto probablemente explica una parte de las fallas de
    "failed to print labels" que Rafael reportó — pendiente de
    confirmar la próxima vez que ocurra (queda como diagnóstico
    agregado, no como causa 100% cerrada; no prometer que "labels ya
    está arreglado" — decir que se agregó el diagnóstico real y una
    causa probable ya corregida).**

## Instrucciones para agy (además de lo de arriba)
1. Leer completo `reports/warehouse-updates/2026-09-18.md` y `.html`
   actuales — son la plantilla de voz Y el contenido que NO se toca.
2. Para cada punto de la lista de arriba, leer su `.md` de tarea en esta
   carpeta (`01-...` a `10-...`, los que existan — el punto 1 y algunos
   de los de Live Board no tienen `.md` propio, usar el commit citado
   con `git show <hash> --stat` y `git show <hash>` si hace falta más
   detalle) para no inventar ningún detalle técnico al traducirlo.
3. Escribir los puntos 5 en adelante (continuando la numeración después
   del 4 que ya existe) al FINAL de `reports/warehouse-updates/
   2026-09-18.md`, en el mismo estilo Markdown que los 4 existentes.
4. Reflejar EXACTAMENTE lo mismo en `reports/warehouse-updates/
   2026-09-18.html`: mismos `<h3>`/`<p>`/`<div class="screen|was">`/
   `<p class="note">`, insertados antes del `<p class="foot">` final. NO
   tocar el `<style>` del `<head>` — ya están todas las clases que hacen
   falta.
5. Actualizar `<div class="short">` ("The short version") arriba del
   `.html` (y su equivalente en el `.md`) agregando 2-3 líneas más con
   los cambios de más impacto para alguien que solo lee eso: sugerido —
   contenedores fuera de pickup, pallet count arreglado, y la sesión/
   "Unknown" arreglada. Mantener el numerado consecutivo con lo que ya
   hay.
6. NO tocar ningún otro archivo de `reports/warehouse-updates/` (otras
   fechas) ni nada fuera de esta carpeta y de `reports/warehouse-updates/
   2026-09-18.{md,html}`.
7. **"Lanzar" en este repo es commitear y pushear a `main`** (el build
   corre el `prebuild` que regenera `public/` e `index.json` solo — no
   hay paso de deploy manual, ver Contexto ya conocido). Al terminar de
   escribir:
   ```
   git add reports/warehouse-updates/2026-09-18.md reports/warehouse-updates/2026-09-18.html
   git commit -m "docs(whats-new): 18 sep — contenedores, pallets, carrier, ship-to y sesión"
   git push
   ```
   Si el pre-commit hook de prettier se queja del `.md`, correr
   `npx prettier --write reports/warehouse-updates/2026-09-18.md` y
   reintentar el commit — no usar `--no-verify`.
8. Actualizar el Estado de este archivo a `IMPLEMENTADO` y la fila 11 de
   `00-INDEX.md` cuando el push haya sido exitoso.

## Plan de fix propuesto
(no aplica — esto es contenido, no código; ver "Instrucciones para agy")

## Autocorrección
(ninguna todavía)
