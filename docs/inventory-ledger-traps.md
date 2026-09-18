# Trampas del libro de inventario

> Lo que costó descubrir el **17 sep 2026**, auditando cancelaciones y órdenes reabiertas contra
> producción — mías y del agente que las refutó. Vive en `docs/` a propósito: **no ocupa contexto
> hasta que alguien lo abre**, a diferencia de `CLAUDE.md`.

Cada trampa dice si **se arregla en el código** o si **solo se puede tener cuidado**, porque
arreglarla rompería algo que sí funciona.

| #   | Trampa                                                                            | Estado        |
| --- | --------------------------------------------------------------------------------- | ------------- |
| 1   | `is_reversed` no significa «se devolvió»                                          | ⚠️ cuidado    |
| 2   | `updated_at` no marca toda escritura; `last_activity_at` sí                       | ⚠️ cuidado    |
| 3   | `shipping_type` cambia sin dejar rastro                                           | 🔧 mejorable  |
| 4   | El «efecto neto» solo sirve filtrado                                              | ⚠️ cuidado    |
| 5   | Un `completed_snapshot` en una orden `completed` es una huella de doble descuento | 🔧 arreglable |
| 6   | El estado es un portador frágil de «esto ya se descontó»                          | 🔧 arreglable |

---

## 1. ⚠️ `is_reversed` no significa «se devolvió»

`cancel_completed_order` marca `is_reversed = true` en los DEDUCT que revierte, así que la bandera
dice **«esta RPC lo deshizo»**, no «estas unidades volvieron». Una devolución hecha a mano escribe
ADD compensatorios y **no toca la bandera**.

**Cómo mordió:** el 17 sep informé de que #879837, #878452 y #878471 —canceladas antes de que
existiera la restauración— nunca devolvieron nada, porque tenían 0 logs con `is_reversed`. Falso
para la primera: se reparó a mano el **22 may 2026** (`manual: order-879837-restore
(Claude+Rafael)`), 9 ADD, **neto 0**. Las otras dos sí siguen abiertas: **878452 (−17)** y
**878471 (−1)**.

**La señal buena es el neto**, que cuenta cada escritura real:

```sql
select coalesce(sum(quantity_change),0)
from inventory_logs
where list_id = :id and action_type in ('DEDUCT','ADD');
```

**Por qué no se «arregla»:** que una reparación manual marcara la bandera cambiaría lo que la
bandera significa, y el historial viejo seguiría igual. Lo que sí vale: **toda reparación a mano
lleva `performed_by` con prefijo `manual:` y el nombre de quien la decidió**, como hizo la de mayo.
Eso es lo que la hace encontrable.

## 2. ⚠️ `updated_at` no marca toda escritura; `last_activity_at` sí

El trigger `update_picking_list_activity` (BEFORE UPDATE en `picking_lists`) pone **solo**
`last_activity_at = NOW()`. `updated_at` lo escribe quien hace el UPDATE, si se acuerda. Así que una
escritura de un trigger —que cambia una columna y nada más— **deja `updated_at` intacto**.

**Cómo mordió, en las dos direcciones:** el agente refutador dató el cambio de carrier de #881415
por su `updated_at` (14:59:58) y concluyó que nadie la había tocado después. Pero su
`last_activity_at` es **15:59:43**: su fila se escribió una hora más tarde, justo cuando #881373
salió de su grupo (nota de las 15:59:44).

**Para fechar un cambio que nadie registró, `last_activity_at` es la única huella.** No se toca el
trigger: `updated_at` ordena la columna Shipped y «lo enviado hoy» en Ship, y moverlo con cada
escritura de trigger cambiaría esas pantallas.

## 3. 🔧 `shipping_type` cambia sin dejar rastro

Ninguna tabla registra quién ni cuándo cambió el carrier de una orden. Lo cambian personas (Ship),
la clasificación automática y `reevaluate_shipping_type_on_ungroup`. Cuando el 17 sep hubo que
demostrar que un trigger había cambiado dos órdenes, **no había nada que consultar**: se sostuvo con
`last_activity_at`, con una lectura anterior guardada por casualidad y con un experimento sobre
filas clonadas.

**Mejorable:** es la clase de dato que ya tiene precedente de auditoría append-only en este repo
(`sublocation_relabels`, `sku_canonical_renames`, `cancelled_order_groups`). Mientras no exista, una
afirmación sobre _cuándo_ cambió un carrier es una inferencia y hay que decirlo.

## 4. ⚠️ El «efecto neto» solo sirve filtrado

Comparar `sum(quantity_change)` de los logs de una orden contra la suma de sus `pickingQty` parece
un detector universal de descuentos mal hechos. **No lo es.** Corrido sobre toda la base el 17 sep:

| Dirección          | ¿Tiene snapshot? | Órdenes | Unidades          |
| ------------------ | ---------------- | ------- | ----------------- |
| descuento de más   | **sí**           | 7       | **35** ← la señal |
| descuento de más   | no               | 10      | 123               |
| descuento de menos | no               | 58      | 440               |

**Ruido 15× la señal.** Lo que lo ensucia, comprobado caso por caso:

- **`system: cancel-undone`** — el descuento que escribe deshacer una cancelación. Real, no un doble
  descuento (#881420).
- **`system: cancel-restore`** — ADD de órdenes canceladas desde un estado abierto (22 registros).
- **`system: edit-remove` / `edit-add-prepicked`** — se compensan entre sí si están emparejados.
- **`system: pick`** — descuenta durante el recogido, no al completar; convive con el DEDUCT humano.
- **`pickSplit`** — una línea partida entre dos ubicaciones son **dos DEDUCT legítimos** del mismo
  SKU (#881578: ROW 42 + RETURN TO STOCK).
- **Órdenes viejas cuyos `items` cambiaron después de descontarse** — el array de hoy no describe lo
  que se descontó entonces (#880988: 10 pedidas, −76 en los logs).

**Se usa siempre con un filtro que aísle la clase que se busca** (la trampa 5 es uno), y nunca como
censo general.

**Lo que queda abierto:** esas **123 unidades en 10 órdenes sin snapshot** nadie las ha mirado.
Pueden ser otro bug o pueden ser ruido; hoy no se sabe.

## 5. 🔧 Un `completed_snapshot` en una orden `completed` es una huella de doble descuento

Al reabrir una orden se guarda `completed_snapshot`. **`recomplete_picking_list` (el camino de
delta) lo borra al terminar; `process_picking_list` (el camino normal) ni lo mira.** Así que:

```sql
select order_number from picking_lists
where status = 'completed' and completed_snapshot is not null;
```

son órdenes que se completaron **sin pasar por el delta** — y, si tenían logs, descontaron todo dos
veces. El 17 sep: 10 filas, 7 con descuento de más, 35 unidades.

Es el único detector limpio que se encontró. Sirve como **prueba después de cualquier arreglo**: si
la lista crece, el arreglo no cerró el agujero.

## 6. 🔧 El estado es un portador frágil de «esto ya se descontó»

`process_picking_list` se niega a procesar una orden **`reopened`**, y ahí acaba su defensa. Pero el
estado lo puede cambiar cualquiera: `markAsReady` arrastraba a las hermanas de grupo a
`double_checking` excluyendo `completed` y `cancelled` **pero no `reopened`**, y con eso la orden
llegaba a completarse sin la marca — con su snapshot intacto, que nadie leía.

**La regla que el código debe respetar: lo que dice «esta orden ya salió del estante» es el
snapshot, no el estado.** El estado es de la pantalla; el snapshot es del libro.
