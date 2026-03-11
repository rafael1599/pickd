---
name: sync-db
description: "Sincronización de base de datos local ↔ producción con Supabase. Usa este skill cuando el usuario mencione sincronizar bases de datos, sincronizar data, revisar si está sincronizado, check de BD, comparar local con producción, schema drift, migraciones pendientes, jalar data de prod, o cualquier variante en español o inglés sobre el estado de su base de datos local vs producción."
---

# /sync-db — Sincronización DB local ↔ producción

## Clasificación (lee el mensaje del usuario)

| Palabra clave | Tipo |
|---------------|------|
| "sincroniza", "jala datos", "sync data", "data de prod", genérico sin contexto | **DATA** |
| "schema drift", "migraciones", "estructura", "sync schema" | **SCHEMA** |

Default = **DATA**.

---

## TIPO 1: DATA (prod → local)

Ejecuta el script y reporta el resultado:

```bash
bash scripts/sync-local-db.sh
```

Eso es todo. El script hace dump de prod, trunca local, importa auth + public, verifica conteos, y limpia temps. Si falla, muestra el error.

---

## TIPO 2: SCHEMA (estructura)

- **prod→local:** `npx supabase db pull` → `npx supabase db reset`
- **local→prod:** Caso 5 del skill `/supabase` (compare → migrate → push)
- **Diagnóstico:** `node scripts/compare-schemas.js` + `npx supabase migration list`

---

## TIPO 3: Ambos

Si al hacer DATA hay errores de columnas/tablas faltantes → ejecutar SCHEMA primero, DATA después.
