---
name: catalog-images
version: 1.0.0
description: >
  Descargar imagenes del catalogo JAMIS Bikes, subirlas a Cloudflare R2, y vincularlas
  con el inventario via sku_metadata. Usar cuando el usuario pida "actualizar imagenes
  del catalogo", "agregar fotos de bikes", "sync catalog images", "subir imagenes de JAMIS",
  o cuando se agreguen nuevos modelos al inventario que no tienen imagen.
license: MIT
author: "Rafael Lopez"
metadata:
  category: data-migration
  tags:
    - jamis
    - catalog
    - r2
    - images
allowed-tools:
  - Bash
  - Read
  - Write
  - Glob
  - Grep
  - Agent
---

# Catalog Images — PickD

Migrar imagenes del catalogo JAMIS Bikes desde jamisbikes.com a Cloudflare R2 y vincularlas con SKUs del inventario.

## Ejecucion rapida

```bash
# Desde el directorio del proyecto pickd:
SKILL_DIR=".claude/skills/project-skills/pickd/catalog-images"

# Descargar imagenes y subir a R2
node $SKILL_DIR/scripts/migrate.mjs --download

# Vincular con inventario (upsert sku_metadata)
node $SKILL_DIR/scripts/migrate.mjs --link

# Ambos pasos
node $SKILL_DIR/scripts/migrate.mjs --all

# Preview sin cambios
node $SKILL_DIR/scripts/migrate.mjs --all --dry-run
```

## Prerequisitos

Variables de entorno en `.env` del proyecto:
```
R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_DOMAIN
```

Para produccion, agregar:
```
SUPABASE_URL=https://<PROJECT_REF>.supabase.co
SUPABASE_SERVICE_KEY=<service_role_key>
```

Sin estas, el script apunta a Supabase local (`127.0.0.1:54321`).

Dependencias: `@aws-sdk/client-s3`, `sharp` (opcional, solo para compresion), `dotenv`

## Arquitectura

```
jamisbikes.com → fetch hi-res → compress (si >1MB) → R2: catalog/<model>.png
                                                              ↓
inventory.item_name → MATCH_RULES (regex) → sku_metadata.image_url
```

### URLs en la app

- Full-size: `<R2_PUBLIC_DOMAIN>/catalog/<model>.png`
- Thumbnail: `<R2_PUBLIC_DOMAIN>/catalog/thumbs/<model>.webp` (auto-generado)

La app convierte automaticamente en `InventoryCard.tsx` y `DoubleCheckView.tsx`:
```
/catalog/<model>.png → /catalog/thumbs/<model>.webp
```

## Agregar un modelo nuevo

1. Agregar entrada en `references/jamisBikeCatalog.json` (name, category, imageUrl)
2. Agregar catalogKey en `CATALOG_MAP` del script
3. Agregar regla en `MATCH_RULES` del script (**variantes especificas ANTES que genericas**)
4. Ejecutar: `node $SKILL_DIR/scripts/migrate.mjs --all`

## Reglas de matching

El orden importa. Variantes especificas van ANTES que las genericas:

```
RENEGADE C → carbon-renegade   (antes que RENEGADE generico)
HIGHPOINT.*V2 → highpoint-v2   (antes que HIGHPOINT generico)
HUDSON E2 → hudson-e2           (antes que HUDSON generico)
```

Aliases mapean multiples item_names a la misma imagen:
```
BOSS CRUISER, BC7, BCCB → boss-cruiser
EARTH CRUISER, EC[0-9]  → earth-cruiser
```

Kids usan prefijo JUV:
```
JUV MISS DAISY → miss-daisy
JUV LASER 1.6  → laser-16
JUV XR.20      → xr20
```

## Decisiones automaticas

- **Imagen >1MB**: comprimir con sharp (1600px max width)
- **SKU ya tiene imagen**: no sobreescribir (protege fotos manuales de usuario)
- **WordPress resize suffix**: se remueve automaticamente para obtener full-res
- **Hi-res 404**: fallback a URL original del catalogo

## Archivos del skill

```
catalog-images/
├── SKILL.md                              ← Este archivo
├── scripts/
│   └── migrate.mjs                       ← Script consolidado (--download, --link, --all)
└── references/
    └── jamisBikeCatalog.json             ← Catalogo: nombre, categoria, imageUrl fuente
```
