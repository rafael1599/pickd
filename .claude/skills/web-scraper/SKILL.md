---
name: web-scraper
version: 1.0.0
description: >
  Scraping de sitios web para extraer datos estructurados (imagenes, catalogos, precios, specs).
  Usar cuando el usuario pida "scrape", "extraer datos de un sitio", "descargar imagenes de",
  "hacer scraping", "sacar info de la pagina", "catalog scrape", o cualquier variacion de
  extraccion automatizada de datos web. NO usar para APIs con documentacion — eso es consumo
  de API, no scraping.
license: MIT
author: "Rafael Lopez"
metadata:
  category: automation
  tags:
    - scraping
    - web
    - data-extraction
    - images
allowed-tools:
  - Bash
  - Read
  - Write
  - Glob
  - Grep
  - Agent
---

# Web Scraper

Skill para extraer datos estructurados de sitios web y guardarlos localmente o subirlos a almacenamiento externo.

## Workflow

### Paso 1: Reconocimiento

1. Navegar la estructura del sitio objetivo para entender el patron de URLs
2. Identificar el formato de datos (HTML con imagenes, JSON embebido, tablas, etc.)
3. Determinar si el sitio tiene:
   - Paginacion (next page, infinite scroll, offset params)
   - Rate limiting (headers, delays necesarios)
   - Contenido dinamico (requiere headless browser vs fetch directo)

### Paso 2: Elegir estrategia

| Escenario | Herramienta |
|---|---|
| HTML estatico, imagenes directas | `fetch` nativo de Node.js |
| HTML con datos en JSON embebido | `fetch` + regex/parse del `<script>` tag |
| Sitio con JS rendering | Playwright (solo si fetch no funciona) |
| API JSON expuesta | `fetch` directo (no es scraping, pero aplica) |
| WordPress con imagenes | `fetch` + limpiar sufijos de resize (`-600x400`, `_600px`) |

### Paso 3: Crear script de extraccion

Crear un script `.mjs` (ESM) en `scripts/` del proyecto. Estructura base:

```javascript
import { writeFileSync } from 'fs';

const BASE_URL = '<SITE_URL>';
const OUTPUT_FILE = '<OUTPUT_PATH>';
const DELAY_MS = 500; // Respetar rate limits

async function scrape() {
  const results = [];

  // Logica de extraccion...

  writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  console.log(`Extracted ${results.length} items → ${OUTPUT_FILE}`);
}

scrape().catch(console.error);
```

### Paso 4: Limpiar datos

- Normalizar nombres (trim, case consistency)
- Eliminar duplicados
- Validar URLs de imagenes (fetch HEAD para verificar 200)
- Para imagenes WordPress: remover sufijos de resize para obtener full-res:
  ```javascript
  url.replace(/_\d+px(-\d+x\d+)?\.(\w+)/, '.$2')
     .replace(/-\d+x\d+\.(\w+)/, '.$1')
  ```

### Paso 5: Guardar resultado

- Datos estructurados → `src/data/<nombre>.json`
- El JSON debe ser versionable (formato pretty con 2 espacios)
- Agregar al `.gitignore` si contiene datos efimeros

## Decisiones automaticas

- **Rate limiting**: si el sitio devuelve 429, agregar delay exponencial (500ms → 1s → 2s)
- **Imagenes rotas**: loguear y continuar, no abortar el scrape completo
- **Encoding**: asumir UTF-8. Si hay caracteres rotos, probar latin1
- **Tamanio de imagenes**: si una imagen pesa >2MB, comprimirla con `sharp` antes de guardar

## Errores comunes

| Error | Causa | Solucion |
|---|---|---|
| `403 Forbidden` | User-agent bloqueado | Agregar header `User-Agent: Mozilla/5.0...` |
| `ECONNRESET` | Rate limit agresivo | Aumentar delay entre requests |
| Imagenes cortadas/thumbnail | WordPress resize suffix | Usar regex de limpieza de sufijos |
| `CERT_HAS_EXPIRED` | SSL vencido en sitio | `NODE_TLS_REJECT_UNAUTHORIZED=0` (solo scraping) |

## Referencias
- [Node.js fetch API](https://nodejs.org/docs/latest/api/globals.html#fetch)
- [Sharp image processing](https://sharp.pixelplumbing.com/)
