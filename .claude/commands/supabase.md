---
name: supabase
description: "Operaciones con Supabase en Roman-app: testing SQL local, migraciones, sync DB, reset, queries, debugging de RPCs. Usa este skill cuando el agente necesite interactuar con Supabase de cualquier forma — ejecutar SQL, testear funciones, crear migraciones, sincronizar bases de datos, resolver errores de DB, o cualquier operación que involucre la base de datos local o remota. Triggers: 'test sql', 'run query', 'supabase', 'migration', 'db reset', 'sync db', 'check db', 'psql', 'rpc error', 'schema drift', 'test function', 'database'."
---

# /supabase — Operaciones Supabase para Roman-app

## Instrucciones para el agente

Lee SOLO la sección que aplica a tu caso. Si ningún caso aplica, cierra este skill e intenta por tu cuenta.

---

## CASO 1: Ejecutar SQL contra la DB local

**Cuándo:** Necesitas ejecutar queries, testear funciones, insertar datos de prueba, o verificar estado de tablas.

**Comando:**
```bash
docker exec -i supabase_db_Roman-app psql -U postgres -d postgres -c "<SQL>"
```

**Para SQL multilínea:**
```bash
docker exec -i supabase_db_Roman-app psql -U postgres -d postgres <<'EOSQL'
SELECT ...;
UPDATE ...;
EOSQL
```

**FK obligatoria:** Si insertas en `inventory`, primero inserta en `sku_metadata`:
```sql
INSERT INTO sku_metadata (sku) VALUES ('SKU') ON CONFLICT DO NOTHING;
```

**No uses:** `npx supabase db query` (no funciona), `psql` directo (no instalado).

---

## CASO 2: Aplicar migraciones locales

**Cuándo:** Creaste un nuevo archivo en `supabase/migrations/` y necesitas aplicarlo.

**Comando:**
```bash
npx supabase db reset
```

Esto borra y recrea la DB local aplicando TODAS las migraciones en orden. Output esperado: lista de `Applying migration ...` terminando con `Finished supabase db reset`.

**Naming de migraciones:** `YYYYMMDDHHMMSS_descripcion.sql` (ejemplo: `20260310000001_adjust_distribution.sql`).

**No uses:** `npx supabase db push` para local — eso es solo para producción.

---

## CASO 3: Testear una función RPC

**Cuándo:** Necesitas verificar que una función SQL/RPC funciona correctamente.

**Pasos:**
1. Setup datos de prueba (ver Caso 1 para el comando)
2. Ejecutar la función: `SELECT public.nombre_funcion(params);`
3. Verificar resultado: `SELECT columnas FROM tabla WHERE condicion;`
4. Limpiar: `DELETE FROM tabla WHERE condicion;`

**Usuario de prueba (si el RPC requiere uuid):**
```sql
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token)
VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test@test.com', '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012345', NOW(), NOW(), NOW(), '', '')
ON CONFLICT DO NOTHING;
```

---

## CASO 4: Ver estructura de una tabla o función

**Cuándo:** Necesitas ver columnas, tipos, constraints, o el body de una función.

**Tabla:**
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns WHERE table_name = 'TABLA' ORDER BY ordinal_position;
```

**Función (ver código):**
```sql
SELECT prosrc FROM pg_proc WHERE proname = 'NOMBRE_FUNCION';
```

**Constraints:**
```sql
SELECT conname, contype, pg_get_constraintdef(oid)
FROM pg_constraint WHERE conrelid = 'public.TABLA'::regclass;
```

---

## CASO 5: Sincronización DB local ↔ producción

**Cuándo:** El usuario dice "sync db", "check db", "estoy sincronizado", "schema drift", "sync prod→local", "sync local→prod", "sincroniza", "jala la data".

### ⚠️ PRIMERO: Clasificar qué pide el usuario

| Palabra clave | Tipo |
|---------------|------|
| "sincroniza", "jala datos", "sync data", "data de prod", genérico sin contexto | **DATA** |
| "schema drift", "migraciones", "estructura", "sync schema" | **SCHEMA** |

**Default = DATA** (es lo más común).

### Sync DATA: prod → local

**Un solo comando. No pienses, no diagnostiques, solo ejecuta:**

```bash
bash scripts/sync-local-db.sh
```

El script hace todo automáticamente: dump de prod (auth + public en paralelo), trunca local, importa en orden correcto como superuser, verifica conteos, y limpia temps.

**Requisitos:** Docker corriendo + `npx supabase start` + `PROD_DB_URL` en `.env`.

Si el script falla por columnas/tablas faltantes → ejecutar sync de SCHEMA primero y después DATA.

### Sync SCHEMA: prod → local

```bash
npx supabase db pull
npx supabase db reset
```

### Sync SCHEMA: local → prod

1. `node scripts/compare-schemas.js` — identifica diffs
2. Frontend check — verifica qué usa el frontend antes de tocar algo:
   ```bash
   grep -r "\.rpc(" src/ --include="*.ts" --include="*.tsx" -h | grep -oP "(?<=\.rpc\()['\"][^'\"]+['\"]" | sort -u
   grep -r "\.from(" src/ --include="*.ts" --include="*.tsx" -h | grep -oP "(?<=\.from\()['\"][^'\"]+['\"]" | sort -u
   ```
3. Lee `scripts/db-health-map.json` si existe — revisa si el drift actual ya ocurrió antes y cómo se resolvió
4. Clasifica cambios: ADD COLUMN/CREATE FUNCTION = seguro. DROP/RENAME = peligroso (pedir confirmación)
5. `npx supabase migration new [nombre]` + escribe SQL
6. `npx supabase db push`
7. Verifica con `npx supabase migration list`
8. Actualiza `scripts/db-health-map.json`

### Modo revisión (solo diagnóstico)

```bash
node scripts/compare-schemas.js
npx supabase migration list
```

**Reglas:**
- **NUNCA** ejecutes `db push`, `migration repair`, o cualquier comando que modifique producción sin que el usuario lo pida EXPLÍCITAMENTE
- Nunca DROP sin confirmación explícita
- Si `compare-schemas.js` requiere `PROD_DB_URL` en `.env`, avisa al usuario
- Si una RPC del frontend grep no existe en el schema destino, bloquea y advierte
- Ante la duda entre modificar prod o preguntar al usuario, SIEMPRE pregunta

---

## CASO 6: Debugging de errores de DB

**Cuándo:** Una operación falla con error de Supabase/Postgres.

**Errores comunes:**

| Error | Causa | Fix |
|-------|-------|-----|
| `violates foreign key constraint "inventory_sku_fkey"` | Falta entry en `sku_metadata` | `INSERT INTO sku_metadata (sku) VALUES ('X') ON CONFLICT DO NOTHING;` |
| `there is no unique or exclusion constraint matching the ON CONFLICT` | ON CONFLICT mal escrito | Verifica el constraint real con Caso 4 |
| `function X does not exist` | Migración no aplicada | `npx supabase db reset` |
| `permission denied` | Falta GRANT | `GRANT EXECUTE ON FUNCTION public.X TO anon, authenticated, service_role;` |
| `column X does not exist` | Schema drift | Verifica con Caso 4, aplica migración si falta |

---

## CASO 7: Crear una nueva migración

**Cuándo:** Necesitas agregar/modificar tablas, columnas, funciones, o RPCs.

**Pasos:**
1. Crea el archivo: `supabase/migrations/YYYYMMDDHHMMSS_descripcion.sql`
2. Usa `CREATE OR REPLACE FUNCTION` para funciones (idempotente)
3. Usa `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` para columnas
4. Incluye `GRANT` al final para `anon`, `authenticated`, `service_role`
5. Aplica: `npx supabase db reset`
6. Testea (Caso 3)

**Template para función:**
```sql
CREATE OR REPLACE FUNCTION public.mi_funcion(p_param1 text, p_param2 integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- lógica
  RETURN v_result;
END;
$$;

ALTER FUNCTION public.mi_funcion(text, integer) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.mi_funcion(text, integer) TO anon, authenticated, service_role;
```

---

## Referencia rápida del entorno

| Dato | Valor |
|------|-------|
| Container DB | `supabase_db_Roman-app` |
| Puerto local | `54322` |
| Usuario lectura | `postgres` (NO es superuser) |
| **Superuser (para imports/triggers)** | `supabase_admin` con `-e PGPASSWORD=postgres` |
| DB | `postgres` |
| psql / pg_dump | Solo dentro del container — NO están en el host |
| supabase CLI | `npx supabase` |
| Migraciones dir | `supabase/migrations/` |
| Scripts | `scripts/compare-schemas.js`, `scripts/sync-local-db.sh`, `scripts/db-health-map.json` |
