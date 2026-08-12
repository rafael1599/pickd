# Drivly — DB Reference

## Conexion prod

Supabase project `gtpzupdynhqprzrlpmkp`. Connection string en `.env.staging`:

```
DATABASE_URL=postgresql://postgres.gtpzupdynhqprzrlpmkp:<password>@aws-1-us-east-1.pooler.supabase.com:6543/postgres
```

- Port 6543 = pooler (transaction mode). Works for `pg_dump` y queries pero NO para DDL streaming.
- Para DDL preferir `mcp__claude_ai_Supabase__apply_migration` o `execute_sql` (project_id `gtpzupdynhqprzrlpmkp`).
- Para queries read-only en Claude session: `mcp__claude_ai_Supabase__execute_sql`.

## ORM: Drizzle (snake_case)

Tablas con guion bajo, NO PascalCase. RLS activo en todas.

## Tablas clave

| Tabla | Descripcion |
|-------|-------------|
| `tenants` | Multi-tenant root. Tenant Excellent = `e0000000-0000-0000-0000-000000000001`, slug `excellent-taxi` |
| `fixed_routes` | Precios fijos por ruta (admin_override + operator_curated). `is_active=true` matchea, soft-delete con `is_active=false` |
| `town_brackets` | 116 rows = 29 towns × 4 brackets (Excellent). FLOOR pricing por distancia |
| `town_minimum_tiers` + `town_minimums` | Tiers de minimum override (e.g. "Origen = Spring Valley") |
| `pricing_rules` | Base rate per_km + minimum_fare + booking_fee |
| `whatsapp_auth_states` | Baileys creds. ⚠️ NUNCA replicar a local (kickea bot prod) |
| `whatsapp_handoffs` | Operator handoffs queue |
| `audit_log` | Append-only audit con hash-chain |

## Sync prod → local

Local docker postgres + Drivly API en host (PM2 o tsx-watch).

```bash
cd /path/to/drivly
.claude/skills/global-skills/prod-data/scripts/sync-prod-to-local.sh
```

Defaults para Drivly:
- `--env-file .env.staging`
- `--container drivly-postgres-1`
- `--db drivly`
- `--exclude-data whatsapp_auth_states,whatsapp_handoffs`

⚠️ **Antes de levantar API local**: set `ENABLE_WHATSAPP_SESSIONS=false` en `.env`. Sin esto, aun con creds excluded el boot scheduler intenta conectar y puede competir con prod en algunos casos edge.

## Queries especificas

### Conteo general
```sql
SELECT 'tenants' AS t, count(*) FROM tenants
UNION ALL SELECT 'fixed_routes_active', count(*) FROM fixed_routes WHERE is_active = true
UNION ALL SELECT 'town_brackets', count(*) FROM town_brackets
UNION ALL SELECT 'pricing_rules', count(*) FROM pricing_rules;
```

### Fixed_routes recientes (admin overrides)
```sql
SELECT origin_label, dest_label, fixed_price_cents/100.0 AS usd,
       entry_kind, geocode_source, created_at
FROM fixed_routes
WHERE tenant_id = 'e0000000-0000-0000-0000-000000000001'
  AND is_active = true
  AND entry_kind = 'admin_override'
ORDER BY created_at DESC
LIMIT 30;
```

### Town brackets para Excellent
```sql
SELECT town_label, bracket_index, up_to_miles,
       flat_cents/100.0 AS flat_usd, per_mile_cents/100.0 AS per_mi_usd
FROM town_brackets
WHERE tenant_id = 'e0000000-0000-0000-0000-000000000001'
ORDER BY town_label, bracket_index;
```

### Detectar fixed_routes corruptas (label/city mismatch)
```sql
SELECT id, origin_label, origin_city, origin_full_address, geocode_source
FROM fixed_routes
WHERE tenant_id = 'e0000000-0000-0000-0000-000000000001'
  AND is_active = true
  AND LOWER(origin_label) LIKE '%spring valley%'
  AND LOWER(COALESCE(origin_city, '')) NOT LIKE '%spring valley%';
```

## Reglas de negocio

- **Multi-tenant**: TODO query debe filtrar `tenant_id`. RLS GUC `app.tenant_id` debe estar set via `withTenantContext` en backend.
- **Audit trigger**: tablas con `record_audit_fn` trigger requieren `id` column como surrogate PK (memoria `feedback_audit_trigger_requires_surrogate_id`).
- **Money path**: cambios a `pricing_rules`, `town_brackets`, `fixed_routes`, `tenants.settings.pricing` requieren approval explícito.
- **Pre-prod (2026-05)**: pre-prod sin usuarios reales, rompe compat ceremonies aceptado (memoria `project_drivly_zero_production_data`).

## MCP Supabase tools

| Tool | Uso |
|---|---|
| `mcp__claude_ai_Supabase__execute_sql` | Query read-only o UPDATE puntual + verificación |
| `mcp__claude_ai_Supabase__apply_migration` | DDL (versioned migration file). Preferred sobre execute_sql para schema changes |
| `mcp__claude_ai_Supabase__list_migrations` | Ver historial de migrations applied |
| `mcp__claude_ai_Supabase__get_advisors` | Security/performance advisors |

Project ID: `gtpzupdynhqprzrlpmkp` (siempre pasar como `project_id` arg).
