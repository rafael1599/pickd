---
name: project-setup
description: >
  Estandariza proyectos y gestiona skills entre proyectos y herramientas AI.
  Combina estandarizacion (gitattributes, gitignore, linting, hooks, env.example)
  con gestion de skills (setup, install, list, audit, create, sync).
  Triggers: "estandariza", "standardize", "configura linting", "setup hooks",
  "prepara este proyecto", "configura skills", "instala skill", "lista skills",
  "nueva skill", "audita skills", "sincroniza skills", "skills-hub",
  "/project-setup", "conecta este proyecto", "que proyectos tienen skills",
  "que skills tengo", "crea una skill".
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
  - Agent
---

# Project Setup

Skill unificado para estandarizar proyectos y gestionar skills compartidas entre Claude Code y Cursor. Fusiona las responsabilidades de project-standardize y skills-hub en un solo lugar, eliminando duplicidades y contradicciones.

---

## Parte 1 — Repo central de skills

El repo central es la fuente de verdad para todos los skills. Antes de cualquier operacion que lo necesite (setup, install, list, audit, etc.), hay que resolverlo.

### Descubrimiento del repo central

Seguir este orden exacto. Detenerse en el primer exito:

1. **Cache** — leer `~/.config/skills-hub.json` → campo `central_repo`. Validar que existe y es un repo de skills (tiene `.git/`, `global-skills/`, `external-skills/`).
2. **Variable de entorno** — leer `$SKILLS_PATH`. Validar igual que cache.
3. **Busqueda en disco** — buscar en `~/dev/*`, `~/Documents/Projects/*` y `~/Documents/*` un directorio que sea repo de skills valido.
4. **Preguntar al usuario** — si ningun paso anterior funciono, usar AskUserQuestion:
   - "No encontre tu repo de skills. Ya tienes uno clonado?"
   - Si responde que si: pedir la ruta, validar, y registrar con `project-setup.py central --set "<ruta>"`
   - Si responde que no o no sabe: sugerir clonarlo:
     - Preguntar la URL del repo git (o sugerir la URL por defecto si se conoce)
     - Ejecutar: `python <project-setup.py> clone "<url>"`
     - Confirmar que se clono en `~/dev/skills` y quedo registrado

Cuando se resuelva por pasos 2 o 3, guardar en cache automaticamente para que la proxima vez se resuelva por paso 1.

### Validacion de repo de skills

Un directorio es un repo de skills valido si cumple TODAS estas condiciones:
- Existe y es un directorio
- Tiene `.git/`
- Tiene `global-skills/`
- Tiene `external-skills/`
- `git remote get-url origin` contiene "skills" (case-insensitive)

### Script project-setup.py

El script que ejecuta las operaciones de gestion esta en `scripts/project-setup.py` (relativo a esta skill). Buscar la ruta completa con Glob si es necesario.

---

## Parte 2 — Vigilancia de la carpeta Projects

La carpeta raiz `~/dev/` tiene un `CLAUDE.md` que documenta la estructura conocida de workspaces y proyectos. Esta parte se activa automaticamente cuando el usuario pide estandarizar un proyecto o cuando se detecta que se esta trabajando dentro de Projects.

### Estructura conocida

```
Projects/
  confi-tec/                ← Workspace: proyectos Confi-Tec
    taxi-app/               ← App de taxi (monorepo Fastify + React + Expo)
  excellent-taxi/           ← Workspace: app de taxi Excellent
    control-de-horas/       ← Backend Node.js
    excellent-app-fe/       ← Frontend React
    excellent-app-fe-legacy/ ← Frontend React (legacy)
  personal-ops/             ← Organizacion personal
  pickd-workspace/          ← Workspace: proyecto Pickd
    pickd/                  ← App principal
    pickd-2d/               ← Version 2D
    watchdog-pickd/         ← Monitor Python
  skills/                   ← Repo central de skills
```

### Flujo de vigilancia

1. **Verificar CLAUDE.md raiz.** Si `~/dev/CLAUDE.md` no existe, crearlo con la estructura conocida documentada arriba y las convenciones del proyecto.

2. **Escanear carpetas.** Listar los directorios de primer nivel en Projects y compararlos con la estructura conocida.

3. **Detectar cambios:**
   - **Carpeta nueva no reconocida** → Preguntar al usuario: "Encontre `<nombre>/`. Es un proyecto nuevo? Quieres que lo estandarice y lo agregue a la estructura conocida?"
   - **Repo suelto que deberia estar en un workspace** → Sugerir: "Veo `<nombre>/` suelto en la raiz. Pertenece a algun workspace existente? Quieres moverlo dentro de `<workspace>/`?"
   - **Nombre inconsistente** → Sugerir renombrar si no sigue la convencion (kebab-case, descriptivo)
   - **Carpeta esperada que falta** → Informar: "No encuentro `<nombre>/`. Fue movido o eliminado?"

4. **Aplicar cambios.** Si el usuario acepta renombrar, mover o reorganizar:
   - Ejecutar el movimiento/rename
   - Actualizar el `CLAUDE.md` raiz de Projects con la nueva estructura
   - Si el proyecto movido tiene un `.claude/skills` symlink, verificar que sigue funcionando

5. **Actualizar conocimiento.** Despues de cualquier cambio, actualizar la seccion de estructura en el `CLAUDE.md` raiz para que refleje el estado actual. Este archivo es la fuente de verdad de que hay en Projects.

### Reglas

- Solo considerar carpetas que sean repositorios git (tengan `.git/`) — ignorar carpetas sueltas sin repo
- Nunca mover ni renombrar sin preguntar al usuario
- Nunca eliminar carpetas — solo sugerir reorganizacion
- Si el usuario dice que un repo es temporal o no quiere estandarizarlo, respetar eso y no volver a preguntar
- Actualizar el CLAUDE.md raiz cada vez que se agregue o mueva un proyecto

---

## Parte 3 — Estandarizacion de proyectos

Cuando el usuario pida estandarizar, preparar, o configurar un proyecto, usar project-setup.py para minimizar tool calls:

### Flujo optimizado (preferido)

```bash
# 1. Auditar estado actual (1 call, reemplaza ~10 checks manuales)
python <project-setup.py> check "<ruta-del-proyecto>"

# 2. Aplicar pasos mecanicos automaticamente (gitattributes, gitignore, prettier, ruff, symlink)
python <project-setup.py> standardize "<ruta-del-proyecto>"

# 3. El LLM completa lo que necesita juicio (CLAUDE.md, ESLint config, .env.example, husky)
#    Ver "needs_llm" en el output de standardize

# 4. Verificar que todo funciona (binarios, lint, hooks)
python <project-setup.py> verify "<ruta-del-proyecto>"
```

El output de `check` incluye `missing` (lista de lo que falta) y `score` (X/10).
El output de `standardize` incluye `actions` (lo que hizo) y `needs_llm` (lo que queda para el agente).
El output de `verify` incluye si lint pasa y si los binarios existen en node_modules/.bin/.

Si la migracion a pnpm es aceptada por el usuario:
```bash
python <project-setup.py> migrate-pnpm "<ruta-del-proyecto>"
```
Esto crea pnpm-workspace.yaml, actualiza workspace:* refs, borra lockfile viejo, y corre pnpm install. El LLM aun debe actualizar scripts (--filter usa nombres de package, no rutas) y CLAUDE.md.

### Flujo manual (fallback si project-setup.py falla)

Seguir estos pasos en orden. Cada paso verifica primero si ya esta hecho — no duplicar trabajo.

### Paso 1: Detectar tipo de proyecto y package manager

Revisar la raiz del proyecto:
- `package.json` → JS/TS. Revisar si es monorepo (`workspaces`), Nuxt (`nuxt` en deps), React, etc.
- `requirements.txt` o `pyproject.toml` → Python
- Solo `.md` → Docs (solo aplicar pasos 2–5)

**Detectar package manager (JS/TS):**
- `pnpm-lock.yaml` existe → **pnpm**
- `yarn.lock` existe → **yarn**
- `package-lock.json` existe → **npm**
- Ninguno → preguntar al usuario

Guardar el PM detectado como `<pm>` y usarlo en todos los comandos de instalacion de los pasos siguientes. Nunca hardcodear un PM — siempre usar el detectado.

**Si el PM detectado es npm o yarn**, sugerir migrar a pnpm:
- "Este proyecto usa `<pm>`. pnpm es mas seguro (no permite phantom dependencies, instalacion mas rapida, menor uso de disco). Quieres migrar a pnpm?"
- Si acepta: eliminar el lockfile anterior, ejecutar `pnpm import` si habia lockfile, luego `pnpm install`, y agregar `"packageManager"` al `package.json`
- Si rechaza: respetar y continuar con el PM actual
- No insistir si el usuario ya dijo que no en el pasado

### Paso 2: Conectar skills

Conectar el proyecto al repo central via symlink. Primero preguntar al usuario:
- "Quieres configurar solo Claude Code, o tambien Cursor?"

Esperar respuesta. No asumir que quiere ambos.

Ejecutar segun respuesta:
```bash
# Solo Claude:
python <project-setup.py> setup "<ruta-del-proyecto>" --tools claude

# Claude + Cursor:
python <project-setup.py> setup "<ruta-del-proyecto>" --tools claude cursor
```

Si el usuario no especifica ruta, usar el directorio de trabajo actual.

**Antes de ejecutar project-setup.py**, verificar el estado actual de `.claude/skills`:

Hay dos esquemas en circulacion, pero **solo el de symlinks individuales funciona**: Claude Code
descubre `SKILL.md` a un solo nivel (`.claude/skills/<nombre>/SKILL.md`), asi que un symlink al
repo completo no expone `global-skills/*`, `project-skills/*` ni `external-skills/*`. Verificado
el 2026-08-28 con `claude -p` en un proyecto de prueba: con el symlink al repo solo aparecio
`find-skills`, el unico que esta a un nivel. drivly y taxi-app estuvieron asi meses sin que se notara.

| Esquema | Que es | Estado |
|---|---|---|
| **Symlink al repo** | `.claude/skills` es un symlink al repo central completo | ❌ No descubre nada anidado. Migrar con `link-skills.sh --local` |
| **Symlinks individuales** | `.claude/skills/` es un directorio con un symlink por skill (`commit-craft -> $SKILLS_PATH/global-skills/commit-craft`) | ✅ Esquema vigente |

El mecanismo vigente es `.claude/hooks/link-skills.sh` (canonico en `scripts/link-skills.sh` de
esta skill; cada proyecto lleva una copia con su propia lista `SKILLS`): como hook SessionStart crea
los symlinks en Claude Code web; con `--local` los regenera en esta maquina apuntando a
`$SKILLS_PATH` y borra los muertos. Para conectar un proyecto nuevo: copiar el script a
`.claude/hooks/`, registrar el hook SessionStart en `.claude/settings.json`, editar `SKILLS` y correr
`bash .claude/hooks/link-skills.sh --local`. Excepciones documentadas: `pickd` vendoriza copias
(decision 2026-08-11 en su CLAUDE.md) y `personal-ops` no usa skills locales (2026-06-13).

`project-setup.py setup` todavia crea el symlink al repo completo — **no usarlo para conectar
skills** hasta que se actualice (pendiente 2026-08-28); el resto de subcomandos sigue vigente.

**Logica de deteccion:**
```bash
# 1. Es symlink al repo central → esquema roto (no descubre nada) → link-skills.sh --local lo reemplaza
if [ -L ".claude/skills" ]; then
  echo "BROKEN (symlink al repo: migrar a symlinks individuales)"

# 2. Es directorio con symlinks dentro → esquema individual → OK, no tocar
elif [ -d ".claude/skills" ] && ls -la .claude/skills/ | grep -q "^l"; then
  echo "CONNECTED (symlinks individuales)"

# 3. Es directorio vacio → instalar el hook y correr link-skills.sh --local
elif [ -d ".claude/skills" ] && [ -z "$(ls -A .claude/skills 2>/dev/null)" ]; then
  echo "EMPTY (instalar hook + link-skills.sh --local)"

# 4. Es directorio con archivos reales (no symlinks) → conflicto real
elif [ -d ".claude/skills" ]; then
  echo "CONFLICT (directorio con archivos reales)"

# 5. No existe → instalar el hook y correr link-skills.sh --local
else
  echo "MISSING (instalar hook + link-skills.sh --local)"
fi
```

**Solo el caso 2 esta bien conectado.** En 1, 3 y 5 instalar el hook y correr `--local`; en 4
preguntar (puede ser una decision deliberada, como en pickd).

En caso de conflicto (caso 4), preguntar al usuario si quiere respaldarlo y reemplazar con symlink.

Interpretar el resultado de project-setup.py:

| Status | Accion |
|---|---|
| `linked` | Exito — informar al usuario |
| `already_linked` | Ya conectado — no hacer nada |
| `exists_different_target` | Avisar al usuario, preguntar si quiere re-apuntar |
| `conflict` | Preguntar si quiere respaldar y reemplazar |
| `skipped` | No aplica (ej: cursor-rules no existe en el central) |
| `error` | Mostrar error en lenguaje simple |

Si hay que hacerlo a mano (sin el hook), un symlink **por skill**:
```bash
mkdir -p .claude/skills
ln -sfn "$SKILLS_PATH/global-skills/commit-craft" .claude/skills/commit-craft
```

### Paso 3: `.gitattributes`

Crear en la raiz del proyecto si no existe:
```
* text=auto eol=lf

*.js    text eol=lf
*.jsx   text eol=lf
*.ts    text eol=lf
*.tsx   text eol=lf
*.vue   text eol=lf
*.py    text eol=lf
*.sql   text eol=lf
*.prisma text eol=lf

*.json  text eol=lf
*.md    text eol=lf
*.yaml  text eol=lf
*.yml   text eol=lf
*.toml  text eol=lf
*.css   text eol=lf
*.html  text eol=lf
*.env*  text eol=lf

*.png   binary
*.jpg   binary
*.jpeg  binary
*.gif   binary
*.ico   binary
*.pdf   binary
*.woff  binary
*.woff2 binary
```

### Paso 4: `.gitignore` — entradas de Claude/Cursor

Agregar al `.gitignore` si no existen. Se necesitan AMBAS lineas para skills:

```gitignore
# Claude (skills symlink + local config)
.claude/skills
.claude/skills/
```

La primera linea captura el symlink. La segunda captura si fuera un directorio real.

Nota: NO ignorar `.claude/` completo — otros archivos dentro de `.claude/` (como `settings.json`, `CLAUDE.md` local) pueden ser utiles de trackear segun el proyecto.

Si tambien se configuro Cursor, agregar:
```gitignore
# Cursor (shared skills symlink)
.cursor/rules/shared
.cursor/rules/shared/
```

### Paso 5: `CLAUDE.md` — seccion Skills

Si existe `CLAUDE.md` en la raiz del proyecto, buscar la seccion `## Skills` y asegurar que incluya:

```markdown
## Skills

Las skills viven en el repo central `rafael1599/skills` (`$SKILLS_PATH`) y se conectan con un symlink **por skill** en `.claude/skills/<nombre>/` (Claude Code solo descubre SKILL.md a un nivel). Para actualizar: `git pull` en ese repo. Para (re)generar los symlinks o habilitar una skill nueva: editar la lista `SKILLS` de `.claude/hooks/link-skills.sh` y correr `bash .claude/hooks/link-skills.sh --local`. En Claude Code web el mismo hook los crea al iniciar la sesion.

### Preferencias de conexion
- Siempre usar **symlink** para conectar skills (nunca git clone dentro del proyecto)
```

Si no existe la seccion, agregarla al final del archivo.
Si ya existe pero menciona `git clone` o `cd .claude/skills && git pull` (symlink al repo completo), actualizarla a este texto.
Si no existe `CLAUDE.md` en un proyecto individual, crear uno basico con el nombre del proyecto y la seccion de skills.
Si no existe `CLAUDE.md` en la raiz de Projects, crearlo siguiendo la Parte 2.

### Paso 6: Linting

Instalar segun tipo de proyecto detectado en paso 1. Usar `<pm>` (package manager detectado) para todos los comandos. Solo crear configs que no existan — nunca modificar configs existentes.

**Si ya existe una config de ESLint** (cualquier formato: `.eslintrc.json`, `.eslintrc.js`, `eslint.config.js`, `eslint.config.mjs`, o campo `eslintConfig` en package.json), **no tocarla** — respetar la que ya este, sea legacy o flat config. Solo verificar que el script `"lint"` exista en package.json.

**React/Vite (JS):**
```bash
<pm> add -D eslint @eslint/js eslint-plugin-react-hooks eslint-plugin-react-refresh globals prettier
```
- Crear `eslint.config.js` (flat config ESLint 9)
- Crear `.prettierrc`: `{ "semi": true, "singleQuote": true, "tabWidth": 2, "printWidth": 100, "trailingComma": "es5" }`
- Agregar scripts: `"lint": "eslint ."`, `"format": "prettier --write ."`

**React/Vite (TS):** Lo mismo + `typescript-eslint`

**Nuxt 3/4:**
```bash
<pm> add -D @nuxt/eslint eslint
```
- Agregar `'@nuxt/eslint'` al array `modules` en `nuxt.config.ts`
- Agregar script: `"lint": "eslint ."`

**Node.js backend (TS):**
```bash
<pm> add -D eslint @eslint/js typescript-eslint globals
```
- Crear `eslint.config.mjs` con `globals.node`
- Agregar script: `"lint": "eslint ."`

**Python:**
- Agregar `ruff>=0.11.0` a `requirements.txt`
- Crear `ruff.toml`:
```toml
line-length = 100
target-version = "py311"

[lint]
select = ["E", "F", "I", "W"]
ignore = ["E501"]

[format]
quote-style = "double"
indent-style = "space"
```

### Paso 7: Pre-commit hooks

**JS/TS (cualquier variante):**
```bash
<pm> add -D husky lint-staged
npx husky init
```
- Editar `.husky/pre-commit` → `npx lint-staged`
- Agregar `lint-staged` config en `package.json` con extensiones del proyecto
- Ejemplo React TS: `{ "*.{ts,tsx}": ["eslint --fix"], "*.{ts,tsx,json,css,md}": ["prettier --check"] }`

Si `.husky/` ya existe pero `pre-commit` no ejecuta lint-staged, actualizarlo.
Si `husky` y `lint-staged` ya estan en devDependencies pero nunca se inicializo, ejecutar `npx husky init`.

**Python:**
- Crear `scripts/pre-commit` con ruff check + ruff format --check en archivos staged
- Copiar a `.git/hooks/pre-commit` y hacer ejecutable

**Monorepos:**
- Instalar husky + lint-staged en el root
- Configurar lint-staged con paths por package: `"packages/frontend/**/*.{ts,tsx}": [...]`

### Paso 8: `.env.example`

Buscar variables de entorno en el codigo:
- JS/TS: `import.meta.env.VITE_*`, `process.env.*`
- Python: `os.environ`, `os.getenv`, dotenv usage

Crear `.env.example` con las variables encontradas y valores vacios.
Solo crear si se encontraron variables y no existe ya un `.env.example`.

### Paso 9: Verificacion

Despues de completar todos los pasos, verificar que todo funciona:

```bash
python <project-setup.py> verify "<ruta-del-proyecto>"
```

Si verify reporta binarios faltantes, correr `<pm> install`.
Si verify reporta errores de lint preexistentes, avisar al usuario:
- "Hay X errores de lint preexistentes. El pre-commit hook bloqueara commits hasta que se arreglen. Quieres arreglarlos ahora o desactivar el hook temporalmente?"

Si el usuario quiere arreglar: correr `<pm> lint --fix` y commitear los fixes.
Si el usuario quiere desactivar: no eliminar .husky, solo informar que puede usar `git commit --no-verify` temporalmente.

---

## Parte 4 — Gestion de skills (comandos individuales)

Estos comandos se usan fuera del flujo de estandarizacion completo, cuando el usuario pide una accion especifica.

### Instalar skill desde GitHub

**Triggers:** "instala skill de...", "agrega esta skill...", "descarga skill..."

```bash
python <project-setup.py> install "<url-git>" --name "<nombre-opcional>"
```

La skill se instala en `external-skills/` del repo central y queda disponible en todos los proyectos automaticamente via symlinks.

### Listar skills

**Triggers:** "que skills tengo", "lista skills", "muestra mis skills"

```bash
python <project-setup.py> list
```

Presentar resultados en tabla legible con nombre y descripcion.

### Auditar skills

**Triggers:** "audita skills", "revisa seguridad", "hay algo sospechoso"

```bash
python <project-setup.py> audit
```

Mostrar hallazgos de forma clara. Si no hay findings, confirmar que todo esta limpio.
Al instalar skills de terceros, sugerir ejecutar audit despues.

### Ver proyectos configurados

**Triggers:** "que proyectos tienen skills", "donde estan mis skills", "lista proyectos"

```bash
python <project-setup.py> projects
```

### Crear nueva skill

**Triggers:** "crea una skill", "nueva skill", "quiero hacer una skill"

Preguntar:
1. Nombre de la skill
2. Es personal (compartida) o de proyecto (solo aqui)?
3. Descripcion breve de que debe hacer

Crear el scaffold:
- Si es personal: en el repo central `global-skills/<nombre>/SKILL.md`
- Si es de proyecto: en `<proyecto>/.claude/skills/project-skills/<nombre>/SKILL.md`

Generar SKILL.md con frontmatter y estructura inicial basada en la plantilla de `template/`.

### Sincronizar con remoto

**Triggers:** "sincroniza skills", "actualiza skills", "push skills", "pull skills"

Para subir cambios:
```bash
cd <repo-central> && git add -A && git commit -m "update skills" && git push
```

Para bajar cambios:
```bash
cd <repo-central> && git pull
```

Todo esta conectado via symlinks — un pull actualiza todos los proyectos.

### Ver o registrar repo central

**Triggers:** "donde esta el repo central", "ruta del central", "registrar repo"

Ver ubicacion:
```bash
python <project-setup.py> central
```

Registrar manualmente:
```bash
python <project-setup.py> central --set "<ruta-absoluta>"
```

### Clonar repo central

**Triggers:** "no tengo el repo", "clona el repo", "clonar skills"

```bash
python <project-setup.py> clone "<git_url>" [--dest "<ruta>"]
```

Clona en `~/dev/skills` por defecto y registra en cache.

### Sincronizar skills en un worktree

**Triggers:** "sync skills en este worktree", "los skills no aparecen en el worktree", "worktree-sync", "replicar skills del proyecto base"

Cuando se crea un `git worktree`, el directorio `.claude/skills/` queda vacio porque esta en `.gitignore`. Este comando replica los symlinks del worktree principal preservando el esquema exacto (symlink al repo completo O symlinks individuales por skill).

```bash
python <project-setup.py> worktree-sync "<ruta-del-worktree>"
```

El script:
1. Detecta el worktree principal via `git worktree list --porcelain`
2. Lee el estado de `.claude/skills/` del principal
3. Replica el mismo esquema en el worktree secundario

**Resultados posibles:**

| Status | Significado |
|---|---|
| `synced` | Creo los symlinks (`scheme` indica cual) |
| `synced_partial` | Ya habia symlinks, agrego los que faltaban comparado con el base (campo `added`) |
| `already_linked` | Ya existe symlink al repo — no hace nada |
| `already_individual_symlinks` | Ya existe dir con symlinks individuales y todos estan presentes — no hace nada |
| `conflict` | `.claude/skills/` tiene archivos reales — resolver manualmente |
| `error` | Ver `message` para detalle |

Es idempotente — se puede correr varias veces sin problema. Tambien es util despues de agregar una skill nueva al repo central: corre `worktree-sync` en cada worktree activo y agrega los symlinks que falten. **No estandariza nada mas** (no toca linting, hooks, gitattributes, etc.); asume que el worktree principal ya esta estandarizado.

---

## Que NO hacer

- No crear `.env.example` en proyectos de solo documentacion
- No instalar herramientas que el proyecto ya tiene — verificar antes
- No modificar configs de linting existentes — solo crear las que faltan
- No hacer commit de los cambios — dejar que el usuario decida cuando
- No asumir que el usuario quiere Claude + Cursor — preguntar
- No usar emojis en las respuestas
- Si project-setup.py retorna `{"error": "no_central"}`, seguir el flujo de descubrimiento (Parte 1) antes de continuar
- Si el script falla, leer el error y explicar al usuario en lenguaje simple
