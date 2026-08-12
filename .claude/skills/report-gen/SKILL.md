---
name: report-gen
description: >
  Generador de informes academicos en HTML con compilacion a PDF. Usa este skill SIEMPRE que el usuario
  pida crear, hacer, generar o trabajar en un informe. Triggers: "crear informe",
  "nuevo informe", "generar reporte", "hacer un informe", "informe universitario",
  "ayudame a hacer un informe", "quiero un informe", "necesito un reporte", "crea un informe",
  "/report-gen", "informe academico", "reporte", o cualquier variacion. Tambien se activa cuando el
  usuario quiere redactar, escribir o completar secciones de un informe existente, corregir valores,
  o verificar consistencia. Cubre todo el ciclo: estructura, redaccion y compilacion.
license: MIT
metadata:
  category: productivity
  tags:
    - report
    - informe
    - university
    - universitario
    - pdf
    - markdown
    - reporte
    - academic
    - crear informe
    - generar reporte
    - hacer informe
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
  - AskUserQuestion
  - Agent
---

# Generador de Informes Universitarios

> **Regla de estilo:** Nunca uses emojis en ninguna salida de este skill.

> **Regla de edicion:** NUNCA edites los archivos `.html` directamente. Todos los cambios van en los `.md` de `sections/`. Despues de modificar un `.md`, recompila con `python build.py`. El `index.html` es producto compilado, no fuente editable.

> **Regla de oro:** Si no tienes la informacion, pregunta. Nunca inventes datos, valores, nombres, fechas, metricas, citas bibliograficas ni resultados. Es preferible preguntar 10 veces que entregar un informe con un solo dato falso. Si el usuario te da contenido, usalo tal como es. Si necesitas complementar, dilo explicitamente y pregunta si esta bien antes de incluirlo.

---

## FASE 1: Recopilar informacion

Pregunta lo que necesites (usa `AskUserQuestion`). Si el usuario ya proporciono algo en su mensaje, no lo repitas:

1. **Ubicacion** — Ruta o nombre de la carpeta
2. **Titulo** — Titulo completo del informe
3. **Curso** — Nombre del curso o asignatura
4. **Profesor/a** — Nombre completo
5. **Autor(es)** — Un estudiante individual o un equipo (nombre y rol de cada uno)
6. **Fecha** — Dia, mes y anio (si no la da, usa la fecha actual)
7. **Secciones** — Lista de secciones principales

---

## FASE 2: Crear estructura

**Localizar archivos de referencia:** Antes de crear la estructura, busca la carpeta de este skill ejecutando:
```bash
find ~/Documents/Projects/skills -type d -name "report-gen" 2>/dev/null
```
Guarda esa ruta como `SKILL_DIR`. Todos los archivos de referencia estan ahi.

1. Crea la carpeta del informe en la ubicacion especificada
2. Genera `report.yaml` (ver formato abajo)
3. Crea `sections/` con archivos `.md` (uno por seccion, con titulo H2)
4. Crea `img/` (carpeta para imagenes)
5. Copia los 4 CSS desde `SKILL_DIR/references/css/` a `css/` del informe (base, layout, visuals, print)
6. Copia `build.py` desde `SKILL_DIR/build.py`

### report.yaml

Un estudiante:
```yaml
titulo: "Titulo"
curso: "Curso"
profesor: "Profesor"
estudiante: "Nombre"
fecha: "22 de Marzo de 2026"
logo: "https://continentaluniversity.us/hubfs/Logotipo/LOGOTIPO_HORIZONTAL_CUF.png"
secciones:
  - id: resumen
    titulo: "Resumen Ejecutivo"
```

Equipo:
```yaml
titulo: "Titulo"
curso: "Curso"
profesor: "Profesor"
integrantes:
  - "Nombre | Rol"
  - "Nombre | Rol"
fecha: "22 de Marzo de 2026"
logo: "https://continentaluniversity.us/hubfs/Logotipo/LOGOTIPO_HORIZONTAL_CUF.png"
secciones:
  - id: resumen
    titulo: "Resumen Ejecutivo"
```

El logo es siempre el de Continental University. No lo preguntes.

---

## FASE 3: Redaccion del contenido

El usuario te ira alimentando con contenido, recursos, codigo, resultados o indicaciones para cada seccion. Tu trabajo es transformar eso en prosa academica bien estructurada.

### Reglas fundamentales

1. **No inventes.** Si el usuario te da datos, usalos exactamente. Si no te dio un dato que necesitas para redactar, pregunta. Nunca rellenes con valores inventados, "de referencia" o "placeholder". Un informe con espacios vacios es mejor que uno con datos falsos.

2. **Si hay codigo fuente, leelo antes de describir.** Cuando el informe trate sobre un proyecto tecnico, lee el codigo para entender que hace realmente. Describe lo que el codigo hace, no lo que tu crees que deberia hacer.

3. **Si hay resultados de ejecucion, usalos.** Cuando el usuario te pegue salida de consola con metricas o resultados, esos son los numeros del informe. No los redondees, no los "ajustes", no los cambies.

4. **Consistencia entre secciones.** Si un valor aparece en la tabla de resultados, debe aparecer identico en el resumen, la discusion y las conclusiones. Mismo numero, misma cantidad de decimales.

5. **Citas reales unicamente.** Solo incluye referencias bibliograficas que el usuario te proporcione. Nunca inventes autores, papers, revistas ni anios de publicacion.

6. **Referencias con enlaces.** En la seccion de referencias, si una publicacion tiene URL o DOI conocido, haz el titulo clickeable usando la sintaxis markdown `[Titulo](url)`. Esto permite al lector acceder directamente a la fuente. Si no tienes certeza del enlace, deja la referencia sin link — no inventes URLs.

7. **Pregunta antes de asumir.** Si no estas seguro de algo — un nombre, un valor, una decision tecnica — pregunta. "No estoy seguro de X, me confirmas?" es siempre mejor que inventar.

### Integrar contenido nuevo en un informe existente

Cuando el usuario proporcione nueva informacion, datos o texto para un informe que ya tiene contenido:

1. **Analizar y ubicar.** Determina cual es la seccion mas logica e impactante para integrar el nuevo contenido.
2. **Tejer, no appendear.** Lee la seccion correspondiente e integra la informacion en la narrativa existente de forma fluida. No la pegues al final.
3. **Preservar la esencia.** Mantiene el significado y la intencion de lo que el usuario proporciona. Tu rol es mejorar y posicionar, no alterar el mensaje fundamental.
4. **Cambios minimos en el texto circundante.** Solo modifica lo necesario para mantener coherencia. Justifica brevemente por que recomiendas esos cambios.
5. **Confirmar antes de actuar.** Presenta tu plan: que secciones modificaras y que ediciones propones. Espera aprobacion antes de ejecutar.

---

## FASE 4: Antes de decir "listo"

Antes de informar al usuario que el informe esta completo, haz una verificacion rapida:

- Busca con Grep cada valor numerico importante y verifica que es identico en todas las secciones donde aparece
- Verifica que toda cita en el texto tiene su entrada en referencias y viceversa
- Verifica que `report.yaml` lista todas las secciones y que cada una tiene su `.md`

Si encuentras un error, corrigelo antes de declarar que esta listo.

---

## FASE 5: Compilacion

1. Compila: `python build.py --build`
2. Verifica que el HTML se genero sin errores
3. Muestra resumen:

```
Informe compilado exitosamente

Ubicacion: {ruta}
Secciones: {lista}

Para visualizar:
  python build.py --serve
  (se abre en http://localhost:8080)

Para compilar y visualizar en un paso:
  python build.py

Para exportar a PDF:
  Ctrl+P en el navegador
```

**Nota:** Si es la primera vez en la maquina, verificar que PyYAML este instalado: `pip install pyyaml`

---

## Cambios posteriores

1. Edita los `.md` que necesiten cambio
2. Si cambia un valor numerico, verifica que sea consistente en las demas secciones
3. Recompila con `build.py`
4. Nunca edites el HTML directo
