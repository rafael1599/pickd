# Protocolo — investigación agy → confirmación Claude

Carpeta de trabajo del día. Un `.md` por tarea, más este protocolo y `00-INDEX.md`.

## El reparto de trabajo

- **agy investiga.** Lee código, sigue el rastro, propone causa raíz y plan de fix concreto (archivo + línea + snippet). **agy NUNCA edita código ni hace commits** — solo escribe en el `.md` de la tarea que está trabajando.
- **Claude confirma e implementa.** Cuando una tarea dice `LISTO PARA CONFIRMAR`, Claude lee ese único `.md`, no vuelve a investigar desde cero, y pasa directo a aplicar el fix, typecheck, tests, commit y push.

## Cómo escribir en un `.md` de tarea

Cada archivo tiene esta forma fija — agy respeta las secciones, nunca las borra:

```markdown
# <título corto>

## Estado
INVESTIGANDO | LISTO PARA CONFIRMAR | BLOQUEADO | IMPLEMENTADO

## Pedido de Rafael (literal)
...

## Contexto ya conocido
(lo que ya se sabía antes de que agy tocara este archivo — no se borra)

## Hallazgos
### 2026-09-18 14:32 — agy
- causa raíz, archivo:línea, confianza
### 2026-09-18 16:05 — agy
- ...

## Plan de fix propuesto
(la versión VIGENTE del plan — si un hallazgo nuevo lo cambia, se reescribe
esta sección pero el hallazgo que lo motivó queda arriba, en Hallazgos)

## Autocorrección
(solo si un hallazgo nuevo CONTRADICE uno anterior — nunca se borra el
anterior, se anota aquí qué decía antes, qué lo refutó, y con qué evidencia)
### 2026-09-18 17:10
- Antes creía: "X"
- Nuevo hallazgo: "Y" (archivo:línea / test que lo prueba)
- Por qué X estaba mal: ...

## Preguntas para Rafael
(solo las que de verdad bloquean — lo que un comando puede responder, se
responde solo, no se pregunta)
```

## Reglas duras

1. **Nunca borrar una sección para "limpiar"** — el historial de Hallazgos es lo que le ahorra a Claude re-investigar. Si algo quedó obsoleto, se tacha o se anota en Autocorrección, no se elimina.
2. **Cada actualización lleva fecha y hora** (`date '+%Y-%m-%d %H:%M'`) en el encabezado del hallazgo — sin eso no se sabe qué es más reciente.
3. **Un hallazgo es una hipótesis hasta que se verificó contra el código actual** (grep, leer el archivo tal como está AHORA — varias tareas de hoy tocan archivos que Claude ya modificó en sesiones previas). Decirlo así: "confirmado en código" vs "hipótesis, falta verificar".
4. **`Estado: LISTO PARA CONFIRMAR`** solo cuando el plan de fix es concreto y accionable sin ambigüedad — archivo, función, y el cambio exacto. Si falta algo, se queda en `INVESTIGANDO` o pasa a `BLOQUEADO` con la pregunta en la última sección.
5. **No tocar el `.md` de otra tarea.** Una tarea, un archivo.
6. **Actualizar la columna Estado de `00-INDEX.md`** cada vez que cambia el estado de una tarea — es el único lugar que Claude mira para saber por dónde seguir sin abrir los 9 archivos.
