# El Google Sheet de S/D

La pestaña **S&D bikes** del Sheet
[`1wH9E_gEl3-uj4HSWzxHPLYR5_SAJEpo_Nts_eO6_ve8`](https://docs.google.com/spreadsheets/d/1wH9E_gEl3-uj4HSWzxHPLYR5_SAJEpo_Nts_eO6_ve8/edit?gid=974932514)
es un **espejo de PickD**: cada minuto tiene las S/D en stock, ordenadas por `SD #`. Desde el
2 oct 2026 también escribe de vuelta seis columnas. Funciona desde el 1 oct 2026 (Rafael).

El archivo original (`1dWz…`) era un `.xlsx` subido a Drive y **no sirve**: Apps Script no puede
escribir en un `.xlsx`. Se convirtió con _Archivo → Guardar como Hojas de cálculo de Google_.

## Las piezas

| Pieza                    | Dónde                                                                                                         | Qué hace                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Edge function `sd-sheet` | `supabase/functions/sd-sheet/`                                                                                | `GET`: las filas y las listas. `POST`: una celda editada → `sd_sheet_apply_edit`. Sin JWT (`verify_jwt = false`); exige claves propias. |
| Reglas de escritura      | `sd_sheet_apply_edit`, `sd_sheet_options`, `sd_sheet_revert` (migraciones `20261002125302`, `20261002131210`) | Toda regla vive en SQL, no en el script: quien puede editar el Sheet puede leer su script.                                              |
| Auditoría                | tabla `sd_sheet_edits`                                                                                        | Una fila por **intento**, aceptado o rechazado, con el motivo. Lectura solo admin.                                                      |
| Interruptor              | `app_flags.sd_sheet_write`                                                                                    | `enabled = false` deja el Sheet solo de lectura. `config` lleva los límites.                                                            |
| Apps Script              | `apps-script.gs` (copia versionada; la que corre vive en el Sheet)                                            | Activador cada minuto (`syncFromPickd`) y al editar (`onSheetEdit`).                                                                    |

## Las claves

Dos secretos de Supabase, y los mismos dos en _Configuración del proyecto → Propiedades del
script_ del Apps Script:

- `SD_SHEET_TOKEN`, cabecera `x-sheet-token`: leer.
- `SD_SHEET_WRITE_TOKEN`, cabecera `x-sheet-write-token`: escribir. Sin ella en el script, el
  Sheet queda solo de lectura.

**Rotar una clave:** generarla en un archivo y cargarla con
`npx supabase secrets set --env-file <archivo> --project-ref xexkttehzpxtviebglei` (nunca como
argumento de la línea de comandos), cambiar la propiedad del script y borrar el archivo.
Cualquiera con permiso de **edición** en el Sheet puede ver las claves abriendo el script; por eso
el Sheet solo lo editan personas de confianza, y por eso las reglas no dependen del script.

## Lectura (PickD → Sheet)

- **Filas:** S/D en stock en LUDLOW. Primero las numeradas por `SD #`, después por ubicación y
  SKU. Es la misma regla que el Excel de S/D (`scratchDentExport.ts`); si cambia allá, cambiar acá.
- **Location** lleva la letra del cuadro (`ROW 12 B`). El Excel no la lleva.
- **Category / Condition** vacías se muestran como `-`.
- Cada minuto el script compara PickD con **lo que tiene la pestaña en ese momento** y la
  reescribe si difiere. Una fila borrada, editada u ordenada a mano vuelve sola. Si no hay
  diferencia, no toca la hoja.
- Todas las columnas menos `SD #` van con formato texto (`@`). Si no, Sheets convertiría un
  serial `0123` en `123`, la comparación nunca daría igual y la hoja se reescribiría cada minuto.
- La hoja se abre **por ID** (`SPREADSHEET_ID`), no como «el archivo del script». Con un script
  atado al `.xlsx` o creado desde script.google.com, terminaba sin error y sin escribir nada.
- Si no existe la pestaña `SHEET_GID`, el script **se detiene** y lista las pestañas que hay.
  Nunca cae en otra pestaña, porque el espejo borra lo que pisa.

## Escritura (Sheet → PickD), planeada para el peor caso

Rafael, 2 oct 2026: «tenemos que planear para el peor escenario… que borren todo el contenido,
que desordenen el contenido con filtros».

**Editables:** Category, Condition (con desplegable y las listas de `SdDetailsCard.tsx`),
Condition description, Serial, Internal note y PDF link. **Solo lectura:** SD #, SKU, Name,
Location, AS400 description y Photo.

| Caso                                                                                                 | Qué pasa                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pegar en varias celdas, borrar un rango, borrar filas, tocar la fila de encabezados o mover columnas | No sale nada hacia PickD; el espejo restaura la hoja en ese momento. Solo viaja **una celda a la vez**.                                                                                                                      |
| Vaciar una celda                                                                                     | Se rechaza y la celda vuelve a su valor con una nota. Para vaciar Category o Condition se elige `-` en el menú. Para vaciar otro campo, se hace en PickD.                                                                    |
| Ordenar o desalinear filas                                                                           | **Compare-and-set**: el valor anterior tiene que coincidir con el de PickD para ese SKU, y la fila tiene que conservar el `SD #` y el `Name` de ese SKU. Si no, no escribe: nunca cae en otra bici.                          |
| Pegar en una celda                                                                                   | Google no manda ni el valor nuevo ni el anterior cuando se pega. El nuevo se lee de la celda y el anterior sale de la foto de PickD que el script guarda en `CacheService` en cada sincronización.                           |
| Ráfagas o scripts                                                                                    | Límite de **30 intentos por minuto y 300 por hora** para todo el Sheet, contando también los rechazados.                                                                                                                     |
| Basura                                                                                               | Category y Condition solo aceptan la lista. El Serial no puede ser el de otro SKU. Serial ≤ 40 caracteres; descripción, nota y PDF ≤ 500; el PDF tiene que empezar por `https://`.                                           |
| Daño hecho de todos modos                                                                            | `select * from sd_sheet_revert('2026-10-02 14:00')` muestra qué se revertiría y `sd_sheet_revert('…', true)` lo aplica, de la edición más nueva a la más vieja. Un campo que alguien cambió después no se toca y se informa. |
| Hay que cortar ya                                                                                    | `update app_flags set enabled = false where key = 'sd_sheet_write'`. El espejo sigue funcionando.                                                                                                                            |

Un rechazo devuelve la celda a su valor y deja una nota en la celda («Not saved in PickD: …»).
Un éxito escribe en la celda lo que PickD guardó, ya normalizado.

El correo de quien edita (`sd_sheet_edits.editor`) solo queda si Google lo entrega, normalmente
cuando la persona es del mismo dominio.

## Si algo no funciona

- **La pestaña está vacía y el registro dice «Se completó»:** el script no apunta a esta hoja.
  Revisar `SPREADSHEET_ID` y `SHEET_GID`.
- **«No tab with gid …»:** poner en `SHEET_GID` el número que aparece en el mensaje.
- **«A blank never writes» al pegar:** es un script anterior al 2 oct. Pegar de nuevo
  `apps-script.gs` completo y correr `setup`.
- **Los desplegables no aparecen:** se ponen en la siguiente corrida del minuto.
- **Cambiar columnas:** se cambia la función (y `sd_sheet_options` si la columna es editable) y
  se redespliega con `--no-verify-jwt`. El script no hace falta tocarlo.
