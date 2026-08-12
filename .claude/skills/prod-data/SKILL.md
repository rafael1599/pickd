---
name: prod-data
description: >
  Operaciones con bases de datos de produccion y desarrollo: queries, migraciones,
  sync DB, reset, debugging, normalizacion de datos, limpieza de duplicados.
  Skill agnositca de proyecto — los detalles de conexion y tablas se leen del
  CLAUDE.md o scripts/ del proyecto actual.
  Triggers: "consulta prod", "datos de produccion", "query", "psql", "run sql",
  "muestra datos", "normaliza datos", "limpia duplicados", "db reset", "sync db",
  "migration", "schema drift", "test function", "database", "supabase", "neon".
---

# /prod-data — Operaciones de Base de Datos

Lee SOLO la seccion que aplica a tu caso. Si ninguno aplica, intenta por tu cuenta.

## Paso 0: Descubrir conexion del proyecto

Antes de cualquier operacion, busca como conectar:

1. Lee `CLAUDE.md` del proyecto — busca seccion de DB/Database/Supabase/Neon
2. Lee `.env` o `.env.local` del proyecto — busca `DATABASE_URL`, `DIRECT_URL`, `PROD_DB_URL`
3. Si hay `scripts/` en el proyecto, revisa si hay scripts de DB (sync, seed, reset)
4. Si usa Docker (Supabase local), busca el container name en `docker-compose.yml`

### Patrones de conexion comunes

| Setup | Comando |
|-------|---------|
| **Supabase remoto (CLI linked)** | **`npx supabase db query --linked "SQL"`** — preferido si el proyecto esta linked via `npx supabase link` |
| Supabase remoto (psql en host) | `/opt/homebrew/opt/libpq/bin/psql "$DIRECT_URL"` |
| Supabase local (Docker) | `docker exec CONTAINER psql -U postgres -d postgres -c "SQL"` |
| Supabase local (auth.*) | `docker exec -e PGPASSWORD=postgres CONTAINER psql -U supabase_admin -d postgres -c "SQL"` |
| Neon remoto | `/opt/homebrew/opt/libpq/bin/psql "$DATABASE_URL"` |
| Prisma (sin psql) | `pnpm prisma studio` o queries via codigo |

**Nota:** Para proyectos Supabase con `npx supabase link` configurado, `db query --linked` es el metodo preferido para produccion — no requiere leer `.env`, buscar connection strings, ni tener `psql` instalado en el host.

IMPORTANTE: Tablas Prisma usan PascalCase con comillas dobles (`"Driver"`, no `driver`). Tablas Supabase nativas usan snake_case.

---

## CASO 1: Ejecutar queries contra la DB

**Cuando:** Necesitas consultar datos, verificar estado, contar registros.

**Pasos:**
1. Descubrir conexion (Paso 0)
2. Ejecutar query
3. Mostrar resultado al usuario

**Para SQL multilinea:**
```bash
psql "$URL" <<'EOSQL'
SELECT ...;
UPDATE ...;
EOSQL
```

---

## CASO 2: Modificar datos en produccion

**Cuando:** El usuario pide cambiar, desactivar, o limpiar datos.

### Workflow obligatorio

1. **Diagnostico primero** — consultar que se va a cambiar y mostrarlo al usuario
2. **Confirmar** — pedir aprobacion explicita antes de ejecutar
3. **Desactivar, no borrar** — si la tabla tiene `isActive`, usar `UPDATE SET isActive = false`. Nunca DELETE salvo que el usuario lo pida explicitamente
4. **Verificar** — despues de modificar, consultar de nuevo para confirmar el cambio

### Normalizacion de duplicados

Si el usuario pide limpiar duplicados:

1. Buscar por label/nombre exacto:
```sql
SELECT campo, count(*) as dupes FROM tabla WHERE activo = true
GROUP BY campo HAVING count(*) > 1;
```

2. Buscar por proximidad geografica (si aplica):
```sql
SELECT a.id, b.id, a.label, b.label
FROM tabla a JOIN tabla b ON a.id < b.id
WHERE ABS(a.lat - b.lat) < 0.005 AND ABS(a.lng - b.lng) < 0.005;
```

3. Desactivar los mas viejos, mantener el mas reciente:
```sql
-- Mostrar primero
SELECT id, label, price, created_at FROM tabla WHERE ... ORDER BY created_at DESC;
-- Desactivar todos menos el mas reciente
UPDATE tabla SET is_active = false WHERE id IN (...ids viejos...);
```

---

## CASO 3: Migraciones de schema

**Cuando:** Necesitas agregar/modificar tablas, columnas, funciones.

### Con Prisma (Express/Node projects)
```bash
# Editar prisma/schema.prisma
pnpm prisma db push          # Dev/staging
pnpm prisma migrate deploy   # Produccion
pnpm prisma generate          # Regenerar client
```

### Con Supabase CLI (proyectos Supabase-native)
```bash
npx supabase migration new nombre_migracion
# Editar supabase/migrations/TIMESTAMP_nombre.sql
npx supabase db reset         # Aplicar local
npx supabase db push          # Aplicar prod
```

> 🛑 **EXCEPCIÓN — DRIVLY (y cualquier repo con convención `.up.sql`/`.down.sql`):**
> NO usar `supabase db push` para prod. Ese repo tiene DOS archivos por versión
> (`.up.sql` + `.down.sql`), que el CLI ve duplicados e intentaría aplicar los
> `.down` (revert) o explota; además el tracking de prod está desfasado.
> Verificado 2026-05-30 (el schema está sano — es el mecanismo, no el esquema).
> **En drivly cada cambio de schema va por el MCP `apply_migration(name, query)`**
> (aplica + registra el tracking). `scripts/migrate-prod.sh` ahora aborta solo en
> estos repos. Ref: `drivly/docs/supabase-cli-workflow.md`.

### Reglas
- `CREATE OR REPLACE FUNCTION` para funciones (idempotente)
- `ADD COLUMN IF NOT EXISTS` para columnas
- Incluir `GRANT` para `anon`, `authenticated`, `service_role` (Supabase)
- Nunca DROP sin confirmacion explicita del usuario

---

## CASO 4: Sync entre bases de datos

**Cuando:** "sync db", "jala datos", "schema drift", "sincroniza".

### Clasificar que pide el usuario

| Palabra clave | Tipo |
|---------------|------|
| "datos", "data", "jala", generico | DATA |
| "schema", "migraciones", "estructura", "drift" | SCHEMA |

Default = DATA.

### Sync DATA: prod -> local

**Preferred: skill's `sync-prod-to-local.sh` (added 2026-05-15 post Drivly bot incident)**:

```bash
.claude/skills/global-skills/prod-data/scripts/sync-prod-to-local.sh
```

Defaults safe:
- Reads `DATABASE_URL` from `.env.staging`
- Auto-detects local docker postgres container
- **Excludes data** of `whatsapp_auth_states,whatsapp_handoffs` (replicating Baileys creds kicks prod bot off WhatsApp via stream-replaced)
- Verifies post-restore with tenant + key table counts

Override via flags: `--env-file`, `--container`, `--db`, `--exclude-data`, `--keep-dump`, `--no-verify`. See `--help`.

**Manual fallback** (if no skill script available):
1. Buscar si existe `scripts/sync-local-db.sh` o similar en el proyecto
2. **Antes de ejecutar el sync, verificar que el schema local existe:**
   - Supabase: `docker exec CONTAINER psql -U postgres -d postgres -tc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';"` — si es 0, ejecutar `npx supabase db reset` primero
   - Prisma: verificar que `pnpm prisma migrate deploy` esta al dia
   - Sin esto, el dump se importa pero no hay tablas donde insertar → datos perdidos silenciosamente
3. **CRITICAL**: usar `--exclude-table-data` para tablas con runtime auth state (e.g. WhatsApp Baileys creds). Sin esto, local re-conecta a servicios externos con creds duplicados y compite con prod.
4. Hacer pg_dump + psql via docker exec (pg_dump rara vez en host PATH en Windows)

### Sync SCHEMA: prod -> local
- Supabase: `npx supabase db pull && npx supabase db reset`
- Prisma: `pnpm prisma db pull && pnpm prisma generate`

### Reglas
- NUNCA modificar produccion sin que el usuario lo pida explicitamente
- Si un script necesita env vars (PROD_DB_URL), avisar al usuario
- Despues de reset, recrear datos de prueba si hay seed script

---

## CASO 5: Debugging de errores de DB

**Cuando:** Una operacion falla con error de Postgres/Supabase.

| Error | Causa | Fix |
|-------|-------|-----|
| `violates foreign key constraint` | Falta registro padre | Insertar padre primero |
| `must be owner of table` | Usuario incorrecto | Usar superuser (supabase_admin) |
| `column X does not exist` | Schema drift | Verificar schema, aplicar migracion |
| `duplicate key value violates unique constraint` | Dato duplicado | Verificar si ya existe antes de insertar |
| `permission denied` | Falta GRANT | `GRANT EXECUTE ON FUNCTION ... TO roles;` |
| `could not translate host name` | DNS no resuelve | Verificar URL, probar otro puerto/host |
| `relation "public.X" does not exist` (post-sync) | Schema local vacio — `supabase start` no aplica migraciones | `npx supabase db reset` y re-sync |
| Sync "completo" pero row counts vacios | Mismo: schema no existe, data se descarto | Verificar table count, reset, re-sync |
| `connection refused` | DB no esta corriendo | Verificar Docker/servicio |
| `FATAL: Authentication error` | Password o user incorrecto | Verificar .env |
| `Error status 502` despues de reset | Normal — container reiniciando | Esperar 10s |

---

## CASO 6: Ver estructura de tablas/funciones

```sql
-- Columnas de una tabla
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns WHERE table_name = 'TABLA' ORDER BY ordinal_position;

-- Codigo de una funcion
SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'NOMBRE';

-- Triggers
SELECT trigger_name, event_manipulation, action_statement
FROM information_schema.triggers WHERE event_object_table = 'TABLA';

-- Constraints
SELECT conname, contype, pg_get_constraintdef(oid)
FROM pg_constraint WHERE conrelid = 'public.TABLA'::regclass;
```

---

## CASO 7: Scripts de proyecto

Algunos proyectos tienen scripts especificos en `scripts/`. Antes de reinventar, verifica:

```bash
ls scripts/*db* scripts/*sync* scripts/*seed* scripts/*migrate* 2>/dev/null
```

Si existen, usalos. Son la fuente de verdad para ese proyecto.

---

## Que NO hacer

- No ejecutar DDL en produccion sin confirmacion explicita
- No hacer DELETE — usar soft-delete (isActive, deleted_at)
- No modificar datos sin mostrar primero que se va a cambiar
- No exponer connection strings ni passwords al usuario
- No usar `npx supabase db push` para local (solo prod)
- No intentar `psql` en host si solo existe en Docker container
- No asumir el formato de tablas — verificar si es PascalCase (Prisma) o snake_case (Supabase)
