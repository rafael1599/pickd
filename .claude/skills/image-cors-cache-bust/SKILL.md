---
name: image-cors-cache-bust
description: >
  Diagnostica y arregla el bug recurrente de imagenes cross-origin que fallan al
  exportar a PDF, renderizar a canvas, o fetchear como blob — incluso cuando el
  bucket tiene CORS configurado correctamente. Causa raiz: el browser cachea la
  response sin headers CORS (desde un <img> renderizado sin crossOrigin) y luego
  reusa esa entrada stale cuando codigo posterior intenta acceder con CORS.
  Activar cuando el usuario reporta: "las imagenes no aparecen en el PDF",
  "html2canvas CORS error", "canvas tainted", "SecurityError al exportar imagen",
  "image fetch failed pero R2/S3 tiene CORS", "No Access-Control-Allow-Origin
  header is present" (despite bucket responding with it in curl), "imagenes en
  blanco al descargar", "blob fetch falla en imagen publica", "tainted canvases
  may not be exported", o cualquier combinacion de "CORS" + "imagen" + "cache"
  + "export/download/PDF/canvas/blob".
allowed-tools:
  - Read
  - Edit
  - Write
  - Grep
  - Bash
---

# Image CORS Cache-Bust

Skill de diagnostico para un bug especifico y recurrente: **el browser cachea una image response sin metadata CORS, y despues el codigo falla al intentar leer/exportar esa imagen con CORS — incluso si el bucket devuelve ACAO correctamente**.

No es un bug del bucket. Es un bug del cache del browser + mezcla de modos de request.

---

## Parte 1 — Reconocimiento del sintoma

Activa esta skill si ves **cualquiera** de estos patrones:

### Errores en consola

```
Access to image at 'https://bucket.../photo.webp' from origin '...' has been
blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on
the requested resource.
```

```
Tainted canvases may not be exported
(SecurityError en canvas.toDataURL / getImageData)
```

```
TypeError: Failed to fetch (en fetch() contra una URL publica)
```

### Sintomas visuales

- PDF descargado sale **con espacios vacios** donde deberian ir imagenes (la estructura/bordes se ven, el contenido de la imagen NO).
- html2canvas genera un canvas pero las imagenes salen en blanco.
- `canvas.toDataURL()` throws SecurityError.
- Un `fetch(url)` contra una URL publica falla con error CORS aunque `curl -H "Origin: X"` devuelva `Access-Control-Allow-Origin`.

### La pista definitiva

Correr `curl -sI -H "Origin: http://localhost:5173" "<URL>"` devuelve `Access-Control-Allow-Origin: http://localhost:5173`. **El bucket SI tiene CORS.** El bug esta en el browser.

---

## Parte 2 — Causa raiz

Los buckets publicos (Cloudflare R2, S3 con "respond with ACAO only when Origin is present", GCS) **solo devuelven ACAO cuando la request trae el header `Origin`**.

El browser manda `Origin` cuando:
- `fetch(url, { mode: 'cors' })`
- `<img src="..." crossOrigin="anonymous">`

El browser **NO** manda `Origin` cuando:
- `<img src="...">` (sin `crossOrigin`)
- Navegacion directa, `<link>`, `<script>` sin `crossorigin`

**Secuencia del bug:**

1. La pagina/preview renderiza `<img src="URL">` **sin** crossOrigin → browser carga sin `Origin` → bucket responde sin ACAO → browser cachea la response **sin metadata CORS**.
2. Mas tarde, otro codigo (PDF export, canvas screenshot, fetch-to-blob) pide la misma URL con CORS:
   - `<img crossOrigin="anonymous">` o `fetch(url, { mode: 'cors' })`
3. El browser intenta reusar la entrada cacheada. Esa entrada no tiene ACAO → falla con "No Access-Control-Allow-Origin header".
4. Aparentemente el bucket rechazo la request. **No — el browser ni siquiera hizo la request nueva.**

Segun la spec, cache keys deberian diferenciar modo CORS de no-CORS. En la practica, Chrome, Safari, y Firefox tienen variaciones. Es mas robusto asumir que la cache puede colisionar.

---

## Parte 3 — Fixes

Hay tres patrones. Elegir segun el contexto.

### Fix A — Cache-bust en el fetch (recomendado para PDF/canvas export)

Mas simple y menos invasivo. Forza un network request fresco.

```ts
async function urlToDataUrl(url: string): Promise<string | null> {
  const sep = url.includes('?') ? '&' : '?';
  const bustUrl = `${url}${sep}_v=${Date.now()}`;
  const res = await fetch(bustUrl, {
    mode: 'cors',
    credentials: 'omit',
    cache: 'reload',   // belt + suspenders: no reusar HTTP cache
  });
  if (!res.ok) return null;
  const blob = await res.blob();
  return await new Promise<string | null>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}
```

**Cuando usar:** generacion de PDF con jsPDF+html2canvas, export de canvas a imagen, cualquier workflow donde convertis URLs en data URLs antes de procesar.

### Fix B — crossOrigin preemptivo en TODOS los renders (robusto si controlas toda la app)

Si cada `<img>` que apunta al bucket lleva `crossOrigin="anonymous"` desde el primer render, la cache se puebla CON metadata CORS desde el inicio. Export posterior funciona sin cache-bust.

```tsx
<img src={url} crossOrigin="anonymous" alt="" />
```

**Cuando usar:** si todas las imagenes vienen del mismo bucket y siempre las exportas/procesas. Requiere tocar TODOS los call sites.

**Cuando NO usar:** si algunos call sites no tienen CORS funcional (legacy buckets), `crossOrigin="anonymous"` rompe la carga visual.

### Fix C — Separar el arbol de export del arbol de preview (invasivo, ultima opcion)

Renderizar el export en un componente COMPLETAMENTE separado que monta `<img>` con URLs cache-busted desde el principio. Sin compartir estado con la preview.

```tsx
function PrintView({ photos }: { photos: string[] }) {
  return photos.map((url) => (
    <img src={`${url}?_v=${Date.now()}`} crossOrigin="anonymous" alt="" />
  ));
}
```

**Cuando usar:** si ni A ni B funcionan por restricciones del codigo.

---

## Parte 4 — Workflow de diagnostico

Cuando el usuario reporta uno de los sintomas:

### 1. Confirmar que es este bug (no otro)

Correr desde terminal:
```bash
curl -sI -H "Origin: <origen-de-la-app>" "<URL-de-imagen>" | grep -i access-control
```

- Si devuelve `Access-Control-Allow-Origin: <origen>` → bucket OK, es el bug del cache. **Aplicar uno de los fixes.**
- Si NO devuelve ACAO → el bucket no tiene CORS. **Configurar CORS en el bucket primero** (Cloudflare R2 dashboard, S3 bucket CORS policy, etc). NO es el mismo problema.

### 2. Identificar el codigo

Buscar en el proyecto:
```
Grep pattern: "html2canvas|toDataURL|readAsDataURL|new Image|canvas.getContext"
```

Ubicar el archivo de export.

### 3. Aplicar Fix A (default)

Modificar la funcion que convierte URL a data URL / fetchea blob. Agregar:
- Cache-bust query param (`?_v=${Date.now()}`)
- `cache: 'reload'` en las opciones de fetch

### 4. Verificar

Pedir al usuario que:
1. Hard refresh (`Cmd+Shift+R` / `Ctrl+Shift+R`) — crucial si el chunk del export es dynamic import.
2. Reproducir la accion que fallaba.
3. Confirmar que las imagenes aparecen en el output.

Si sigue fallando, pedir console logs con formato:
- URLs que se intentan inlinear
- Response status de cada fetch
- `naturalWidth × naturalHeight` de los `<img>` post-swap
- Si cualquiera sigue en `0×0`, el swap no funciono.

---

## Parte 5 — Referencias

- HTML spec: [CORS settings attributes](https://html.spec.whatwg.org/multipage/urls-and-fetching.html#cors-settings-attributes)
- Fetch spec: [HTTP cache partitions](https://fetch.spec.whatwg.org/#http-cache-partitions)
- Cloudflare R2: [CORS configuration](https://developers.cloudflare.com/r2/buckets/cors/)
- html2canvas issue thread sobre este tema: [niklasvh/html2canvas#2498](https://github.com/niklasvh/html2canvas/issues/2498)

---

## Qué NO hacer

- **No** deshabilitar CORS "para evitar el problema" (`useCORS: false` en html2canvas, `allowTaint: true`) — el canvas queda tainted y `toDataURL` falla con SecurityError. Es el sintoma siguiente, no un fix.
- **No** proxyar a traves de una edge function sin medir — agrega latencia, costo, y punto de fallo. Solo justificado si el bucket NO tiene CORS y no puede configurarse.
- **No** asumir "el bucket no tiene CORS" sin hacer el `curl -I -H Origin` primero. 90% de las veces el bucket esta bien.
- **No** pegar `crossOrigin="anonymous"` en cada `<img>` sin entender el impacto — buckets sin CORS fallaran al cargar.
