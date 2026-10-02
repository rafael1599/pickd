---
paths:
  - 'src/content/manuals/**'
  - 'src/features/manuals/**'
---

# Manuales de procedimiento

> Movido tal cual desde `CLAUDE.md` el 2 oct 2026 (pasaba el límite de 150k caracteres de
> instrucciones). Claude Code carga este archivo al trabajar con las rutas de arriba; los demás
> agentes lo encuentran por el índice de `CLAUDE.md`. Lo nuevo de esta área se escribe **aquí**.

## Manuales de procedimiento

Biblioteca de **solo lectura**: `/manuals` (lista, buscador, filtro por categoría) y `/manuals/:slug`
(documento). Son SOPs para el personal — cómo etiquetar una e-bike para FedEx, cómo pasar las medidas
a Ship Manager —, **no** manuales de usuario de las bicis: esos tienen otra audiencia y colgarían de
un SKU.

**Son contenido estático, no filas.** Viven en `src/content/manuals/`, fuera de `features/`, porque
los leen dos consumidores que no deben importarse entre sí: la vista (`src/features/manuals/`) y los
botones "ver el procedimiento" de otras pantallas. Cada manual es un módulo TypeScript; `index.ts`
tiene el registro (`MANUALS`), el tipo `ManualSlug`, `getManualBySlug`, `manualRoute` y
`manualTitleFor`.

Estuvieron un día en una tabla `manuals`. Esa tabla tenía **una fila, ninguna política de escritura y
una migración como único escritor** — un archivo estático disfrazado de base de datos. Todo lo que
había que defender ahí (un jsonb malformado llegando al renderer, contenido y código desplegándose
desincronizados, un valor cambiado en Studio sin diff que revisar) deja de existir cuando es un
módulo: `git push` lleva el manual y la pantalla que lo pinta en el mismo commit, y el compilador
comprueba la forma.

**Decisión cerrada del operador (21 ago 2026): los manuales no vuelven a la base de datos, nunca.**
No es "estático por ahora": una tabla `manuals` no es el plan B de ningún requisito, incluido que
alguien quiera editarlos desde la app. Está **verificado, no solo escrito aquí** — cualquier
migración que mencione una tabla `manuals` rompe la suite de tests
(`src/content/manuals/__tests__/manuals.test.ts`). Se documentó dos veces y se escribió la migración
igual, así que la regla dejó de vivir solo en prosa.

**`ManualSlug` es la razón de que los enlaces no se rompan en silencio.** Es el union de los slugs que
existen, así que un `ManualLinkButton` que apunte a un manual inexistente **no compila**. La versión
anterior emparejaba por título contra una lista de grafías aceptadas y, al fallar, dejaba al operador
en el índice sin decir nada. El slug es el contrato; el título se puede reescribir libremente.

**Donde un paso tiene figura, la figura es la instrucción.** Ninguna tabla de campos repite lo que la
ventana ya enseña, y cada regla se dice **una sola vez**, en el paso donde equivocarse cuesta algo. Un
borrador anterior decía "siempre Replace" cinco veces —en los avisos, en los campos, en la marca, en
el paso y en la referencia—: un procedimiento que nadie termina de leer no es más seguro.

**Un campo dice qué va en la casilla**, así que su `value` es o el texto literal (`CHEMTREC`,
`UN 3481`) o su descripción (`the weight of this bike`). Hubo un `kind: 'exact' | 'example'` para
marcar los valores de muestra, porque la hoja de papel imprime el `61 lbs` de un envío concreto con la
misma tipografía que las constantes de al lado. Etiquetar cada uno como "varies" llenaba la página de
esa palabra y **seguía dejando un número ahí para copiarlo**. Describir el valor resuelve las dos
cosas: nadie teclea "the weight of this bike" literalmente.

**Un paso puede llevar una `figure`: una reproducción simplificada de la ventana del otro sistema**,
con sus controles y las llamadas naranjas numeradas (`ManualFigure.tsx`). No son capturas — son datos
validados por el mismo esquema, así que buscan, escalan en móvil y no envejecen como un PNG. El
control marcado se **rodea**, no solo se describe, porque quien compara el papel con la pantalla busca
la forma, no el nombre del campo. Es el único sitio de la app con superficie clara sobre root `dark`,
así que **todo texto ahí lleva color explícito** (regla 10 de `ui-rules`); heredar es blanco sobre
blanco. Los colores son los de FSM a propósito: es una foto del software ajeno, y se ve igual en modo
oscuro porque el software se ve igual.

Código de color, explicado en la leyenda del propio documento: **verde** = teclear exacto,
**punteado** = varía, **azul** = clic, **rojo** = aviso.

**La compuerta del contenido son los tests**, ahora que no hay migración entre escribir un manual y
publicarlo: `src/content/manuals/__tests__/manuals.test.ts` valida cada manual contra
`manualContentSchema`, exige slugs únicos y url-safe, y rechaza un paso sin cuerpo ni campos ni
acción — un paso que solo tiene título no le dice nada a nadie.

**Los dos manuales actuales** se transcribieron de hojas impresas del ship station. Las capturas del
FedEx Ship Manager **no** se reproducen: son fotos de una impresión arrugada, ilegibles en un móvil, y
cada valor que contienen está como campo. Dos huecos conocidos, ambos anotados en el propio contenido:
el paso 6 del manual de Hazmat remite a **dos vídeos que no están en PickD** (se mantiene, con aviso,
porque quitarlo renumeraría un procedimiento que la gente ya se sabe), y el de dimensiones manda usar
**Firefox en la máquina de FedEx sin motivo registrado** — si resulta ser "el otro navegador bloquea
la descarga", eso pertenece al paso 2, porque una regla con motivo es la que la gente sigue.
