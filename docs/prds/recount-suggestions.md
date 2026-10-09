# Recount sugerido — estudio (idea-263)

> 9 oct 2026. Rafael: «AS400 no es la verdad absoluta y no debe usarse para reconciliar. Necesito
> una manera de sugerir recount al personal y agregar estos a esa manera: 03-4623BL, 03-4635MN,
> 03-4637MN, 03-4638RD y 03-4639MN».

## Lo que ya existe

- **Stock Count** (menú → Stock Count, `/stock-count`, `StockCountScreen.tsx`): fase 1 arma la lista
  (By SKU / By Row, con píldoras Stale · Waiting · No Subloc), fase 2 es el recorrido de
  verificación, fase 3 el resumen. Guarda en `cycle_count_sessions` + `cycle_count_items`
  (`expected_qty`, `counted_qty`, `variance`, `status`).
- **Lo que falta:** nadie puede dejar un SKU **pendiente de contar para otro**. La lista vive sólo
  mientras alguien la arma.

## Propuesta: una cola, una tarjeta, un botón

1. **Tabla `recount_requests`** (aditiva): `sku`, `location` (nula = todas sus filas), `reason`
   (texto corto en inglés, lo lee el piso), `requested_by`, `created_at`, `resolved_at`,
   `resolved_by`, `cycle_count_item_id`. Una sola abierta por (sku, location).
2. **Se cierra contando, nunca por reloj:** un trigger en `cycle_count_items`, al pasar a `counted`
   o `verified`, cierra las abiertas de ese SKU (y de esa ubicación si la tiene). Consistente con
   «nada se resuelve por reloj» (8 oct).
3. **Dónde la ve el personal:** en Stock Count, fase 1, arriba de todo, una tarjeta
   **`RECOUNT 5`** con los SKUs, su ubicación y el motivo, y **un botón: `Add all`** que los mete en
   la lista. Nada más cambia en la pantalla.
4. **Aviso:** la entrada de Stock Count en el menú lleva el número (`5`) mientras haya abiertas.
5. **Quién la llena:** al principio, yo por SQL con tu sí (estos 5 son los primeros). Más adelante
   un `Ask for recount` detrás del tap de la tarjeta de Stock (la tarjeta no cambia, regla del 7 oct).

## ❓ Para Rafael (con respuesta por defecto)

1. ❓ ¿Tabla nueva o reusar una sesión `draft` de `cycle_count_sessions` como cola? — **Default:
   tabla nueva**: una sesión es «alguien contando ahora», una petición es «que alguien cuente»; con
   la sesión, cerrar el conteo de otro no cerraría la petición.
2. ❓ ¿Quién puede pedir un recount? — **Default: cualquiera**; se ve quién lo pidió.
3. ❓ ¿El número en el menú? — **Default: sí.**
4. ❓ ¿Agrego también `03-4516BL` (ROW 22, +1 fantasma, nadie lo ha contado) y `06-4284TL`
   (ROW 17, +3)? — **Default: sí**, motivo `Phantom +1 / +3 from auto-cancel (Jul)`.
5. ❓ ¿El `Ask for recount` desde la tarjeta de Stock entra ya o después? — **Default: después**;
   primero que el piso use la cola.
6. ❓ Motivo para los 5 de hoy — **Default: `Written by AS400 sync (Sep 14), never counted`.**

## Lo que no hace

- No escribe cantidades: el conteo sigue siendo el flujo de Stock Count de hoy.
- No caduca ni se cierra sola por tiempo.
- No usa el AS400 para decidir nada; a lo sumo, el informe de `reconcile-from-as400.mjs --out`
  sugiere candidatos que una persona agrega.

## Costo

Migración (tabla + trigger + RLS como `cycle_count_*`), tipos y Zod, un hook de lectura, la tarjeta
en fase 1 y el número en el menú. Test del trigger y del cierre. Sembrar los SKUs = escritura en
prod, con tu sí.
