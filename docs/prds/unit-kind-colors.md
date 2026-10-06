# Cada tipo de unidad con su color (idea-251)

Estudio, 6 oct 2026. Construido el mismo día (ver Decisiones). Rafael, 5 oct: «algún tipo de diferenciación
visual de color o similar para los distintos tipos que tenemos (fedex returns, s/d, photo, new,
etc)». 6 oct: «elaboremos idea-251».

## 1. Las cifras (prod, 6 oct 2026)

| Tipo (`unit_kind`) | SKUs  | Con stock | Unidades | Líneas en órdenes (90 d) |
| ------------------ | ----- | --------- | -------- | ------------------------ |
| `new`              | 2.318 | 2.063     | —        | 2.414 (788 órdenes)      |
| `sd`               | 191   | 112       | 192      | **42 (37 órdenes)**      |
| `photo` (PH)       | 55    | 35        | 36       | **5 (4 órdenes)**        |
| `return`           | 64    | 61        | 62       | 0                        |

**Una de cada 21 órdenes lleva una S/D o una PH.** Ahí un tipo confundido es un pick equivocado:
una S/D sale como nueva o al revés.

## 2. Lo que enseña hoy cada pantalla

| Pantalla                      | Nueva | S/D                                      | PH                       | Devolución                 |
| ----------------------------- | ----- | ---------------------------------------- | ------------------------ | -------------------------- |
| Tarjeta de Stock              | —     | el serial entre paréntesis, nada más     | sólo el ` PH` del nombre | chip morado «FedEx return» |
| Ficha (item card)             | NEW   | baldosa NEW / S/D y el `#n`              | chip negro PH            | chip negro RET             |
| Filters → Condition           | New   | Scratch & Dent                           | PH                       | Return (todos en gris)     |
| Double Check, línea de orden  | —     | **el serial en lugar del SKU, sin chip** | **nada**                 | —                          |
| Double Check, aviso «Not new» | —     | «S/D» en texto                           | «PH» en texto            | «FedEx return» en texto    |

Cuatro pantallas lo dicen de tres formas distintas. **Donde más importa, la línea de la orden en
Double Check, no lo dice nadie**: una S/D sólo se reconoce porque sale un serial donde iría un SKU.

## 3. Los colores que ya tienen dueño

Un color nuevo no puede chocar con uno que ya significa algo:

| Color         | Hoy significa                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| Morado        | **Envío FedEx**: franja y badge FDX del board, `OrderRowCard`, cabecera de tarima en Double Check, Ship      |
| Ámbar         | **Cambio sin guardar** (ficha), **casilla del ROW** (badge de la tarjeta de Stock), avisos, tarima bloqueada |
| Rojo          | Error, sin stock, borrada                                                                                    |
| Verde         | Comprobada, Regular en el board                                                                              |
| Violeta claro | La cantidad en la ficha                                                                                      |

**La sugerencia del backlog (S/D ámbar) choca:** en la tarjeta de Stock el ámbar ya es la casilla
(`C`), justo al lado del SKU, y en la ficha el ámbar es «sin guardar».

## 4. La idea

**Un chip con texto, un color por tipo, una función para toda la app.** La nueva no lleva marca:
es lo normal y son 2.063 SKUs.

```
 S/D   naranja   (S/D)
 PH    celeste   (PH)
 RET   morado    (RET)       ← FedEx, como ya es hoy
```

El color nunca va solo: el chip siempre dice el tipo con letras, para quien no distingue colores y
para la etiqueta impresa, que es en blanco y negro.

```
Tarjeta de Stock                        Double Check, línea de orden
┌─────────────────────────────┐        ┌──────────────────────────────────┐
│ ROW 12                      │        │ [foto] [S/D] Y21G006259      1   │
│ [S/D] 01-0368XE (Y21G00…)  1│        │        Taxi ST 19" Kiwi S/D      │
│ Taxi ST 19" Kiwi S/D        │        └──────────────────────────────────┘
└─────────────────────────────┘
```

## 5. Requisitos

1. **Un solo motor:** `unitKindStyle(kind)` en `src/utils/unitKind.ts` devuelve la etiqueta y las
   clases (fondo, texto, borde), con un `UnitKindChip` en `src/components/ui/`. Nadie escribe
   colores de tipo a mano. Un test fija la tabla.
2. **Tarjeta de Stock:** el chip sustituye al «FedEx return» morado de hoy y aparece también en S/D
   y PH, en el mismo sitio (encima del SKU). El dato ya llega: `search_inventory_with_metadata`
   devuelve `unit_kind`.
3. **Ficha:** el chip PH / RET negro de la etiqueta pasa a su color. En una S/D, la etiqueta lleva el
   chip S/D (la baldosa NEW / S/D se queda como interruptor).
4. **Filters → Condition:** cada opción con un punto de su color.
5. **Double Check:** chip delante del SKU (o del serial) de una línea S/D o PH. Hay que añadir
   `unit_kind` a la lectura de `sku_metadata` de la orden (`cartSkuMeta`). El aviso «Not new» usa el
   mismo chip en lugar del texto.
6. **Lista del picker (`PickingCartDrawer`):** el mismo chip en la línea.

## 6. Casos de verificación

| #   | Caso                                          | Resultado esperado                                                            |
| --- | --------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | Stock, filtro Return                          | 61 tarjetas con chip morado RET; ninguna otra marca                           |
| 2   | Stock, buscar `01-0368XE`                     | chip naranja S/D, el serial entre paréntesis como hoy                         |
| 3   | Stock, filtro PH                              | 35 tarjetas con chip celeste PH                                               |
| 4   | Stock, cualquier bici nueva                   | sin chip                                                                      |
| 5   | Double Check de una de las 37 órdenes con S/D | la línea S/D lleva chip S/D delante del serial                                |
| 6   | Orden FedEx con una S/D                       | cabecera de tarima morada (FedEx) y chip naranja en la línea: no se confunden |
| 7   | Ficha de una PH                               | chip celeste PH en la etiqueta                                                |
| 8   | Condition en Filters                          | cuatro opciones, tres con punto de color                                      |

## 7. Preguntas (❓ con respuesta por defecto)

1. **❓ Los colores.** Por defecto **S/D naranja, PH celeste, devolución morado** (morado = FedEx, ya
   lo es el chip de hoy). El ámbar que sugería el backlog queda descartado porque ya es la casilla y
   «sin guardar». ¿Otros?
2. **❓ Chip o borde de tarjeta.** Por defecto **sólo chip**: un borde de color en la tarjeta compite
   con el ámbar de la casilla y con el rojo de borrada.
3. **❓ El texto del chip.** Por defecto **S/D, PH, RET** (como la ficha). «FedEx return» en la
   tarjeta pasa a RET.
4. **❓ Dónde no va.** Por defecto **no** en Ship, en la etiqueta impresa (ya dice `S/D #n` y `PH` en
   el nombre, en blanco y negro) ni en los reportes. Ship habla de órdenes, no de unidades.
5. **❓ Double Check resalta más.** Por defecto **no**: el mismo chip que en todas partes. Una S/D en
   una orden es correcta (la orden la pide); el chip es para que el picker coja la caja de ROW 12 y no
   una nueva.

## 8. Fuera

- Cambiar el tipo (Mark as PH / S/D, RESOLVE): ya existe.
- El color en el mapa del almacén.

## Decisiones

- **6 oct 2026 — Rafael: «sí, dale como está»**: los cinco ❓ con su respuesta por defecto.
- **6 oct 2026 — hecho.** `unitKindStyle` / `unitKindOf` (`src/utils/unitKind.ts`, con test) y
  `UnitKindChip` (`src/components/ui/`), con una variante rellena para la etiqueta de la ficha, que es
  papel claro. Tarjeta de Stock (sustituye al «FedEx return» morado), etiqueta de la ficha (PH, RET y
  S/D con su `#n`), puntos en Filters → Condition, y en Double Check la línea S/D o PH y el aviso «Not
  new». La lista del picker es la misma Double Check. `fetchCartSkuMeta` lee ahora `unit_kind`.
  Revisado a 430 px en local con una S/D, una PH sembrada y una orden de prueba.
