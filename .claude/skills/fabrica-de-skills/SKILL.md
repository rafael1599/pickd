# Proyecto: Skills Portal — Agent Teams + Subagentes

## Propósito

Este proyecto usa **Agent Teams** y **Subagentes** en Claude Code para crear skills y guardarlas en el repositorio central de skills (`../.claude/skills/` — relativo al directorio padre de este proyecto).

Las skills que crea este equipo son **instrucciones para Claude** — no tutoriales para humanos. Claude las lee y las usa para ayudar a usuarios. El criterio de calidad es: ¿Claude puede ejecutar esta tarea correctamente con estas instrucciones?

---

## Dónde guardar las skills

El repositorio de skills está en `../.claude/skills/` (relativo al directorio padre de este proyecto). Al crear un skill nuevo, clasificarlo según su alcance:

- **`external-skills/`** → El skill viene de documentación externa, guías de terceros o mejores prácticas de una herramienta/framework (Supabase, Vercel, Tailwind, etc.)
- **`global-skills/`** → El skill es una herramienta propia reutilizable en cualquier proyecto (commit, refactor, review, etc.)
- **`project-skills/{proyecto}/`** → El skill solo tiene sentido dentro de un proyecto específico. Crear el subdirectorio del proyecto si no existe.

Si no es claro dónde va, preguntar al usuario.

### Estructura de un skill

```
nombre-del-skill/
├── SKILL.md              ← Obligatorio
├── references/           ← Opcional. Docs de referencia largos
└── scripts/              ← Opcional. Scripts auxiliares
```

### Convenciones

- Nombres de carpeta en **kebab-case**
- Mantener `SKILL.md` bajo 500 líneas — mover contenido extenso a `references/`
- Escribir el skill en el idioma que el usuario use predominantemente

---

## Arquitectura

7 agentes, 4 sesiones de Claude.

```
Agent Team (4 sesiones):
  Lead          → tu sesión de Claude Code
  Arquitecto    → teammate (sesión independiente)
  Revisor       → teammate (sesión independiente)
  Optimizador   → teammate (sesión independiente)

Subagentes (corren dentro del Lead, sin sesión propia):
  Investigador  → busca docs oficiales, devuelve research
  Validador     → ejecuta validate.sh, devuelve PASS/FAIL
  Publisher     → publica en portal y verifica
```

**Por qué esta separación:**
- Los teammates necesitan debatir entre sí (SendMessage). Los subagentes no.
- Los teammates NO pueden lanzar subagentes (no tienen Task tool). Solo el Lead puede.
- Los subagentes ejecutan una tarea acotada y devuelven resultado. No necesitan sesión propia.

---

## Flujo de trabajo

```
FASE 1 — Solo el Lead
1. Lead recibe el request del usuario
2. Lead detecta ambigüedades bloqueantes → pregunta antes de arrancar
3. Lead lanza Investigador (subagente, SIN team_name) → recibe research

FASE 2 — El equipo entra con contexto
4. Lead crea task list con dependencias
5. Lead spawna Arquitecto + Revisor + Optimizador (teammates, CON team_name)
   → incluye research del Investigador en el spawn prompt
6. Arquitecto escribe SKILL.md usando la información investigada
7. Revisor cuestiona → debate con Arquitecto si hay problemas
8. Optimizador comprime → elimina lo que Claude no necesita

FASE 3 — Validación y guardado
9. Lead lanza Validador (subagente, SIN team_name) → revisa resultado
10. Si pasa: Lead guarda el SKILL.md (y artefactos) en el directorio correcto del repo de skills
```

**Instrucción crítica para el Lead:** Los subagentes (Investigador, Validador, Publisher) se lanzan con el Task tool **SIN el parámetro team_name**. Los teammates (Arquitecto, Revisor, Optimizador) se lanzan **CON team_name**.

---

## Roles del Agent Team

### Lead

**Responsabilidad:** Coordinar el pipeline. No diseña ni opina sobre el contenido.

**Antes de crear las tareas, DEBE preguntar si falta:**
- El proveedor o herramienta exacta (ej: "¿Cloudflare DNS, Google Cloud DNS o Route53?")
- Información que no puede ser un placeholder (ej: si el scope es ambiguo)

**No pregunta** si la información faltante puede ser un placeholder genérico (`<DOMAIN>`, `<PROJECT_ID>`, `<API_KEY>`).

**Solo cuando tiene contexto suficiente:** lanza primero el subagente Investigador con el brief completo. Cuando el Investigador devuelve resultados, crea la task list e incluye el research en el spawn prompt de los teammates. No spawna el equipo sin el research listo.

**Condición de salida:** termina cuando la skill está guardada en el repo de skills y verificada. No agrega tareas adicionales ni "mejoras" no solicitadas.

---

### Arquitecto

**Responsabilidad:** Escribir el SKILL.md como instrucciones para Claude.

**Antes de escribir:** usa el research que el Lead incluyó en el spawn prompt. Si el research no cubre algún caso borde, lo indica explícitamente — no inventa comandos sin fuente.

**Cómo escribe:**
- Para Claude, no para humanos. Claude ya sabe qué es un registro A, qué es un bucket, qué es autenticación OAuth. No explicar lo que Claude ya sabe.
- Comandos exactos con sus flags
- Decisiones que Claude debe tomar según el contexto del usuario
- Placeholders para todo valor específico del usuario: `<DOMAIN>`, `<PROJECT_ID>`, `<ZONE_NAME>`, `<YOUR_IP>`, `<API_KEY>`
- Los valores del request del usuario (ej: "rafaellopez.dev") solo van en ejemplos, nunca en comandos reales

**Condición de salida:** termina cuando SKILL.md está escrito y el Revisor aprobó. No itera más ni "mejora" sin que el Revisor lo solicite explícitamente.

---

### Revisor

**Responsabilidad:** Verificar que Claude ejecutaría correctamente estas instrucciones.

**Preguntas que se hace:**
- ¿Hay instrucciones ambiguas que Claude podría malinterpretar?
- ¿El `description` es específico sobre QUÉ hace la skill Y CUÁNDO usarla?
- ¿Hay valores hardcodeados que deberían ser placeholders?
- ¿El Investigador encontró fuente primaria para cada comando? Si no, marcar esos pasos.
- ¿Hay casos borde que Claude necesita manejar y no están cubiertos?

**Si encuentra problemas:** manda mensaje directo al Arquitecto con objeciones específicas. El Arquitecto corrige y notifica. El Revisor re-revisa.

**Si no encuentra nada:** explica por qué — no aprueba en silencio.

**Condición de salida:** máximo 2 rondas de objeciones al Arquitecto. Si en la segunda ronda no aparecen problemas nuevos, aprueba con razón explícita. No puede seguir objetando indefinidamente.

---

### Optimizador

**Responsabilidad:** Comprimir el SKILL.md hasta el mínimo necesario para que Claude funcione.

**Entra después del consenso Arquitecto + Revisor.**

**Su criterio — eliminar todo lo que:**
- Claude ya sabe (no explicar qué es un comando, qué es un flag estándar)
- Repite información ya presente en otra sección
- Es contexto histórico que Claude no necesita para ejecutar
- Excede 500 líneas en el body (mover a archivos separados si aplica)

**Su criterio — conservar todo lo que:**
- Es específico de esta herramienta/API/servicio
- Claude no podría inferir sin documentación
- Son edge cases reales que Claude necesita manejar

**También verifica:**
- `description` incluye qué hace Y cuándo usarla (el trigger)
- `name` en kebab-case, bajo 64 caracteres
- Todos los valores específicos son placeholders

**Condición de salida:** termina cuando el body tiene < 500 líneas Y eliminó al menos 1 sección o bloque redundante. Ni antes (no declarar "listo" sin haber eliminado algo) ni después (no seguir comprimiendo más allá del umbral).

---

## Subagentes (ejecutan tareas acotadas — no debaten)

**IMPORTANTE para el Lead:** Lanzar estos agentes con el Task tool **SIN team_name**. Si se lanzan con team_name, se convierten en teammates y no es lo que necesitamos.

### Investigador
- **Lanzado por:** Lead — en la Fase 1, antes de spawnar a los teammates. **Sin team_name.**
- **Qué busca:** Comandos exactos, flags actuales, requisitos, casos borde — desde documentación oficial.
- **Fuentes:** Máximo 2 fuentes primarias. Siempre primarias (docs oficiales, changelogs, repos). Si no encuentra fuente primaria, lo dice explícitamente — no busca más de 2 URLs.
- **Pregunta central:** "¿Qué necesita saber Claude para ejecutar esto?" — no "¿cómo lo hace un humano?"
- **Devuelve resultados al Lead** (no al Arquitecto). El Lead los incluye en el spawn prompt del Arquitecto.
- **Condición de salida:** termina cuando buscó en máximo 2 fuentes primarias. Si no encuentra fuente, lo reporta y termina — no sigue buscando indefinidamente.

### Validador
- **Lanzado por:** Lead, después de que el Optimizador termina. **Sin team_name.**
- **Qué hace:** Ejecuta `./validate.sh skills/[nombre-skill]` y devuelve resultado completo

### Publisher
- **Lanzado por:** Lead, solo si validación pasó. **Sin team_name.**
- **Qué hace:** Guarda el SKILL.md (y artefactos como `references/`, `scripts/`) en el directorio correcto del repo de skills (`../.claude/skills/`).
- **Clasificación:** Usa las reglas de la sección "Dónde guardar las skills" de este archivo para decidir el directorio destino (`external-skills/`, `global-skills/`, o `project-skills/{proyecto}/`).
- **Verifica:** Que el archivo se guardó correctamente y que la estructura de carpetas es válida.

---

## Formato SKILL.md

```markdown
---
name: nombre-en-kebab-case
version: 1.0.0
description: "Qué hace esta skill. Usar cuando [trigger específico]."
license: MIT
author: "Rafael Lopez"
metadata:
  category: infrastructure
  tags:
    - tag1
    - tag2
allowed-tools:
  - Bash
---

# Nombre de la Skill

## Instrucciones

[Lo que Claude hace — comandos, decisiones, verificaciones]
[Usar placeholders: <DOMAIN>, <PROJECT_ID>, <API_KEY>, <ZONE_NAME>]
[Conciso. Sin explicar lo que Claude ya sabe.]

## Decisiones

[Edge cases que Claude maneja solo, sin preguntar al usuario]

## Errores comunes

[Errores que Claude resuelve — mensaje exacto + solución]

## Referencias
- [Docs oficiales](URL)
```

**El body debe quedar bajo 500 líneas.**
**Si supera ese límite:** crear archivos adicionales (`reference.md`, `examples.md`) y referenciarlos desde el SKILL.md principal.

---

## Reglas

1. **El Lead pregunta antes de arrancar** si hay ambigüedades bloqueantes. No asume el proveedor, no asume el scope.
2. **Sin fuente primaria, no se escribe.** Si el Investigador no encontró documentación oficial para un comando, el Arquitecto lo marca y pide confirmación.
3. **Sin hardcode.** Valores específicos del usuario siempre como placeholders. Sin excepciones.
4. **Skills para Claude, no para humanos.** No explicar lo que Claude ya sabe.
5. **El Optimizador substrae, no agrega.** Su trabajo es eliminar, no enriquecer.
6. **Sin validación, sin guardado.** El Publisher no corre si el Validador falló.
7. **Subagentes SIN team_name.** El Lead lanza Investigador, Validador y Publisher con el Task tool sin el parámetro team_name. Esto los mantiene como subagentes (corren dentro del Lead) en vez de teammates.
8. **Condiciones de salida explícitas.** Cada rol termina cuando su condición se cumple — no antes, no después.
9. **Todos los agentes se comunican en español.**
