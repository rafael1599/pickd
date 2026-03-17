---
name: daily-report
description: "Genera el reporte diario de progreso del proyecto. Usa este skill al final del día, cuando el usuario diga 'reporte', 'daily report', 'resumen del día', 'report', 'qué hicimos hoy', 'update para mi jefe', o cualquier variante sobre generar un resumen de avances del día."
---

# /daily-report — Reporte diario de progreso

## Paso 1: Recopilar datos del día

Ejecuta en paralelo:

1. `git log --since="$(date +%Y-%m-%d)" --format="%ai %s" --all` — commits de hoy
2. Lee `BACKLOG.md` — items completados hoy y pendientes actualizados
3. Revisa `supabase/migrations/` — migraciones creadas hoy (por fecha del archivo)
4. `git diff --stat HEAD~$(git log --since="$(date +%Y-%m-%d)" --oneline | wc -l)..HEAD` — archivos cambiados

## Paso 2: Generar el reporte

Escribe el reporte en `reports/daily/YYYY-MM-DD.txt` con estas reglas:

- **Formato:** texto plano, SIN markdown (no #, no **, no `, no |). Listo para copiar y pegar en un email.
- **Idioma:** inglés
- **Tono:** no técnico, lenguaje natural. El lector es un project manager que trabaja en el almacén con sus manos, no en tecnología.
- **NO mencionar:** nombres de archivos, funciones, commits, migraciones, ni términos técnicos como "memoize", "re-render", "hooks", "context", "refs", etc.
- **SÍ mencionar:** qué cambió para el usuario final, por qué importa, qué viene después.
- **Summary:** una sola oración corta y concisa que resuma todo el día.

### Estructura del reporte:

```
Progress Update — [Month Day, Year]


Summary:

[Una oración corta y concisa]


--- Details below ---


[Categoría 1]:

- [Qué se hizo y por qué importa]
- [Siguiente punto]


[Categoría 2]:

- [Punto]


Coming Up:

- [Lo próximo a trabajar, sacado del backlog pendiente]


Backlog Status:

[X] completed today — [Y] pending — [Z] new items added today


Ideas Under Consideration:

The following are early-stage ideas we've identified as potentially valuable. Each one needs further thought on the best way to bring it to life before any work begins — we want to make sure we approach them the right way rather than rush into building something that doesn't fit the workflow.

1. [Idea corta describiendo qué hace y por qué importa, en lenguaje no técnico]
2. [Siguiente idea]
```

Las categorías se generan orgánicamente según lo que se hizo (no usar siempre las mismas).

"Backlog Status" va después de "Coming Up". "Ideas Under Consideration" es SIEMPRE la última sección.

Backlog Status — Cuenta los items del BACKLOG.md:
- Completed today: items marcados como completados con fecha de hoy
- Pending: items con estado "Por hacer" o sin completar
- New items added: items cuya fecha de creación es hoy

Ideas Under Consideration — Pull de items no completados del BACKLOG.md:
- Cada item: una oración corta describiendo qué hace y por qué importa
- Lenguaje no técnico, entendible para alguien que no trabaja en tecnología
- No repetir items que ya están en "Coming Up"

## Paso 3: Confirmar

Muestra al usuario el contenido del reporte generado y la ruta del archivo.

Si ya existe un reporte del día, pregunta si quiere reemplazarlo o agregar al existente.

## Paso 4: Backlog

Revisa si el BACKLOG.md necesita actualizarse con items completados hoy que no estén marcados. Si hay actualizaciones, hazlas automáticamente.
