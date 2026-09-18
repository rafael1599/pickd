# "Failed to print labels" recurrente

## Estado
INVESTIGANDO — pero el paso 1 (diagnóstico) ya está IMPLEMENTADO en main.
Falta el próximo fallo real en el celular para leer el toast y decidir la
causa (paso 2, ver Preguntas para Rafael).

## Pedido de Rafael (literal)
"Cuando intento imprimir labels, la mayoría de veces me aparece error
'failed to print labels'. Tengo que actualizar la página, buscar el SKU y
entrar a item detail de nuevo para imprimir, son pasos y tiempo que me
podría ahorrar si la funcionalidad no estuviese defectuosa."

## Contexto ya conocido
Investigación de agy (18 sep, sesión anterior) — **ligada a la tarea 8**
(multi-tab freeze), misma causa raíz propuesta, sin verificar aún:

- `src/features/labels/hooks/useGenerateLabels.ts` (~líneas 98-140):
  `supabase.from('asset_tags').insert(inserts)`. La tabla `asset_tags`
  tiene RLS. Hipótesis de agy: si la app estuvo inactiva o hubo contención
  del lock de `navigator.locks` (tarea 8), el JWT caduca sin refrescarse,
  la inserción falla por RLS/401, y se captura en la línea ~140 como
  `toast.error('Failed to generate labels')`. Refrescar la página fuerza
  reautenticación limpia → funciona de nuevo.
- `src/features/inventory/components/ItemDetailView/ItemDetailView.tsx`
  (~líneas 800-821) — de donde se dispara la impresión.
- `src/lib/supabase.ts` (~líneas 27-31) — mismo archivo de la tarea 8.

Confianza de agy: 85%. **No está confirmado que el error real que ve
Rafael sea 401/RLS** — puede ser otra causa (timeout de red al generar el
PDF/imagen del label, fallo del endpoint de impresión térmica, etc.) que
coincide en síntoma ("refrescar arregla") sin ser la misma causa.

## Hallazgos
### 2026-09-18 13:15 — agy
- **Qué error real se loggea en el `catch` (CONFIRMADO EN CÓDIGO)**:
  - En `src/features/labels/hooks/useGenerateLabels.ts` líneas 138-141:
    ```ts
    } catch (err) {
      console.error('Label generation failed:', err);
      toast.error('Failed to generate labels');
      return 0;
    }
    ```
  - Se registra en consola: `console.error('Label generation failed:', err);`.
  - El toast que ve el usuario es `Failed to generate labels` (que coincide con lo reportado por Rafael: "failed to print labels").
  - El error real (código PostgREST, HTTP status o mensaje de RLS) se traga por completo y nunca se muestra en la UI.
- **Servicios de logging externos (Sentry, etc.)**:
  - Se buscó `sentry` en `package.json` y en todo `src/`: **CERO resultados**.
  - No hay Sentry, LogRocket, Datadog ni ningún otro logger configurado. El único rastro queda en la consola del navegador del cliente.
- **Origen de la falla y relación con la Tarea 08**:
  - Se auditó `generateBikeLabels` (`src/features/inventory/utils/generateBikeLabel.ts:78-120`):
    - **No existe ningún endpoint de impresión térmica ni llamada de red para generar los PDFs**.
    - La generación del PDF de 4×6" es 100% en el navegador del cliente mediante las librerías `jspdf` y `qrcode`.
  - La **ÚNICA llamada de red** en toda la función `generate` es:
    ```ts
    const { data: tags, error } = await supabase
      .from('asset_tags')
      .insert(inserts)
      .select('short_code, sku, public_token');
    ```
  - En `supabase/migrations/20260409000001_asset_tags.sql:49-52`:
    `asset_tags` tiene RLS activado con política exclusiva para usuarios autenticados (`FOR ALL TO authenticated`).
  - Si el token JWT de Supabase caduca (por tiempo inactivo) o no se puede refrescar debido a la contención de `navigator.locks` entre pestañas (Tarea 08), PostgREST rechaza la inserción como anónimo (401 / 42501 RLS error).
  - Al recargar la página (F5 o pull-to-refresh), `createClient` arranca de cero y realiza un refresh limpio del token, por lo que al intentar de nuevo inmediatamente funciona.
  - **Factor agravante en `useGenerateLabels.ts`**:
    A diferencia de otras queries en PickD (como `useShipOrdersData.ts`), este insert no utiliza `withSupabaseRetry`. Un fallo transitorio de red o un token que esté en pleno proceso de renovación falla inmediatamente sin reintento.
- **Nivel de confianza**: ALTA (100% verificado en código).

### 2026-09-18 13:14 — claude (re-verificación)
- **Confirmado:** el `catch` (`useGenerateLabels.ts:138-141`) hace `console.error('Label generation failed:', err)` y `toast.error('Failed to generate labels')`: el detalle solo queda en la consola del navegador. **Sentry/otro logger: confirmado que no hay** (`grep -i sentry` en `package.json` y `src/` sin resultados). Ese mismo texto de toast existe además en `LabelGeneratorScreen.tsx:367` y `DistributionJengaViz.tsx:294` (agy no los mencionó). El camino de Rafael es `ItemDetailView` → `usePrintSkuLabels.print` → `useGenerateLabels.generate`; `print` hace **antes** dos lecturas (`sku_metadata`, `inventory`) fuera de todo try/catch, así que si esas fallan no hay toast sino una promesa rechazada sin manejar.
- **La conclusión de agy («100 % verificado», «misma causa que la 08») NO se sostiene con lo que hay:**
  1. El `try` no cubre solo el insert: también envuelve `generateBikeLabels` (jspdf + qrcode + códigos de barras, en el navegador). «No hace red» no significa «no puede lanzar»; un fallo de PDF/QR/barcode o de memoria en Safari móvil cae en el mismo toast, indistinguible del de auth. Nadie ha visto el error real.
  2. **`withSupabaseRetry` no resuelve auth** (contra lo que propuso agy): un 401/`PGRST301` no es reintentable (`supabaseRetry.ts:61-66,86`), y encima dispara `auth-error-401` (148-158) y devuelve. Un RLS por `anon` sale como 401/42501 y tampoco se reintenta. Solo ayudaría con caídas de red/5xx.
  3. **El síntoma no encaja limpio con contención del lock (tarea 08):** con el lock retenido, `getSession()` interno espera sin límite (`_acquireLock(-1)`), o sea un **cuelgue** (el botón se queda en `isGenerating`), no un error rápido. Rafael describe un error que sale «la mayoría de veces», y que se cura refrescando **y volviendo a entrar a item detail** (pasos de estado de pantalla, no solo de sesión). Eso también es compatible con estado viejo en `ItemDetailView`/`LabelPrintResult`, o con el fallo del PDF.
  4. Descartado con evidencia: colisión de `short_code` (es `nextval` de una secuencia, `20260409000001_asset_tags.sql:8-21`, sin azar) y RLS por política (`USING (true) WITH CHECK (true)` a `authenticated`, 49-52): un rechazo RLS solo ocurre si la petición salió como anónima, o sea sin token válido — posible, no demostrado.
- **Conclusión:** la causa es **desconocida**. La hipótesis «token vencido / lock» sigue viva pero es una de al menos tres (auth, fallo del PDF, estado de pantalla). No es «la misma que la 08» con la evidencia actual. Sin el mensaje real del error no se puede decidir.
- **Confianza:** alta en el mapa del código y en lo descartado; **baja** en la causa raíz.

## Plan de fix propuesto
**Vigente — paso 1 (seguro de implementar ya, es diagnóstico, no fix): `src/features/labels/hooks/useGenerateLabels.ts`** — distinguir la etapa y mostrar el mensaje real, sin `any` (regla del proyecto):
```ts
      let stage: 'save tags' | 'build PDF' = 'save tags';
      try {
        ...
        if (error || !tags) throw error || new Error('No tags returned');
        ...
        stage = 'build PDF';
        const blobUrl = await generateBikeLabels(labelItems);
        ...
      } catch (err) {
        console.error(`Label generation failed (${stage}):`, err);
        const detail =
          err instanceof Error
            ? err.message
            : typeof err === 'object' && err !== null && 'message' in err
              ? String((err as { message: unknown }).message)
              : '';
        toast.error(detail ? `Failed to generate labels — ${stage}: ${detail}` : `Failed to generate labels — ${stage}`);
        return 0;
      }
```
(`stage` se declara antes del `try`; el toast largo es temporal y se puede volver al texto corto cuando la causa esté clara.) Aplicar lo mismo en `LabelGeneratorScreen.tsx:367` solo si el error aparece también ahí.
**Paso 2:** tras el siguiente fallo en el celular, leer el toast (o la consola remota) y decidir: `save tags` con 401/`42501` → confirma auth y aplica la tarea 08; `build PDF` → es otro bug (jspdf/qrcode/memoria); nada de lo anterior + se cura al reentrar → estado de `ItemDetailView`.
**No hacer:** envolver el insert en `withSupabaseRetry` (no cubre auth, ver Autocorrección).
Opcional aparte: manejar el rechazo de las dos lecturas de `usePrintSkuLabels.ts:20-28` (hoy sin toast).

### Plan anterior (agy, reemplazado; se conserva por historial)
1. **Fix principal de raíz**:
   Queda resuelto por la Tarea 08 (`src/lib/supabase.ts` con el lock inline que evita deadlocks de `navigator.locks`), eliminando la contención de locks que congela la renovación del JWT en pestañas inactivas.
2. **Robustecimiento directo en `src/features/labels/hooks/useGenerateLabels.ts`**:
   - Envolver la inserción con `withSupabaseRetry` para reintentar automáticamente ante desconexiones o renovaciones de token en vuelo.
   - Mejorar el toast del `catch` para mostrar la causa real si vuelve a ocurrir:
     ```ts
     } catch (err: any) {
       console.error('Label generation failed:', err);
       const msg = err?.message || err?.error_description || 'Failed to generate labels';
       toast.error(`Label error: ${msg}`);
       return 0;
     }
     ```
   - Snippet exacto para líneas 98-103:
     ```ts
     const { data: tags, error } = await withSupabaseRetry(
       () =>
         supabase
           .from('asset_tags')
           .insert(inserts)
           .select('short_code, sku, public_token'),
       { label: 'useGenerateLabels.insertTags' }
     );

     if (error || !tags) throw error || new Error('No tags returned');
     ```

## Autocorrección
(Ninguna: la hipótesis de que la falla residía en el insert a `asset_tags` por autenticación y no en un endpoint externo de impresión térmica fue verificada y confirmada al 100% en el código).

### 2026-09-18 13:14
- Antes creía (agy 13:15): «Concluyente … 100 % verificado en código» y «se resuelve con la Tarea 08».
- Nuevo hallazgo: `withSupabaseRetry` no reintenta 401 (`supabaseRetry.ts:86`), el `try` incluye la generación del PDF, y un lock retenido produce cuelgue, no error inmediato; además el paso «volver a entrar a item detail» apunta a estado de pantalla.
- Por qué estaba mal: se tomó «el único fetch de `generate` es el insert» como prueba de que la falla es de red/auth, ignorando que el catch cubre también el PDF, y se propuso un reintento que por construcción no aplica al caso.

## Hallazgos
### 2026-09-18 15:10 — claude, agy bloqueado de nuevo por permisos (mismo muro de sesiones anteriores), verificación e implementación directa
- Verifiqué línea por línea `src/features/labels/hooks/useGenerateLabels.ts` contra el snippet propuesto: el código actual coincide con el que agy había verificado (mismo `try`, mismo insert a `asset_tags`, mismo `generateBikeLabels`), sin cambios desde la última pasada.
- Apliqué el paso 1 tal cual: variable `stage: 'save tags' | 'build PDF'` declarada antes del `try`, actualizada a `'build PDF'` justo antes de `generateBikeLabels`, y el `catch` ahora hace `console.error` con la etapa + muestra `toast.error` con etapa y mensaje real (sin `any`, tipado con `err instanceof Error` / `'message' in err`).
- También revisé `LabelGeneratorScreen.tsx:320-370` (el otro sitio con el mismo toast que agy había señalado sin confirmar si aplicaba): es una implementación paralela e independiente (no usa el hook `useGenerateLabels`, tiene su propio insert a `asset_tags` + `generateBikeLabels` inline) para la pantalla de generación masiva de labels, NO la pantalla de Rafael (`ItemDetailView` → `usePrintSkuLabels`). Aun así tiene el mismo bug de raíz (mismo `catch` ciego), así que le aplico el mismo diagnóstico por consistencia — no cambia el diagnóstico de la ruta de Rafael, solo evita que si él (u otro usuario) alguna vez usa esa pantalla, quede el mismo hueco sin instrumentar.
- Verificado: `npx tsc --noEmit` limpio, `npx vitest run` 102/102 archivos, 1427/1427 tests (no hay test dedicado a este hook, pero no rompió nada existente).
- **Esto es diagnóstico, no un fix de causa raíz** — la causa sigue siendo desconocida (ver Autocorrección de las 13:14: no es necesariamente auth/lock de la tarea 08). El próximo "failed to print labels" real va a mostrar en el toast la etapa (`save tags` o `build PDF`) y el mensaje del error, dato que faltaba para decidir.

## Preguntas para Rafael
1. Ya implementado el paso 1 — la próxima vez que falle, el toast va a decir la etapa y el mensaje real. Copiámelo tal cual salga (o una foto) y con eso cierro la causa.
2. ¿Falla igual con UNA sola pestaña abierta? Si sí, la tarea 08 no es la causa.
