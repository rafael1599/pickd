# PRD: El envío como entidad — `shipments` en vez de la orden ancla

**Estado:** Fases 1–3 en prod (26 sep 2026: `20260926174211`, `20260926184229`); 4–6 por hacer · **Fecha:** 2026-09-26 · **Backlog:**
idea-230 · **Relacionado:** `ship-pallet-truth.md` (su paso 4 se apoya en esto), idea-229 (el
watchdog como sensor, fuera de este cambio), bug-032, bug-045 · **Análisis:**
`label-bench/envio/01-analisis-agy.md` (verificado; dos errores corregidos aquí, §6)

---

## 1) El problema

Una combinada tiene hechos que son **del envío físico** —cuántas tarimas y lo que dijo el piso de
cada una, medidas, fotos, carrier, load #, dirección de entrega, enviado sí/no, peso— y no hay dónde
ponerlos. Se cuelgan de una de las órdenes, la «ancla», y cada pantalla la elige a su manera: la más
vieja (Ship), la primera por posición (board), la que se abrió (Double Check).

Medido en prod (57 combinadas `general` de los últimos 90 días):

| Síntoma                                                                                  | Combinadas |
| ---------------------------------------------------------------------------------------- | ---------: |
| `pallets_qty` repartido en más de una hermana (Ship suma y duplica)                      |         11 |
| Fotos distintas entre miembros (el carrito copia las de la ancla encima de las hermanas) |         37 |

Y los arreglos que existen sólo por no tener el envío: poner `pallets_qty = 0` en las hermanas
(`ShipScreen.tsx` ~2222, `usePickingActions.ts` ~409), borrar el load # de las hermanas
(`clearNonAnchorLoadNumbers`, `useOrderGroups.ts` ~19-40, por el UNIQUE global de
`picking_lists.load_number`, bug-032), copiar el carrier a todas, `pallet_dims` sólo en la ancla
(DCV abierto en una hermana escribe donde Ship no lee).

**`group_id` hace dos trabajos que no son el mismo.** El lote FedEx es de recogida: 209 de los 218
grupos FedEx con más de una orden **mezclan clientes** (hasta 5); cada orden viaja con su guía a su
destino. El grupo `general` es un envío. Por eso el envío no puede ser `order_groups`.

## 2) La decisión

**Una tabla `shipments`; toda orden tiene un envío (`picking_lists.shipment_id`), vaya sola o
combinada. `order_groups` / `group_id` se queda sólo como lote de trabajo** (FedEx, Add-On en curso).

| ❓                                                    | Decisión (Rafael, 26 sep 2026)                                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Toda orden nace con su envío                          | **Sí**, lo crea un trigger `BEFORE INSERT`                                                                     |
| En un lote FedEx, un envío por orden                  | **Sí**                                                                                                         |
| Combinar órdenes con **direcciones distintas**        | **Un modal pide elegir explícitamente la dirección** que se queda. Nunca gana una en silencio                  |
| Load # y tracking en FedEx                            | **FedEx no lleva load # ni tracking** en PickD: esas columnas quedan vacías en sus envíos y Ship no las enseña |
| Sincronizar las columnas viejas durante la transición | **Sí**, por trigger, ~30 días (§5)                                                                             |
| Un envío = un load #                                  | **Sí**, UNIQUE parcial en `shipments`                                                                          |
| Al combinar, fotos y medidas                          | Las **fotos se juntan**; lo que dijo el piso de cada tarima **se reinicia**, porque las tarimas se rearman     |
| Un envío con clientes distintos                       | **No** para combinar desde ahora; los 3 grupos `general` de hoy que mezclan clientes se migran tal cual        |
| El watchdog                                           | **Fuera.** No cambia ni una línea (idea-229 lo simplifica aparte)                                              |

## 3) Esquema

```sql
create table public.shipments (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  customer_id        uuid references public.customers(id),
  ship_to_address_id uuid,
  transport_company  text,
  load_number        text,          -- null en FedEx
  pallets_qty        integer not null default 0,
  total_weight_lbs   numeric,
  pallet_dims        jsonb not null default '[]'::jsonb,  -- lo que dijo el piso, por tarima
  pallet_photos      jsonb not null default '[]'::jsonb,
  is_shipped         boolean not null default false,
  shipped_at         timestamptz,                         -- hoy no existe; se usa updated_at
  metadata           jsonb not null default '{}'::jsonb   -- legacy_group_id, members al migrar
);
create unique index shipments_load_number_key on public.shipments (load_number) where load_number is not null;
alter table public.picking_lists add column shipment_id uuid references public.shipments(id);
```

RLS como `picking_lists` (autenticados leen y escriben), `shipments` en la publicación de realtime,
índices por `customer_id`, `is_shipped`, `updated_at` y `picking_lists.shipment_id`. Las fotos del
envío se escriben con `append_shipment_photo` / `remove_shipment_photo`, atómicas como las de hoy.

## 4) Lo que hace cada acción

- **Crear orden** (watchdog, New Order): el trigger crea su envío con el cliente, la dirección y el
  carrier de la orden.
- **Combinar** (Ship «Combine with», board, Add-On): el envío que queda es el de la orden más vieja;
  las demás apuntan a él y sus envíos se vacían. Si las direcciones difieren, **el modal** (§2). Las
  fotos se juntan; `pallet_dims` se reinicia; si más de una trae load #, el modal también pregunta
  cuál queda. Sólo órdenes del mismo cliente.
- **Descombinar**: la orden que sale recibe un envío nuevo con su cliente, su dirección y el carrier
  del envío; sin fotos, sin tarimas. Lo que se tomó con ella dentro se queda en el envío que sigue.
- **Cancelar**: la orden cancelada sale de su envío como en descombinar. Un envío sin órdenes vivas
  no se muestra en Ship; no se borra (historia).
- **Enviar**: `is_shipped` y `shipped_at` en el envío, una sola escritura.

## 5) Migración, aditiva y por fases

1. **Esquema + trigger de alta** + funciones atómicas de fotos. Nada lee todavía de `shipments`.
2. **Backfill**, validado antes en prod con ROLLBACK: un envío por grupo `general`/`pickup` (los
   hechos de la ancla, las fotos juntas sin repetir, `pallets_qty` = la suma de hoy) y uno por cada
   orden restante. **Se une por `picking_lists.id`**, no por `order_number`: en prod hay 30 números
   repetidos (2.058 filas, 2.028 números).
3. **Espejo de transición (~30 días)**: triggers en las dos direcciones para que un cliente con el
   build viejo en caché siga viendo lo mismo — un cambio en `shipments` se copia a la ancla (y los
   ceros en las hermanas, como hoy); un cambio de dirección o carrier en una orden **sola** se copia a
   su envío (así el watchdog no se toca). Se diseña y se prueba aparte; es la parte delicada.
4. **Lectores**: Ship, Double Check (`usePalletDims` pasa de `listId` a `shipmentId`), board y
   carrito leen del envío; lo viejo queda de respaldo si falta `shipment_id`.
5. **Escritores**: guardan en el envío. Se borran los ceros en hermanas, `clearNonAnchorLoadNumbers`,
   la copia de fotos del carrito y la sincronización del carrier.
6. **Limpieza**: se quitan los triggers espejo; las columnas viejas se quedan como historia.

Volver atrás en 1–3 es revertir el frontend: las columnas viejas siguen escritas.

## 6) Lo que el análisis dijo y se corrigió

- Su backfill unía por `order_number`: con 30 números repetidos, esas órdenes podían quedar en el
  envío equivocado aunque ninguna quedara «sin envío». Se une por `id`.
- «El watchdog no cambia» es cierto al crear la orden, pero no cubría que después actualice dirección
  o carrier: lo cubre el espejo de la fase 3.

## 7) Cómo encaja con `ship-pallet-truth.md`

Los pasos **A y 0–3** no cambian: son cálculo puro y no dependen de dónde se guarden los hechos. El
**paso 4** («una sola forma de juntar hermanas») pasa a ser **agrupar por `shipment_id`**, y
`pallet_dims` (D2 de ese PRD) vive en `shipments`. Orden: A → 0 → 1 → 2 → 3 en paralelo con las
fases 1–3 de aquí; el paso 4 y las fases 4–5 juntos.

## 8) Riesgos

- **El espejo de la fase 3 es la parte fácil de romper**: dos triggers que escriben en direcciones
  opuestas pueden ciclar. Se prueba con ROLLBACK en prod antes de aplicarlo, con un caso por
  escritor de hoy.
- **Ship lee de otra forma**: la consulta pasa a traer envíos con sus órdenes; la lentitud de
  idea-226 se mide antes y después.
- **Órdenes viejas sin `shipment_id`** si el backfill falla a medias: el respaldo de la fase 4 las
  sigue leyendo; el backfill corre en una transacción.
