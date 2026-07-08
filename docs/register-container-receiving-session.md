# Register Container v2 — sesión de receiving activa

> Idea: `idea-152` · registrada 2026-07-03

## Contexto

El flujo actual de **Register Container** (`src/features/registrar-container/`) es "fire and forget" en 3 pasos: Upload → Preview → Done. Sube el Excel/PDF, define location destino, click en Confirm, y todo se registra atómicamente en `register_container` RPC.

Eso funciona para validación bulk, pero **no soporta el flujo real de descarga física de un container**, donde:

- La persona necesita ir tachando SKUs conforme los saca del truck (confirmación visual + audit trail).
- Aparecen SKUs que no estaban en el manifest (rescues, muestras, extras) — hoy no hay forma de agregarlos sin volver a subir el Excel.
- Para consolidar hay que saber **todas** las ubicaciones donde ya tenemos ese SKU, no solo la primera (`existing_locations[0]` en `RegistrarContainerScreen.tsx:28, 375, 417`).
- Se necesita cronometrar la descarga (time-in / time-out) para métricas operativas.
- Fotos opcionales por item para daños, etiquetas, discrepancias.
- Al terminar, ver la lista completa con notas + fotos como reporte cerrable.

**Objetivo:** convertir la vista en una **sesión de receiving activa y resumible**, mimetizando el DoubleCheckView de picking pero más rápida (menos ceremonia, más flujo).

## Approach

Insertar un nuevo step **`receiving`** entre `preview` y `done`. Está respaldado por dos tablas nuevas (`container_receiving_sessions` + `container_receiving_items`) para que la sesión sea resumible si cierran el navegador. El registro de inventario ocurre **solo al finalizar**, sobre los items confirmados — mismo patrón que picking (`markAsReady` → `completeList`).

Se reusa toda la lógica existente:
- `resolve_container_skus` RPC → sigue siendo el motor de resolución canónica (familias BL/BLD/BLT).
- `register_new_sku` + `adjust_inventory_quantity` → llamados dentro del nuevo `finalize_container_session`.
- Parsers de Excel/PDF en `lib/parseShipment*.ts` → sin cambios.
- Foto upload: `compressImage()` + `supabase.functions.invoke('upload-photo')` de `src/services/photoUpload.service.ts`.
- Realtime + optimistic pattern: se copia de `src/features/picking/hooks/usePickingNotes.ts:46-188`.

---

## Implementation

### 1. Migración DB

**Archivo:** `supabase/migrations/<timestamp>_container_receiving_sessions.sql`

**`container_receiving_sessions`**
- `id uuid pk default gen_random_uuid()`
- `warehouse text not null default 'LUDLOW'`
- `location text not null` (destino, ej. `FLORIDA`)
- `file_name text`
- `started_at timestamptz not null default now()` — **time-in**
- `finalized_at timestamptz` — **time-out**
- `started_by uuid references profiles(id)`
- `finalized_by uuid references profiles(id)`
- `status text not null default 'active'` CHECK in ('active','finalized','cancelled')
- `notes text`

**`container_receiving_items`**
- `id uuid pk default gen_random_uuid()`
- `session_id uuid not null references container_receiving_sessions(id) on delete cascade`
- `canonical_sku text not null`
- `qty int not null check (qty > 0)`
- `item_name text`
- `is_new boolean not null default false`
- `is_bike boolean not null default false`
- `existing_qty int not null default 0`
- `existing_locations jsonb not null default '[]'` — snapshot del resolve
- `merged_from text[] not null default '{}'`
- `source text not null default 'excel'` CHECK in ('excel','manual')
- `confirmed_at timestamptz`
- `confirmed_by uuid references profiles(id)`
- `item_photo_url text`
- `note text`
- Unique index `(session_id, canonical_sku)`.

**RLS:** enable + policy `authenticated all` (misma laxitud que `picking_lists`).

**RPCs nuevas** (`SECURITY DEFINER`, estilo `register_container`):
- `start_container_session(p_location, p_warehouse, p_resolved jsonb, p_file_name, p_user_id) returns uuid`
  → crea sesión + bulk-inserta items desde el `p_resolved` que el client ya obtuvo del `resolve_container_skus` en preview.
- `add_container_item(p_session_id, p_sku, p_qty, p_item_name) returns container_receiving_items`
  → corre `resolve_container_skus` para un solo item, UPSERT con `source='manual'`. Si el canonical ya existe, suma qty.
- `confirm_container_item(p_session_id, p_item_id, p_user_id)` — set `confirmed_at=now(), confirmed_by`.
- `unconfirm_container_item(p_session_id, p_item_id)` — clear `confirmed_at`.
- `finalize_container_session(p_session_id, p_user_id, p_performed_by) returns jsonb`
  → guard: status='active'; guard: refresca el anti-double-load check de `register_container.sql:172-181`. Loopea sobre `confirmed_at is not null`: si `is_new` → `register_new_sku`, luego `adjust_inventory_quantity`. Set `finalized_at=now(), status='finalized'`. Retorna `{ session_id, skus, units, unconfirmed_count, duration_seconds, new_skus[] }`.
- `cancel_container_session(p_session_id)` — set `status='cancelled'`, sin escrituras.

GRANT a `authenticated, service_role` en las cinco.

### 2. Types

**`src/features/registrar-container/lib/types.ts`** (agregar, no eliminar):

```ts
export interface ContainerSession {
  id: string;
  warehouse: string;
  location: string;
  file_name: string | null;
  started_at: string;
  finalized_at: string | null;
  started_by: string | null;
  finalized_by: string | null;
  status: 'active' | 'finalized' | 'cancelled';
  notes: string | null;
}

export interface ContainerSessionItem {
  id: string;
  session_id: string;
  canonical_sku: string;
  qty: number;
  item_name: string | null;
  is_new: boolean;
  is_bike: boolean;
  existing_qty: number;
  existing_locations: ExistingLocation[];
  merged_from: string[];
  source: 'excel' | 'manual';
  confirmed_at: string | null;
  confirmed_by: string | null;
  item_photo_url: string | null;
  note: string | null;
}
```

También regenerar `src/integrations/supabase/types.ts` y `src/lib/database.types.ts` con `supabase gen types typescript --linked` — CLAUDE.md marca esto como obligatorio al añadir tablas.

### 3. API + hooks

- **`api/sessionsApi.ts`** — wrappers `.rpc()` para las 5 RPCs + `from('container_receiving_sessions').select()`.
- **`hooks/useContainerSession.ts`** — `useQuery` para session + items, suscripción Realtime a `container_receiving_items` filtrada por `session_id` (patrón `usePickingNotes.ts:46-54`).
- **`hooks/useContainerSessionMutations.ts`** — todas con optimistic updates: `startSession`, `addItem`, `toggleConfirm`, `attachPhoto`, `setItemNote`, `finalize`, `cancel`.
- **`hooks/useActiveContainerSessions.ts`** — lista sesiones con `status='active'` para el banner de resume.

### 4. Nueva vista `ReceivingSessionView.tsx`

**Path:** `src/features/registrar-container/components/ReceivingSessionView.tsx`

Esqueleto adelgazado copiado de `src/features/picking/components/DoubleCheckView.tsx`. Layout mobile-first:

- **Header sticky**: `Container → FLORIDA` · `truck.pdf` · timer live `HH:MM:SS` desde `started_at` · badge `X / Y confirmed`.
- **Toolbar**: `+ Add SKU` (modal), botón notes (drawer para nota de sesión).
- **Item list** ordenada por `qty desc, canonical_sku`:
  - **Checkbox izq** 44×44, tap → `toggleConfirm`. Verde cuando `confirmed_at !== null`.
  - **Centro**: `canonical_sku` mono + `item_name` gris + `qty` con formato bike/no-bike.
  - **Derecha**: badges — `NEW` verde, `MERGED×N` azul, y **`N loc · Q` ámbar TAPPABLE** que abre `LocationsPopover` con la lista completa de `existing_locations` (idea 1 aterrizada).
  - **Row extras** (colapsable): icono cámara, icono nota, thumbnail de foto si existe.
- **Add SKU modal** (`AddSkuModal.tsx`): input SKU con autocomplete contra `search_inventory_with_metadata` limit 8, qty, item_name. Al confirmar → `addItem` → aparece con chip `MANUAL`.
- **Sticky footer**: "Cancel session" (rojo suave) + "Finalize receiving" (primario). Si hay unconfirmed → confirm dialog "N items unconfirmed — won't be added to inventory. Continue?".

**LocationsPopover** usa `@radix-ui/react-popover` (verificar si ya está en `package.json`; si no, fallback a div controlado con `useClickOutside`). Componente compartido en `components/LocationsPopover.tsx` — se usa **tanto en `receiving` como en `done`** para reemplazar el `existing_locations[0]` de `RegistrarContainerScreen.tsx:375, 417`.

### 5. Modificar `RegistrarContainerScreen.tsx`

- Extender `Step`: `'upload' | 'preview' | 'receiving' | 'done'`.
- `useState<string | null>(null)` para `sessionId`.
- **Preview step**: renombrar botón `"Confirm & register in {loc}"` → **`"Start receiving in {loc}"`**. On click: `startSession({ location, warehouse, resolved, file_name })` → `setSessionId(id); setStep('receiving')`.
- **Receiving step**: `<ReceivingSessionView sessionId={sessionId} onFinalized={handleFinalized} onCancelled={reset} />`.
- **Done step**: enriquecer con `duration`, `unconfirmed_count`, lista completa por SKU con check indicator + miniatura foto + nota per-item (**idea 5**). Popover multi-location aquí también.
- **Upload step**: nuevo `<ActiveSessionsBanner />` arriba de la dropzone que lista sesiones `active` con botón "Resume" (setea sessionId + step='receiving' directo).

### 6. Fotos per-item

Usar `compressImage()` de `src/services/photoUpload.service.ts` y `supabase.functions.invoke('upload-photo')`. Path R2: `containers/{session_id}/{item_id}.webp`. NO usar `fetch()` raw (CLAUDE.md sección fotos). Guardar public URL en `container_receiving_items.item_photo_url`. Fallback blob URL solo en localhost.

### 7. Cleanup

- Dejar `register_container` RPC intacto — sirve como camino "quick mode" atómico. El nuevo `finalize_container_session` reusa su lógica interna.
- No borrar `buildReportText` — sigue usándose para copy-to-clipboard en `done`.

### 8. Tests

- **Unit `sessionStateMachine.test.ts`**: dado un array con distintos `confirmed_at`, `finalize` llama `adjust_inventory_quantity` solo en confirmados (mock supabase).
- **Component `ReceivingSessionView.test.tsx`**: renderiza items, toggle actualiza contador, finalize deshabilitado hasta ≥1 confirmed, popover abre.
- Parsers existentes (`parseShipmentXlsx.test.ts`, `parseShipmentPdf.test.ts`) sin cambios.

Correr `pnpm vitest run` — todo verde antes de push.

---

## Files afectados

**Nuevos:**
- `supabase/migrations/<ts>_container_receiving_sessions.sql`
- `src/features/registrar-container/api/sessionsApi.ts`
- `src/features/registrar-container/hooks/useContainerSession.ts`
- `src/features/registrar-container/hooks/useContainerSessionMutations.ts`
- `src/features/registrar-container/hooks/useActiveContainerSessions.ts`
- `src/features/registrar-container/components/ReceivingSessionView.tsx`
- `src/features/registrar-container/components/LocationsPopover.tsx`
- `src/features/registrar-container/components/AddSkuModal.tsx`
- `src/features/registrar-container/components/ActiveSessionsBanner.tsx`
- Tests correspondientes.

**Modificados:**
- `src/features/registrar-container/RegistrarContainerScreen.tsx` (Step union, receiving branch, popover en done)
- `src/features/registrar-container/lib/types.ts` (nuevas interfaces)
- `src/integrations/supabase/types.ts` + `src/lib/database.types.ts` (regen)

**Sin cambios:** parsers, `resolve_container_skus`, `register_container`, `register_new_sku`, `adjust_inventory_quantity`, `photoUpload.service.ts`.

---

## Verification (end-to-end)

1. **DB local**: `bash scripts/sync-local-db.sh` primero, luego crear migración y `npx supabase migration up`. Regenerar types.
2. **Tests**: `pnpm vitest run` — todo verde.
3. **Dev**: `pnpm dev` → login admin → `/registrar-container`.
4. **Happy path**:
   - Sube JAMIS PDF de prueba.
   - Location: `TEST-CONTAINER-01`.
   - **"Start receiving in TEST-CONTAINER-01"** → ReceivingSessionView, timer corriendo.
   - Tap check en 3 items. Contador `3 / N`.
   - Tap badge `2 loc · 15` → popover con las 2 ubicaciones.
   - `+ Add SKU` → `99-9999XX`, qty 1 → aparece con `MANUAL` + `NEW`.
   - Tap cámara → foto → thumbnail.
   - Cierra pestaña, reabre → banner "Resume TEST-CONTAINER-01". Click resume, sigue igual.
   - `Finalize receiving` → dialog "N items unconfirmed". Cae en `done`.
   - Done muestra: `X / Y items received`, `Duration MM:SS`, lista completa con checks + fotos + notas.
5. **DB verify**:
   ```sql
   SELECT status, started_at, finalized_at,
          extract(epoch from finalized_at - started_at) AS seconds
   FROM container_receiving_sessions ORDER BY started_at DESC LIMIT 1;

   SELECT canonical_sku, qty, confirmed_at IS NOT NULL AS confirmed,
          source, item_photo_url IS NOT NULL AS has_photo
   FROM container_receiving_items WHERE session_id = '<id>';

   SELECT sku, quantity, location FROM inventory
   WHERE warehouse='LUDLOW' AND location='TEST-CONTAINER-01';
   -- Solo items confirmed_at IS NOT NULL.
   ```
6. **Test local antes de prod**. Sin issues → PR a `develop` (staging comparte DB con prod, así que aplicar migración con `npx supabase db push --linked` post-merge).
