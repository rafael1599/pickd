# Excellent Taxi — DB Reference

## Conexion

```bash
/opt/homebrew/opt/libpq/bin/psql "postgresql://postgres.ukmqzyzmctsiidtdatuu:ZGY4tbLQx8ZacyLR@aws-1-us-east-1.pooler.supabase.com:5432/postgres"
```

- Puerto 5432 = session mode (DDL, \dt funciona)
- Puerto 6543 = transaction mode (runtime, \dt no muestra tablas)
- Siempre usar 5432 para consultas manuales

## ORM: Prisma (PascalCase con comillas dobles)

## Tablas

| Tabla | Descripcion |
|-------|-------------|
| `"Company"` | Empresas de taxi (tenant root) |
| `"Driver"` | Choferes (authToken, isOnline, companyId) |
| `"Trip"` | Viajes (status, driverId, price, coords) |
| `"User"` | Usuarios admin (JWT auth, role, companyId) |
| `"Employee"` | Empleados (time tracking) |
| `"PriceOverride"` | Precios fijos por ruta (admin, bidireccional) |
| `"PendingBooking"` | Reservas en progreso del bot |

## Queries especificas

### Conteo general
```sql
SELECT 'companies' as tbl, count(*) FROM "Company"
UNION ALL SELECT 'drivers', count(*) FROM "Driver"
UNION ALL SELECT 'trips', count(*) FROM "Trip"
UNION ALL SELECT 'users', count(*) FROM "User"
UNION ALL SELECT 'overrides', count(*) FROM "PriceOverride" WHERE "isActive" = true;
```

### Price overrides activos
```sql
SELECT "originLabel", "destLabel", price, "radiusMiles", "createdAt"::date
FROM "PriceOverride" WHERE "isActive" = true ORDER BY "createdAt" DESC;
```

### Duplicados de overrides por proximidad geo
```sql
SELECT a.id, b.id, a."originLabel", a.price, b."originLabel", b.price
FROM "PriceOverride" a JOIN "PriceOverride" b ON a.id < b.id
WHERE a."isActive" = true AND b."isActive" = true
  AND ABS(a."originLat" - b."destLat") < 0.005
  AND ABS(a."originLng" - b."destLng") < 0.005
  AND ABS(a."destLat" - b."originLat") < 0.005
  AND ABS(a."destLng" - b."originLng") < 0.005;
```

## Reglas de negocio

- Price overrides: un override cubre ida Y vuelta (matching bidireccional en codigo)
- Si multiples overrides matchean la misma ruta, el mas reciente (createdAt DESC) gana
- Radio default de matching: 0.2 millas
- Para desactivar: `UPDATE "PriceOverride" SET "isActive" = false WHERE id = '...'`
