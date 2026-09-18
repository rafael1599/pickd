# PRD — Filtro Cancelled en Ship y Restore Order con inventario

> Estudio escrito por `agy` (Gemini 3.1 Pro) el 18 sep 2026 con el contrato de `pickd-product-designer`,
> revisado contra producción: se corrigieron la posición del CANCELLED PALLET, las cifras de los dos
> casos de verificación y el borrado de una tabla append-only. Pendiente de las ❓ de Rafael.

1. **Contexto y problema**
   El 17 sep 2026, al cancelar un grupo combinado en Ship, solo se cancelaba la orden "ancla", dejando unidades a la deriva y la interfaz sin reflejar el estado real. Esto se arregló con `cancel_combined_order` y la tabla `cancelled_order_groups`.
   El dolor actual de Rafael es doble: en la vista Ship no hay forma de buscar o filtrar las órdenes canceladas, y si una orden se canceló por error, no hay forma de deshacerlo limpiamente desde ahí. Existe `restore_cancelled_order`, pero solo devuelve a `active` y es "inventory-neutral", lo cual era válido cuando cancelar no tocaba inventario. Hoy, al cancelar una orden completada, el stock se deposita en el `CANCELLED PALLET`. Un "undo" real debe tomar el stock del pallet y devolver el estado a `completed`. Además, el `restore_cancelled_order` actual es usado por el Board y no debe romperse.

2. **Objetivo**
   Permitir a la estación de Ship auditar las cancelaciones viendo las órdenes canceladas, y proveer un botón de deshacer (Restore) que recupere el estado previo (incluyendo grupos combinados) y devuelva el inventario a su sitio de forma atómica.
   **Métrica:** 0 unidades varadas en el `CANCELLED PALLET` por errores de cancelación, y grupos combinados que pueden ser restaurados a un solo click.

3. **Conceptos**

- **CANCELLED PALLET:** el pallet del área de envío donde esperan las unidades de una orden cancelada. En el recorrido va **después de ROW 43** (`picking_order` 420) y su `pick_priority` es `first`: se coge de ahí antes que de cualquier estante.
- **Combined Cancelled Order:** Reconstrucción en memoria de un grupo combinado a partir del historial inmutable guardado en `cancelled_order_groups` en el instante de su cancelación.

4. **El gesto**
1. En la barra de Feed de Ship, se hace check en `Cancelled (n)`.
1. Las tarjetas canceladas aparecen en la lista (grises, con estado `CANCELLED` y números tachados o en 0).
1. El usuario entra en la tarjeta de la orden cancelada (sea simple o combinada).
1. Abre el menú `⋯` y pulsa **Restore Order** (o un botón de acción rápida de flecha de retorno en la lista).
1. Sin pedir confirmación adicional ni razón, la orden (y todas sus hermanas si era un grupo) vuelve a su estado anterior. Un toast confirma: `Restored order to completed`.

1. **Modos y herramientas**

- **Filtro Cancelled:** Una casilla hermana a la de `Shipped (n)`. Filtro no excluyente: marcar ambos muestra enviadas y canceladas.
- **Buscador:** Si se teclea un número de orden exacto que está cancelado, la búsqueda lo encuentra y fuerza la visualización (encendiendo la casilla automáticamente).
- **Herramienta visual:** Los 4 grandes números (Pallets, Bikes, Parts, Lbs) de una orden cancelada en Ship se atenúan al 30% y se tachan, comunicando visualmente que esos bultos ya no están preparados.

6. **Datos**

- Se preserva `restore_cancelled_order` sin cambios por su consumidor en el Board.
- Nueva RPC `undo_cancel_order(p_list_id, p_user_id)` y su contraparte de grupos `undo_cancel_combined_group(p_group_id, p_user_id)`.
- Si la orden estaba `completed`, la RPC ejecuta DEDUCTs desde el `CANCELLED PALLET` por cada línea y marca de nuevo a `completed`.
- Si estaba en estado abierto, simplemente la retorna a su estado.
- Reconstruye el grupo usando `cancelled_order_groups`. ❗ **`cancelled_order_groups` es append-only** (sin políticas de UPDATE ni DELETE, como `sku_canonical_renames` y `sublocation_relabels`): la fila **no se borra**, se marca como deshecha o se deja tal cual y el grupo nuevo se crea aparte. Borrarla tiraría el único registro de quién formaba esa combinación.

7. **Pantalla**
   Desktop (1400 px):

```text
ORDERS           [ Search... ]        ☑ Shipped (10)  ☑ Cancelled (2)

| 881415 / 881373 / 881347                      | [ ⟲ Restore ]
| CANCELLED  ·  JAX OUTDOOR                     |
| --------------------------------------------- |
|  ~~2~~ Pallets     ~~8~~ Bikes     ~~0~~ Parts|
```

Phone (430 px) - `ShipFeedCard`:

```text
[ | ] 881415 / 881373       [ ⟲ ]
[ | ] CANCELLED · JAX
```

(La franja de estado izquierda es gris, y el botón de camión es reemplazado por la flecha de Restore).

8. **Fases**

- **P1:** Interfaz de visualización. Casilla de filtro Cancelled, soporte para leer y reconstruir grupos cancelados, visualización atenuada de los totales.
- **P2:** Lógica del Undo. Las RPCs nuevas, el botón en el menú ⋯, y la acción rápida en la tarjeta. Gestión de errores de stock faltante.

9. **Casos de verificación**

- **1. Cancelada en grupo** (forma real del grupo JAX del 17 sep: 881415 con 3 u, 881347 con 4 y 881373 con 1, **8 en total**; aquellas fueron a RETURN TO STOCK porque el cambio es posterior). Se cancela el grupo entero al CANCELLED PALLET y un usuario pulsa Restore: la base registra **8 DEDUCT sobre `CANCELLED PALLET`**, el grupo se recompone y cada orden vuelve al estado que tenía, que `cancelled_order_groups.members[].status_before` conserva.
- **2. El caso feo (stock faltante):** #881416 cancelada — **5 unidades** al CANCELLED PALLET. Otro picker necesita una de esas bicis y se la lleva del pallet, precisamente porque es prioridad `first`. Alguien pulsa Restore: la base ve que ya no están las 5 y la restaura a `active` en vez de `completed`, con la nota diciendo cuántas faltaban.

10. **❓ Preguntas**
1. ❓ ¿El filtro Cancelled suma resultados o reemplaza la lista? (Default: Suma, igual que Shipped).
1. ❓ ¿Si se busca el número exacto, salta el filtro de Cancelled solo? (Default: Sí, igual que con Shipped).
1. ❓ ¿Los cuatro contadores se muestran en ceros o tachados? (Default: Tachados y con opacidad al 30%, para recordar qué tamaño tenía la orden).
1. ❓ ¿El botón Restore de la lista pide confirmación? (Default: No, es una reversión a un click).
1. ❓ ¿La RPC nueva se independiza por completo de `restore_cancelled_order`? (Default: Sí, para aislar el flujo de Ship del hack que usa el Board).
1. ❓ ¿Qué pasa si al restaurar de `completed` las bicis ya no están en CANCELLED PALLET? (Default: Se restaura a estado `active` con una nota advirtiendo de la falta).

1. **Riesgos**

- **Stock robado del CANCELLED PALLET:** Como este pallet es de prioridad "first" (antes que los estantes), si se demora el undo, el stock puede haberse movido físicamente a otra orden.
- **Mitigación:** La RPC evalúa el inventario del pallet durante el undo. Si no alcanza, degrada el estado a `active` y muestra un toast: "Restored to active (units were no longer in CANCELLED PALLET)", forzando al usuario a volver a ubicar la orden.
