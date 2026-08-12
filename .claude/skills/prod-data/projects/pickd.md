# PickD — DB Reference

## Conexion

### Local (Docker)

| Usuario | Comando | Acceso |
|---------|---------|--------|
| `postgres` | `docker exec supabase_db_pickd psql -U postgres -d postgres -c "SQL"` | `public.*` |
| `supabase_admin` | `docker exec -e PGPASSWORD=postgres supabase_db_pickd psql -U supabase_admin -d postgres -c "SQL"` | `auth.*`, `public.*`, triggers, grants |

### Produccion (metodo preferido)

```bash
npx supabase db query --linked "SELECT * FROM inventory LIMIT 5;"
```

Usa el proyecto ya vinculado via `npx supabase link` (ya configurado). No leer `.env` ni usar `psql` directo para queries de produccion.

### Lo que NO funciona
- `psql` en el host — solo existe dentro del container
- `npx supabase db exec` — no existe como subcomando
- Leer `.env` para connection strings + `psql` directo — usar `db query --linked` en su lugar
- `-U postgres` para `auth.*` — necesita `supabase_admin`

## ORM: Supabase Client (snake_case)

## Scripts disponibles

| Script | Funcion |
|--------|---------|
| `bash scripts/sync-local-db.sh` | Sync completo prod→local (auth + public, paralelo) |
| `node scripts/compare-schemas.js` | Detectar schema drift local vs prod |
| `supabase/create_users.sql` | Crear usuarios de prueba despues de db reset |
| `scripts/db-health-map.json` | Historial de drifts y resoluciones |

## Reset de DB local

```bash
npx supabase db reset
# Despues del reset, recrear usuarios:
docker exec -e PGPASSWORD=postgres -i supabase_db_pickd psql -U supabase_admin -d postgres < supabase/create_users.sql
```

Gotchas: Error 502 al final es normal (container reiniciando). DB queda vacia post-reset.

## Usuarios E2E

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@test.com | password123 |
| Staff | staff@test.com | password123 |
| Prod users | (from profiles) | 1111 |

## Reglas auth.users
- Orden FK: `auth.users` primero, `public.profiles` despues
- Campos string: TODOS `''` (vacio), NUNCA `NULL` — GoTrue crashea
- Identities: necesarias para que login funcione

## Sync workflows

### Data: prod→local

**IMPORTANTE:** Antes de sync, verificar que el schema local exista. Si la DB esta vacia (post `supabase start` sin `db reset`, o primera vez), el sync importa data pero no hay tablas — falla silenciosamente.

```bash
# 1. Verificar schema (si 0 → hacer reset primero)
docker exec supabase_db_pickd psql -U postgres -d postgres -tc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';"

# 2. Si no hay tablas: aplicar migraciones
npx supabase db reset

# 3. Sync data
bash scripts/sync-local-db.sh
```

**Señales de schema vacio post-sync:**
- Row counts muestra solo `auth.users` y nada de public
- Errores `relation "public.X" does not exist` en el output del script
- El script reporta "Sync complete" pero sin datos utiles

### Schema: prod→local
```bash
npx supabase db pull
npx supabase db reset
# + recrear usuarios
```

### Schema: local→prod
1. `node scripts/compare-schemas.js`
2. Verificar RPCs del frontend: `grep -r "\.rpc(" src/ --include="*.ts" -h`
3. `npx supabase migration new nombre`
4. `npx supabase db push`
5. Actualizar `scripts/db-health-map.json`

## RPCs frecuentes — firmas reales

**Regla:** SIEMPRE consultar la firma antes de llamar un RPC:
```sql
SELECT pg_get_function_arguments(oid) FROM pg_proc WHERE proname = 'nombre_funcion';
```

**`move_inventory_stock`** (11 params):
```sql
SELECT move_inventory_stock(
  '03-XXXXXX',        -- p_sku text
  'LUDLOW',           -- p_from_warehouse (siempre LUDLOW en PickD)
  'ROW N',            -- p_from_location
  'LUDLOW',           -- p_to_warehouse (siempre LUDLOW)
  'ROW M',            -- p_to_location
  4,                  -- p_qty integer
  'Performed by',     -- p_performed_by text
  'uuid'::uuid,       -- p_user_id (optional)
  'staff',            -- p_user_role (optional)
  NULL,               -- p_internal_note (optional)
  NULL                -- p_sublocation text[] (optional)
);
```

> **Warehouse = `LUDLOW`**, NO `MAIN`. Usar `MAIN` causa `Source item not found or inactive`.
