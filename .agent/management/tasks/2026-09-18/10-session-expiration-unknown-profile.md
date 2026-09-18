# Sesión que expira: perfil "Unknown" + falla foto/completar orden/imprimir

## Estado
IMPLEMENTADO — falta verificación real en el celular (ver Autocorrección
para las 2 desviaciones del plan de agy, ambas mejoras, no reversiones)

## Pedido de Rafael (literal)
"Print labels puede estar relacionada con cuando se expira la sesión del
usuario y tiene que iniciar sesión de nuevo o actualizar el navegador,
hace tiempo que 'se arregló' ese problema pero sigue apareciendo — a
veces me aparece 'Unknown' en el nombre de mi perfil y falla en hacer
múltiples cosas la app, entre las cuales subir una foto, completar una
orden y hasta imprimir."

## Contexto ya conocido
- **Tarea 08** (multi-tab freeze): en la sesión anterior se cambió
  `src/lib/supabase.ts` para envolver el lock de auth de Supabase
  (`navigatorLock`) con un timeout de 5s en vez de esperar indefinido
  (`_acquireLock(-1, ...)`). Implementado, pero **nunca verificado en el
  celular real** (ver `08-multi-tab-freeze-mobile.md`). Rafael dice que
  el síntoma de sesión sigue apareciendo — puede que ese fix no cubra
  este caso, o que sea un problema relacionado pero distinto.
- **Tarea 09** (print labels): se agregó diagnóstico (`stage` + mensaje
  real del error en el toast) en `useGenerateLabels.ts` y
  `LabelGeneratorScreen.tsx`, ya en main. Todavía no hay un reporte real
  de Rafael con el toast nuevo — esta pista (sesión expirada) es
  independiente de ese diagnóstico y puede ser la causa real que se iba
  a revelar ahí.
- **El "Unknown" YA tiene un caso conocido y "medio arreglado" en el
  código, con su propio comentario admitiéndolo**: `src/context/
  AuthContext.tsx`, función `fetchProfileWithTimeout` (~líneas 192-245).
  - Hace `Promise.race([profilePromise, timeout])` con `timeoutMs = 3000`.
  - Si gana el timeout, antes dejaba `profile` en `null` para siempre
    (comentario línea 207-212: *"used to leave profile stuck at null for
    the rest of the session (UserMenu then shows the 'Unknown' fallback
    forever)"*). El fix actual "sigue escuchando" la promesa original
    por si llega tarde (`profilePromise.then(...)` fuera de la carrera),
    pero **solo actualiza el estado si esa promesa tardía SÍ resuelve** —
    si la sesión está realmente rota (token vencido, RLS, red), esa
    promesa nunca resuelve con éxito y el perfil se queda en null/Unknown
    indefinidamente, exactamente lo que describe Rafael.
  - `UserMenu.tsx:124` y `:618` son los dos lugares que muestran
    `profile?.full_name || 'Unknown'`.
- **Patrón compartido con subir foto / completar orden / imprimir**:
  las tres acciones que Rafael menciona hacen escritura a Supabase
  (`storage.upload`, `update` a `picking_lists`, `insert` a
  `asset_tags`). Si el JWT está vencido o en proceso de renovarse sin
  éxito, las tres fallarían con el mismo tipo de error (401/RLS),
  independientemente de si hay 1 o varias pestañas — el "Unknown" en el
  perfil sería el SÍNTOMA VISIBLE de que la sesión ya está mal antes de
  que el usuario intente cualquier acción, no la causa.

## Hallazgos
### 2026-09-18 16:30 — agy (investigación de las 4 preguntas bloqueantes en código actual)

- **Pregunta 1: Cuándo se llama `fetchProfileWithTimeout` y por qué "Unknown" se queda pegado (CONFIRMADO EN CÓDIGO)**:
  - En `src/context/AuthContext.tsx`:
    - Se llama en `initAuth()` (líneas 62 y 64) -> **solo al montar** `AuthProvider`.
    - Se llama en `supabase.auth.onAuthStateChange` (líneas 89 y 104) **únicamente** si `event === 'SIGNED_IN' || event === 'INITIAL_SESSION'`.
    - **NUNCA** se llama en `TOKEN_REFRESHED` (evento que emite Supabase cuando renueva el JWT tras expirar).
    - **NUNCA** se llama en eventos de foco o retorno a la pestaña (`visibilitychange`, `window.focus`, o `online` no tienen listeners en `AuthContext`).
  - **Diferencia crítica con `role`**:
    - `role` se persiste en `localStorage` (`localStorage.getItem('role_' + userId)`, línea 58).
    - `profile` (que contiene `full_name`) **NUNCA se guarda en `localStorage`**.
    - Por lo tanto, en cada recarga o reinicio del PWA por el sistema operativo móvil tras suspenderse la app, `profile` arranca en `null`.
    - Si la consulta de perfil falla o supera el timeout durante el arranque, `profile` queda en `null`.
    - Al quedar en `null`, `UserMenu.tsx:124` y `:618` muestran `profile?.full_name || 'Unknown'`. Y como ningún evento de refresh ni de visibilidad vuelve a llamar a `fetchProfileWithTimeout`, **"Unknown" se queda congelado durante toda la vida de la pestaña**.
  - Bug secundario en `updateProfileName` (`AuthContext.tsx:264`):
    `setProfile((prev) => (prev ? { ...prev, full_name: newName } : null));`
    Si `prev` era `null` (perfil en "Unknown"), ¡sigue siendo `null` incluso si el update en la base de datos fue exitoso!

- **Pregunta 2: Rastrear `auth-error-401` y llamadas que NO pasan por `withSupabaseRetry` (CONFIRMADO EN CÓDIGO)**:
  - El evento `auth-error-401` **solo se dispara en 3 lugares de toda la app**:
    1. `src/lib/supabaseRetry.ts:155` (dentro de `withSupabaseRetry`).
    2. `src/lib/query-client.ts:101` (`queryCache.onError`).
    3. `src/lib/query-client.ts:124` (`mutationCache.onError`).
  - `AuthContext.tsx:140-167` escucha `auth-error-401` y es lo único que limpia el estado y redirige a `/login`.
  - **La gran asimetría encontrada**:
    - Las queries de lectura de pantallas como Orders o Ship usan `withSupabaseRetry` o React Query.
    - Pero las **tres operaciones que Rafael mencionó específicamente (foto, imprimir, completar orden)** más el `fetchProfileWithTimeout` **SON LLAMADAS DIRECTAS A SUPABASE O FETCH CRUDO** que no usan `withSupabaseRetry` ni React Query:
      1. **Subir foto** (`src/services/photoUpload.service.ts:100-116`): usa `fetch()` nativo directo al endpoint de la edge function con `Authorization: Bearer ${session?.access_token}`. Si la función devuelve 401, lanza `Upload failed with status 401`. Cero retry, cero dispatch de `auth-error-401`.
      2. **Imprimir labels** (`src/features/labels/hooks/useGenerateLabels.ts:98-103`): hace `supabase.from('asset_tags').insert(inserts)`. `asset_tags` tiene RLS para `authenticated`. Si el JWT caducó, PostgREST retorna 401/42501; el hook lo captura en su `catch` y saca un toast de error. Cero dispatch de `auth-error-401`.
      3. **Completar orden** (`src/features/picking/hooks/usePickingActions.ts:158`): `completeList` hace `supabase.from('picking_lists').update(...)` directo. Al fallar por 401 saca `toast.error('Failed to complete order properly')`. Cero dispatch de `auth-error-401`.
      4. **`fetchProfileWithTimeout`** (`AuthContext.tsx:197-203`): hace `supabase.from('profiles').select(...)` directo. Al fallar por 401 o expirar los 3s, solo asigna `role = 'staff'` y traga el error sin disparar `auth-error-401`.
  - **Conclusión de la Pregunta 2**:
    Como ninguna de estas llamadas escala a `auth-error-401`, la app **nunca se entera formalmente de que la sesión expiró**. No hay logout ni redirección a `/login`. La app permanece en un estado "zombi": la UI sigue abierta, el perfil dice "Unknown", y cualquier intento de foto, completar orden o imprimir arroja un toast de error.

- **Pregunta 3: Choque de timeouts entre `authLock` (5s) y `fetchProfileWithTimeout` (3s) (CONFIRMADO EN CÓDIGO)**:
  - En `src/lib/supabase.ts:36`: el `authLock` de la Tarea 08 espera hasta **5000ms** (`5s`) para adquirir el lock de auth antes de ejecutar `fn()`.
  - En `src/context/AuthContext.tsx:193`: `fetchProfileWithTimeout` tiene `timeoutMs = 3000` (**3s**).
  - **Conflicto matemático evidente**: si el navegador móvil despierta de estar suspendido y `authLock` tarda entre 3s y 5s en resolver o superar la contención entre pestañas, la carrera `Promise.race` en `AuthContext` **SIEMPRE pierde a los 3 segundos**, aborta el fetch de perfil y deja el perfil en `null` ("Unknown") antes de que el token haya terminado de refrescarse.
  - Además, si el celular estuvo bloqueado durante horas y el timer en segundo plano estuvo suspendido, al desbloquear el teléfono el token en memoria ya está expirado. Si la red WiFi tarda 1-2 segundos en reconectar, el refresh de token falla con error de red y el cliente sigue usando el JWT vencido.

- **Pregunta 4: Mapeo exacto de los flujos de Foto, Orden e Imprimir (CONFIRMADO EN CÓDIGO)**:
  - Ver detalle en Pregunta 2. Los tres flujos dependen de un token válido (`authenticated`), ninguno usa `withSupabaseRetry`, y los tres atrapan el error localmente mostrando toasts en vez de forzar la renovación del token o el re-login.

## Plan de fix propuesto
Un plan en 4 puntos concretos y seguros para solucionar la causa raíz sin romper nada:

### 1. Persistir `profile` en `localStorage` y recuperar en `initAuth` (`src/context/AuthContext.tsx`)
Igual que se hace con `role_${userId}`, guardar y leer `profile_${userId}`:
- **Líneas ~58-65**:
  ```ts
  const cachedRole = localStorage.getItem(`role_${session.user.id}`);
  const cachedProfile = localStorage.getItem(`profile_${session.user.id}`);
  if (cachedProfile && mounted) {
    try {
      setProfile(JSON.parse(cachedProfile));
    } catch {}
  }
  ```
- **Líneas ~218 y ~240** (dentro de `fetchProfileWithTimeout` al recibir data):
  ```ts
  localStorage.setItem(`profile_${userId}`, JSON.stringify(profileData));
  ```
- **Líneas ~152 y ~295** (en logout / 401):
  ```ts
  if (user) localStorage.removeItem(`profile_${user.id}`);
  ```
- **Línea ~264** (en `updateProfileName`):
  ```ts
  setProfile((prev) => ({
    role: prev?.role || role || 'staff',
    full_name: newName,
    last_seen_at: prev?.last_seen_at,
  }));
  if (user) {
    const updated = {
      role: profile?.role || role || 'staff',
      full_name: newName,
      last_seen_at: profile?.last_seen_at,
    };
    localStorage.setItem(`profile_${user.id}`, JSON.stringify(updated));
  }
  ```
*Efecto*: "Unknown" desaparece por completo durante el arranque y al volver de segundo plano porque el nombre real se muestra de inmediato desde `localStorage`.

### 2. Alinear timeout y escuchar `TOKEN_REFRESHED` y `visibilitychange` (`src/context/AuthContext.tsx`)
- **Línea 193**: Aumentar `timeoutMs` de `3000` a `7000` (para que sea superior a los 5000ms del `authLock` de la Tarea 08).
- **Línea 83**: Incluir `TOKEN_REFRESHED`:
  ```ts
  if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') {
  ```
  Si ocurre `TOKEN_REFRESHED` y `!profile`, llamar a `fetchProfileWithTimeout(session.user.id, true)`.
- **Líneas ~170**: Agregar listener de `visibilitychange`:
  ```ts
  const handleVisibilityChange = async () => {
    if (document.visibilityState === 'visible') {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        fetchProfileWithTimeout(session.user.id, true);
      }
    }
  };
  document.addEventListener('visibilitychange', handleVisibilityChange);
  ```
  (y remover en cleanup del `useEffect`).
*Efecto*: Cuando el celular se desbloquea o el usuario vuelve a la pestaña, si el perfil no estaba cargado o el token se renovó, se recupera automáticamente en silencio.

### 3. Disparar `auth-error-401` en `uploadPhoto` ante 401 (`src/services/photoUpload.service.ts`)
- **Líneas ~113-116**:
  ```ts
  if (!response.ok) {
    if (response.status === 401) {
      console.warn('[uploadPhoto] 401 Unauthorized — dispatching auth-error-401');
      window.dispatchEvent(new CustomEvent('auth-error-401'));
    }
    const errorBody: { error?: string } = await response.json();
    throw new Error(errorBody.error ?? `Upload failed with status ${response.status}`);
  }
  ```

### 4. Escalar 401 en `useGenerateLabels.ts` y `usePickingActions.ts`
- En `src/features/labels/hooks/useGenerateLabels.ts` (en el `catch` línea ~92):
  ```ts
  const status = (err as { status?: number })?.status;
  const code = (err as { code?: string })?.code;
  if (status === 401 || code === 'PGRST301') {
    window.dispatchEvent(new CustomEvent('auth-error-401'));
  }
  ```
- En `src/features/picking/hooks/usePickingActions.ts` (en `completeList` catch línea ~182):
  ```ts
  const status = (err as { status?: number })?.status;
  const code = (err as { code?: string })?.code;
  if (status === 401 || code === 'PGRST301') {
    window.dispatchEvent(new CustomEvent('auth-error-401'));
  }
  ```

## Plan de fix aplicado (claude, verificado contra el código actual línea por línea antes de tocar nada)
Los 4 puntos del plan de agy se implementaron, con dos ajustes deliberados
(ver Autocorrección):

1. **`src/context/AuthContext.tsx`**: nueva `loadCachedProfile(userId)` que
   lee `profile_${userId}` de `localStorage` y llama a `setProfile` de
   inmediato — se invoca en `initAuth` y en el handler de
   `SIGNED_IN`/`INITIAL_SESSION`, antes de que la query de red resuelva.
   `fetchProfileWithTimeout` ahora escribe `profile_${userId}` en
   `localStorage` en sus dos puntos de éxito (la carrera y el listener
   tardío). `timeoutMs` subido de `3000` a `7000` (por encima del `authLock`
   de 5s de la tarea 08). Nueva rama `TOKEN_REFRESHED` en
   `onAuthStateChange` que llama a `fetchProfileWithTimeout` en background.
   Nuevo `useEffect` con listener de `visibilitychange` que, al volver a la
   pestaña, pide la sesión actual y refresca el perfil en background.
   `updateProfileName` ya no depende de que `prev` no sea `null` — construye
   el perfil completo con `role` de respaldo y lo persiste en
   `localStorage` también. `signOut` ahora limpia todas las claves
   `profile_*` (mismo patrón que ya usaba para `double_check_progress_`).
2. **`src/lib/supabaseRetry.ts`**: `isAuthError` se exportó (antes era
   privada) para reusar la MISMA detección de 401/`PGRST301` que ya usa
   `withSupabaseRetry` y `query-client.ts`, en vez de duplicar el chequeo
   `status === 401 || code === 'PGRST301'` con las manos en cada sitio
   nuevo (ver Autocorrección punto 1).
3. **`src/services/photoUpload.service.ts`**: nuevo `reportIfUnauthorized`
   (helper compartido) llamado en `uploadPhoto` y `deletePhoto` (los dos
   sitios con `fetch` crudo) cuando `response.status === 401`.
4. **`src/features/labels/hooks/useGenerateLabels.ts`** y
   **`src/features/picking/hooks/usePickingActions.ts`** (`completeList`):
   el `catch` ahora llama a `isAuthError(err)` y dispara `auth-error-401`
   si aplica, antes de mostrar el toast de error.

Verificado: `npx tsc --noEmit` limpio, `npx vitest run` 102/102 archivos,
1427/1427 tests.

## Autocorrección
### 2026-09-18 16:55
- **Punto 2 del plan de agy** decía escuchar `TOKEN_REFRESHED` solo si
  `!profile`, leyendo el estado `profile` dentro del handler de
  `onAuthStateChange`. Ese handler se registra una sola vez (`useEffect`
  con deps `[]`), así que `profile` ahí siempre sería el valor del primer
  render (closure obsoleta) — el chequeo `!profile` nunca reflejaría el
  estado real. Se cambió a llamar `fetchProfileWithTimeout(..., true)`
  SIEMPRE en `TOKEN_REFRESHED`, sin condición — es una sola consulta
  liviana en background, y evita depender de un valor de estado que la
  clausura no puede leer correctamente. Mismo problema evitado en el plan
  de `signOut`/`handleAuthError` de agy (que asumía poder leer `user.id`
  dentro de una clausura igual de obsoleta): se optó por limpiar todas las
  claves `profile_*` en vez de una específica.
- **Puntos 3 y 4 del plan de agy** proponían repetir a mano
  `status === 401 || code === 'PGRST301'` en cada sitio nuevo. Ya existía
  exactamente esa lógica en `isAuthError` (`supabaseRetry.ts`, privada). Se
  exportó y se reusó en vez de duplicarla — mismo comportamiento, una sola
  fuente de verdad.
- Ninguna de las dos desviaciones contradice un hallazgo de agy: son
  decisiones de implementación al bajar el plan a código real, no
  correcciones de un hecho falso.
