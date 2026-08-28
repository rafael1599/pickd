> **Superseded 2026-08-28 (idea-170):** la pestaña Live (stock real por fila) fue borrado con la fase F4; el mapa medido en
> `src/features/warehouse-map/` lo reemplaza. Ver `docs/prds/warehouse-map-measured.md`.

# PRD: Mapa de Stock Real Físico & Selector de Rows (Warehouse Map)

## 1) Contexto y Problema

Actualmente, la pantalla `/warehouse-map` en PickD está diseñada para mostrar un mapa de **Overstock Sugerido (Putaway)** generado mediante un algoritmo codicioso (_greedy solver_) que asigna candidatos según volumen de ventas y peso.

Sin embargo, los operadores y gerentes de almacén necesitan una herramienta visual directa para consultar el **stock físico real** almacenado en las estanterías en un momento dado, sin ejecutar algoritmos de sugerencia ni simulaciones.

### Problemas identificados:

- **Falta de visibilidad del stock real en mapa**: No existe una vista visual interactiva a nivel de mapa que refleje exactamente qué SKUs y cuántas unidades físicas residen en cada estantería (`location`) y sublocalización (`sublocation`, ej. $A \dots J$).
- **Rigidez en la selección de filas**: La vista previa estaba acoplada a un grupo fijo de filas (`ROW 33`, `ROW 32`, `ROW 31`). El almacén cuenta con múltiples filas adicionales (`ROW 1` a `ROW 30`, `ROW 4`, `ROW 5`, etc.) que no se pueden consultar ni inspeccionar visualmente.
- **Imposibilidad de unir filas**: Los operadores no pueden comparar ni unir 2 o más filas personalizadas en una sola vista para planificar espacio contiguo de almacenamiento.

---

## 2) Objetivo

Proporcionar una vista en tiempo real en `/warehouse-map` que renderice el **Stock Físico Real** del inventario en una cuadrícula idéntica a la vista de mapa visual existente, equipada con un **Selector de Filas (Rows)** dinámico y una arquitectura preparada para **unir múltiples filas seleccionadas** en una sola interfaz continua.

---

## 3) Público Objetivo y Usuarios

- **Gerente de Almacén (Warehouse Manager)**: Requiere auditar visualmente el espacio libre en las estanterías de cualquier fila y planificar reubicaciones masivas.
- **Operadores de Almacén (Pickers / Stacker Drivers)**: Requieren verificar visualmente en su tablet/móvil si una sublocalización física específica (ej. `ROW 32 J`) está ocupada o vacía antes de llevar pallets o cajas físicas.
- **Administradores del Sistema**: Requieren inspeccionar inconsistencias entre la ubicación teórica en sistema y la disposición física en el mapa del almacén.

---

## 4) Alcance (Scope)

### ✅ In Scope (Dentro del Alcance):

- **Conmutador de Modo de Mapa (Map Mode Switcher)**: Toggle entre el modo _"Plan Sugerido (Overstock)"_ y el nuevo modo _"Stock Real (Físico)"_.
- **Selector de Filas (Row Selector)**: Componente UI para seleccionar 1 o varias filas del inventario activo (ej. `ROW 33`, `ROW 32`, `ROW 31`, `ROW 4`, etc.).
- **Visualización de Sublocalizaciones ($A \dots J$)**: Renderizado exacto del mapa físico asignando cada registro de la tabla `inventory` a su letra de sublocalización correspondiente (`sublocation`).
- **Mapeo a la Cuadrícula Visual (`WarehouseGrid`)**: Reutilización de los estilos de tarjetas de SKU, colores por familia, insignias de cantidad y formato de impresión/PDF.
- **Soporte de Filas Múltiples (Unión Horizontal)**: Renderizado de $N$ columnas para $N$ filas seleccionadas de manera continua.
- **Inspección de Celdas Vacías y Ocupadas**: Indicación clara de sublocalizaciones disponibles vs. ocupadas por SKUs de tipo Torre ($\ge 15$u) o Líneas ($< 15$u).

### ❌ Out of Scope (Fuera del Alcance en esta Fase):

- Modificación o edición drag-and-drop de ubicaciones desde el mapa físico (las reubicaciones de inventario se gestionan en las pantallas de _Consolidación_ o _Movimiento de Stock_).
- Algoritmos de sugerencia de reubicación dentro del modo de Stock Real (el modo real es estrictamente descriptivo de la base de datos).
- Generación de rutas óptimas de montacargas (Picking Path) en 3D.

---

## 5) Conceptos de Dominio

- **Row (Fila / Estantería)**: Identificador principal de la estantería física dentro del almacén (columna `location` en Supabase, ej. `'ROW 33'`, `'ROW 4'`).
- **Sublocalización (`sublocation`)**: División vertical dentro de una estantería física, identificada tradicionalmente por letras individuales o arreglos de letras (`['A']`, `['B']`, `['J']`, o agrupadas `['A', 'B']`).
- **Mapa Físico Real (Real Stock Map)**: Representación visual basada exclusivamente en los registros activos con `quantity > 0` guardados en la tabla `inventory`, sin interposición de algoritmos de optimización.
- **Selector de Rows**: Control de interfaz que permite filtrar la consulta de inventario por una o múltiples estanterías específicas.
- **Unión Dinámica de Rows (Joined Rows Spec)**: Capacidad del motor del mapa de renderizar $N$ filas seleccionadas lado a lado en un único lienzo o vista horizontal integrada.

---

## 6) Requerimientos Funcionales Numerados

| ID         | Requerimiento Funcional                | Descripción y Criterio de Verificación                                                                                                                                                                                                                             |
| :--------- | :------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RF-001** | Conmutador de Modo de Vista            | El sistema debe incluir un selector de modo en la cabecera de `/warehouse-map` con dos opciones: _"Real Stock"_ y _"Suggested Plan"_. **Verificable:** Al cambiar el toggle, la vista debe alternar entre la data real de inventario y el plan algorítmico.        |
| **RF-002** | Selector de Filas (Row Selector)       | El sistema debe mostrar un componente de selección que liste todas las filas (`location`) activas presentes en el almacén seleccionable de forma individual o múltiple. **Verificable:** El usuario puede seleccionar `ROW 33`, `ROW 32` o combinar filas.         |
| **RF-003** | Mapeo de Sublocalizaciones $A \dots J$ | En el modo _"Real Stock"_, cada item con `sublocation` debe colocarse en su fila de letra correspondiente ($A$ a $J$). **Verificable:** Un item con `location = 'ROW 33'` y `sublocation = ['H']` debe aparecer en la casilla $H$ de la columna $33$.              |
| **RF-004** | Soporte de Sublocalizaciones Múltiples | Si un item de inventario contiene múltiples letras de sublocalización (ej. `['A', 'B']`), la tarjeta del SKU debe abarcar o resaltar ambas celdas físicas. **Verificable:** El item se muestra en las celdas $A$ y $B$ del grid.                                   |
| **RF-005** | Indicación de Celdas Libres / Vacías   | Las sublocalizaciones $A \dots J$ que no contengan ningún item en la fila seleccionada deben mostrarse visualmente como `[Available / Reserved]` con estilo diferenciado. **Verificable:** Las celdas sin registros activos aparecen en gris discontinuo.          |
| **RF-006** | Identificación de Tarjetas por SKU     | Las tarjetas renderizadas deben mostrar el código SKU, cantidad total en esa ubicación y aplicar la paleta de colores por familia de modelo (mediante `skuColor.ts`). **Verificable:** Cada SKU exhibe su color de fondo característico y tipografía legible.      |
| **RF-007** | Panel de Detalle al Hacer Clic         | Al hacer clic en cualquier celda ocupada del mapa de stock real, el sistema debe abrir el panel lateral `SkuDetailPanel` con el desglose del producto y cantidad. **Verificable:** Clic en una celda abre el panel con la información exacta del SKU seleccionado. |
| **RF-008** | Integración con Impresión PDF          | El mapa de stock real debe ser compatible con la función de impresión en PDF en 1 sola página A4 (Orientación Horizontal y Vertical). **Verificable:** Hacer clic en _"Print Landscape"_ genera el PDF del stock real seleccionado en 1 hoja.                      |
| **RF-009** | Unión Dinámica de Múltiples Rows       | La estructura del grid debe generar dinámicamente columnas de $1 \dots N$ según el número de filas seleccionadas en el Row Selector. **Verificable:** Seleccionar 4 filas genera un grid de 4 columnas x 10 filas de sublocalizaciones.                            |

---

## 7) Requerimientos No Funcionales

- **RNF-001 (Rendimiento O(1) de Carga)**: La consulta de inventario para las filas seleccionadas debe ejecutarse en menos de $100\text{ ms}$ utilizando índices en `location` e `is_active` en Supabase.
- **RNF-002 (Responsividad y Scroll)**: El grid debe ser horizontalmente desplazable en pantallas móviles y ajustarse al 100% del contenedor en pantallas de escritorio.
- **RNF-003 (Seguridad RLS)**: La lectura del inventario físico respeta las políticas de Row Level Security (RLS) para usuarios autenticados del almacén.
- **RNF-004 (Consistencia Visual)**: Utilizar los componentes de diseño de Tailwind CSS y tokens del sistema existente de PickD.

---

## 8) Criterios de Aceptación

1. **Dado** que un usuario ingresa a `/warehouse-map`, **cuando** selecciona el modo _"Real Stock"_, **entonces** el mapa muestra las posiciones físicas reales de las estanterías sin ejecutar simulaciones de Overstock.
2. **Dado** que el usuario abre el _Row Selector_, **cuando** elige `ROW 33` y `ROW 32`, **entonces** el lienzo muestra 2 columnas contiguas ($33$ y $32$) con las sublocalizaciones $A$ a $J$ mapeadas exactamente a los datos de la base de datos.
3. **Dado** que una sublocalización física no tiene inventario asignado en la base de datos, **entonces** la celda en el mapa aparece etiquetada como disponible y en tono neutro.
4. **Dado** que el usuario presiona _"Print Landscape"_, **entonces** se genera un documento PDF A4 a todo color de la selección de filas actual en 1 sola página.

---

## 9) Riesgos y Supuestos

### Supuestos:

- Todos los registros activos de bicicletas en la tabla `inventory` tienen el campo `location` poblado con el nombre de la fila (ej. `'ROW 33'`).
- Las sublocalizaciones físicas del almacén siguen la convención estándar de letras de la $A$ a la $J$.

### Riesgos y Mitigaciones:

- **Riesgo:** Registros de inventario antiguos sin el campo `sublocation` o con valores `NULL`.
  - _Mitigación:_ Se agregará un bloque resumen o sección `[Unassigned Sublocation]` para mostrar los SKUs que están en la fila pero no tienen letra asignada.
- **Riesgo:** Inconsistencias por múltiples SKUs compartiendo una misma sublocalización de tipo línea.
  - _Mitigación:_ El componente `SkuCell` soporta renderizado multivía (Líneas / Multi-SKU) mostrando hasta 6 SKUs en mini-filas dentro de la misma casilla.
