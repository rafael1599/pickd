# PRD: Una orden completada dentro de un grupo — combinar, reabrir, esperar, mirar

**Estado:** Estudio, esperando respuestas a las ❓ · **Fecha:** 2026-09-11 · **Autor:** Rafael + PickD
· **Backlog:** se abre al cerrar las ❓ · **Decisiones:** página "Una completada en el grupo"
· **Relacionado:** bug-025 (Combine en `reopened`), bug-026 (la escritura del carrito combinado),
`complete_addon_group`, `reopen_picking_list`, `mark_picking_list_waiting`

---

## 1) Contexto y problema

Rafael (11 sep 2026): _"Al combinar una orden completada con una no completada quiero definir bien lo
que pasa porque actualmente no me deja recoger los items de las que no he completado aún y se
bloquea. Estoy explorando la posibilidad de reabrir órdenes completadas para corregir sus cosas y
activar opciones como marcar como waiting si necesitan add ons o combinarlas manualmente o
simplemente verlas en la vista dcv."_

Pasa **una vez al mes**: 6 grupos desde mayo juntaron una orden ya completada con una abierta —
#879534+#879535 (5 may), #880132+#880144 (10 jun), #880525+#880651 (14 jul), #881042+#881043 (5 ago),
#881301+#881303 (27 ago), #881425+#881474 (10 sep). Los grupos FedEx nunca lo hacen: el agrupado
automático solo pega órdenes abiertas.

De **40 reaperturas**, 21 acabaron en `Reopen cancelled` y 11 en re-completar. La función que existe
para cerrar un Add-On, `complete_addon_group`, **no ha corrido con éxito ni una vez** (0 notas
`[Add-On]` en toda la base): las dos veces que el flujo terminó bien (27 ago, 10 sep) fue por el
camino normal de completar el grupo. Y el 4 ago el intento se canceló a los 48 segundos y el pedido
se arregló fuera de PickD: _"changed adrress from new order 880999 and sent, items are the same"_.

## 2) Objetivo

Que una orden completada pueda estar en un grupo **sin bloquear a nadie**, y que quede dicho, en una
sola frase por caso, qué pasa con cada miembro al recoger, al verificar, al completar y al enviar.

**Métrica:** cero pantallas en solo-lectura por culpa de una hermana completada; cero reaperturas
canceladas por no poder seguir; el Add-On termina dentro de PickD.

## 3) Usuarios

El verificador en Double Check (recoge y marca), la estación de envío (junta lo que viaja junto) y
quien corrige una orden ya cerrada.

## 4) Qué pasa hoy, medido

**Por qué se bloquea.** Completar escribe `checked_by` con quien completó
(`process_picking_list`), y reabrir no lo borra: **1792 de las 1848 órdenes completadas lo llevan**.
Al abrir una orden, el cajón pregunta si _alguna_ hermana del grupo tiene `checked_by` de otra
persona — sin mirar el estado (`PickingCartDrawer.tsx:275-286`). Una completada por otro siempre lo
lleva, así que la orden abierta entra en **solo-lectura**: cada toque en una línea se rechaza con
"You are in view-only mode" (`DoubleCheckView.tsx:254-259`) y el pie se reduce a **Takeover Order**.
Con la misma llave se apagan el escáner, Edit, Waiting, Combine, Ungroup y Cancel. Si la completada
la completaste tú, no pasa nada: por eso unas veces bloquea y otras no.

**Lo que se apaga si el ancla acaba siendo la reabierta.** El modo de sesión sale del ancla
(`usePickingSync.ts:784-790`). En `reopened`: los checks no se hidratan ni se guardan
(`PickingCartDrawer.tsx:185-192`, `:412-413`), el pie cambia a **Cancel Edit / Re-Complete** — no hay
forma de verificar y completar la abierta desde ahí (`DoubleCheckView.tsx:3235`), Edit Order se abre
solo encima de la lista (`:1826-1836`), y la **X pasa a ser "Cancel Edit"**, que disuelve el grupo
entero antes de cancelar (`PickingCartDrawer.tsx:1112-1124`): cerrar la pantalla deshace la
combinación.

**Lo que desaparece.** El Live Board no consulta `reopened` en ninguna de sus dos queries
(`useDoubleCheckList.ts:101` y `:121`), así que en cuanto Combine reabre la completada, esa orden se
cae del tablero y solo se alcanza desde Ship.

**Trampas silenciosas.** `markAsReady`, `releaseCheck` y `returnToPicker` empujan a `double_checking`
a **toda** hermana que no esté completada ni cancelada, reabierta incluida
(`usePickingActions.ts:387-399`, `:717-728`, `:763-774`): la reabierta pierde su estado, el
re-completar por diferencia se convierte en un descuento doble y `complete_addon_group` ya la
rechaza. El **Resume** de waiting hace lo mismo: devuelve a `ready_to_double_check` sin mirar si
estaba reabierta. Y el auto-cancel de 2 h de una reabierta intacta **disuelve el grupo**.

**Lo que ya funciona y no hay que tocar.** El barrido al completar trata bien a cada miembro
(`PickingCartDrawer.tsx:904-909`: la abierta por `process_picking_list`, la reabierta por
`recomplete_picking_list`), la base de datos ya permite marcar waiting en una reabierta
conservándole el estado, y combinar **dos completadas** para enviarlas juntas funciona (hoy mismo,
#881461+#881537 a las 19:54 y #881524+#881466 a las 15:38).

## 5) Conceptos de dominio: combinar es dos cosas distintas

|                         | **Enviar juntas**                                     | **Add-On**                                               |
| ----------------------- | ----------------------------------------------------- | -------------------------------------------------------- |
| Para qué                | Dos pedidos que viajan en el mismo envío              | El cliente añadió cosas a un pedido ya cerrado           |
| La completada           | No se toca                                            | Se reabre para corregirla y cerrarla de nuevo            |
| Al completar la abierta | La completada sigue igual                             | Las dos se cierran juntas                                |
| Stock                   | Nada que descontar en la completada                   | La reabierta descuenta **la diferencia** contra su foto  |
| Hoy                     | Lo hace el board, Ship y el quick group (sin reabrir) | Lo hace Combine del board (reabre) y el picker del cajón |

Hoy los dos caminos comparten un solo gesto y el resultado depende de por dónde entraste. Ese es el
fondo del problema: **el gesto no dice para qué se combina**.

## 6) Requerimientos funcionales

- **R1 · Una orden abierta nunca se bloquea por sus compañeras.** El solo-lectura mira quién tiene
  ahora la orden que abro o una hermana **abierta**; el `checked_by` de una completada es historia,
  no presencia.
- **R2 · Combinar con una completada pregunta para qué**: dos botones, _Enviar juntas_ o _Añadir a
  #X (se reabre)_. Las sugerencias automáticas del board y de Ship son siempre _enviar juntas_.
- **R3 · Enviar juntas:** no se reabre nada. La completada entra al grupo como está, no aporta líneas
  al carrito ni al progreso, la tarjeta la muestra como completada, y al completar la abierta la
  completada no se toca. Ship enseña las dos.
- **R4 · Add-On:** se reabre la completada y, mientras tanto, **la pantalla sigue siendo la de
  verificación**: la orden abierta se recoge y se marca igual, y las líneas de la reabierta se ven y
  se editan. El modo lo decide el grupo, no el ancla. Al completar, cada miembro por su camino, que es
  lo que ya hace el barrido.
- **R5 · Waiting desde una reabierta** (esperando add-ons): permitido, conserva `reopened`, la saca
  del tablero de trabajo a la zona Waiting con su razón, y **Resume la devuelve a `reopened`**, nunca
  a `ready_to_double_check`.
- **R6 · Ver una completada en Double Check**: se abre en solo-lectura, con sus líneas y sus notas, y
  dos salidas: **Reopen** y cerrar.
- **R7 · Una reabierta se ve en el Live Board**, marcada como reabierta, en vez de desaparecer.
- **R8 · Nada quita `reopened` por detrás**: `markAsReady`, `releaseCheck`, `returnToPicker` y el
  Resume de waiting saltan a las hermanas reabiertas.
- **R9 · Cerrar la pantalla no deshace la combinación**: cancelar la reapertura y separar el grupo son
  dos decisiones distintas, con dos botones distintos.
- **R10 · El auto-cancel de 2 h** cierra la reapertura pero **no disuelve un grupo deliberado**.

## 7) ❓ Preguntas abiertas — cada una con lo que se hará si la respuesta es "ok"

- **❓Q1 · ¿La pregunta al combinar?** Default: sí, dos botones (_Enviar juntas_ / _Añadir a #X_), y
  las sugerencias automáticas entran como _enviar juntas_ sin preguntar.
- **❓Q2 · ¿Combinar con una completada ya enviada (`is_shipped`)?** Default: no; primero hay que
  desmarcar el envío, con la misma pregunta que ya hace Cancel ("¿nunca se llegó a enviar?").
- **❓Q3 · ¿Hasta cuándo se ofrece una completada para Add-On?** Default: las de las últimas 24 h en
  el picker (como hoy), y cualquiera desde Ship.
- **❓Q4 · ¿Quién puede reabrir?** Default: cualquiera del equipo, como hoy.
- **❓Q5 · ¿Waiting en una reabierta la saca del tablero?** Default: sí, a la zona Waiting, y al
  volver sigue reabierta.
- **❓Q6 · ¿Desde dónde se ve una completada en Double Check?** Default: desde la zona Completed del
  tablero y desde Ship.
- **❓Q7 · Si la abierta se completa estando en un Add-On, ¿qué pasa con la reabierta?** Default: se
  cierran juntas (es lo que hace hoy el barrido).
- **❓Q8 · ¿Qué pasa con el `complete_addon_group` que nunca corrió?** Default: se retira y se deja el
  camino que sí funciona (el barrido por miembro); una función que nadie ejecuta es una regla que
  nadie cumple.

## 8) Criterios de aceptación

1. **Enviar juntas (caso real de hoy):** #881461 y #881537, completadas por otra persona a las 17:31,
   se combinan a las 19:54. Ninguna pantalla queda en solo-lectura, Ship las muestra juntas, y ninguna
   de las dos cambia de estado.
2. **Add-On con la abierta recogiéndose (caso del 10 sep):** #881425 completada + #881474 abierta. Al
   abrir el grupo: se marcan las líneas de #881474, se editan las de #881425, y el pie permite
   completar. Al completar: #881474 descuenta lo suyo y #881425 descuenta **solo la diferencia** (0 si
   no se cambió nada).
3. **Add-On corto (caso del 27 ago):** #881301 + #881303 se cerraron en 6 minutos. El flujo nuevo no
   puede tardar más pasos que ése.
4. **Esperando add-ons (caso del 29 jul):** #880950 marcada "Waiting for add-ons" desde reabierta:
   sale del tablero, vuelve con Resume **todavía reabierta**, y su foto de líneas sigue intacta.
5. **Mirar sin tocar:** abrir una completada en Double Check enseña líneas y notas, no deja marcar
   nada y ofrece Reopen.
6. **Ninguna de las dos se cierra sola:** cerrar la pantalla de una reabierta combinada deja el grupo
   como estaba.

## 9) Riesgos y supuestos

- **Doble descuento**: cualquier camino que le quite `reopened` a una orden con foto guardada la
  manda por `process_picking_list`, que descuenta todo otra vez. R8 es el que lo cierra.
- **`checked_by` es historia y presencia a la vez.** R1 lo separa sin migración: se mira el estado
  junto a la llave. Si algún día hace falta, `checked_by` de una completada podría vaciarse, pero eso
  borraría quién la verificó, que es dato de auditoría.
- Un grupo `fedex` con una reabierta dentro no tiene camino de Add-On (la RPC solo acepta `general`).
  Con ❓Q8 resuelto, el barrido por miembro lo cubre igual.
