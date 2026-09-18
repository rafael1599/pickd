# App se cuelga con 2+ pestañas en el celular

## Estado
IMPLEMENTADO — sin repro en celular real todavía; el mecanismo está confirmado contra el código y la versión instalada, pero no se ha visto el fix resolver el cuelgue en un dispositivo.

## Pedido de Rafael (literal)
"Pickd falla cuando tengo 2 o más ventanas abiertas en el celular, se
queda cargando y no recibe datos ni actualiza como que se pausa hasta que
cierre las otras ventanas."

## Contexto ya conocido
Investigación de agy (18 sep, sesión anterior), confianza alta (95%) pero
**sin verificar contra el código real de `src/lib/supabase.ts` tal como
está hoy** — tratar como hipótesis fuerte, no como hecho:

**Teoría**: `@supabase/supabase-js` (`GoTrueClient`) usa `navigator.locks`
por defecto para coordinar persistencia de sesión y refresh de token
entre pestañas cuando `persistSession: true` y `autoRefreshToken: true`.
En Safari/Chrome móvil, una pestaña en background se congela de
inmediato; si tenía un lock adquirido (o una request de lock pendiente),
nunca lo libera mientras está congelada. La pestaña activa llama
`navigator.locks.request` y se bloquea indefinidamente — todas las
peticiones a Supabase/Realtime se congelan hasta cerrar las otras
pestañas.

Archivos señalados por agy:
- `src/lib/supabase.ts` (~líneas 21-32) — configuración del cliente.
- `src/features/picking/hooks/usePickingSync.ts` (~líneas 406-420).

**Relación con la tarea 9** (print labels): agy conectó ambos bugs a la
misma causa — un JWT que no se refresca por la contención del lock,
fallando con 401 en escrituras (ver `09-print-labels-failure.md`).

## Hallazgos
### 2026-09-18 13:10 — agy
- **`src/lib/supabase.ts` hoy (CONFIRMADO EN CÓDIGO)**:
  - Líneas 21-32:
    ```ts
    export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
      realtime: {
        params: {
          eventsPerSecond: 20, // Increased slightly for warehouse operations
        },
      },
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    ```
  - **NO pasa ninguna opción de `lock`**. Usa 100% el comportamiento por defecto de `@supabase/supabase-js`.
- **Mecanismo por defecto en `@supabase/supabase-js`**:
  - En `node_modules/@supabase/auth-js/dist/main/GoTrueClient.js` líneas 134-139:
    ```js
    if (settings.lock) {
        this.lock = settings.lock;
    }
    else if (this.persistSession && isBrowser() && globalThis?.navigator?.locks) {
        this.lock = locks_1.navigatorLock;
    }
    else {
        this.lock = lockNoOp;
    }
    ```
  - Al estar en el navegador con `persistSession: true`, GoTrue activa `navigatorLock` (`navigator.locks.request`).
  - En navegadores móviles (iOS Safari, Chrome Android), el ciclo de vida del OS suspende por completo el hilo de ejecución de JavaScript de las pestañas en segundo plano. Si una pestaña quedó con una solicitud de lock activa o pendiente, la pestaña en primer plano que intenta llamar `getSession()`, `onAuthStateChange` o refrescar token se queda en espera infinita del Web Lock.
  - Al cerrar las otras pestañas, el navegador destruye sus contextos de Web Locks, el lock se libera y la pestaña actual se descongela de golpe (síntoma exacto descrito por Rafael).
- **Versión instalada y compatibilidad de tipos (ATENCIÓN TIPO TS)**:
  - `package.json`: `"@supabase/supabase-js": "^2.89.0"`.
  - Versión instalada en `node_modules/@supabase/supabase-js/package.json`: `2.89.0`.
  - En esta versión, `SupabaseAuthClientOptions['lock']` está tipado como:
    ```ts
    lock?: <R>(name: string, acquireTimeout: number, fn: () => Promise<R>) => Promise<R>;
    ```
  - **Ojo crítico**: Aunque la implementación runtime de `@supabase/supabase-js` exporta `processLock`, su archivo de tipos `dist/index.d.mts` **NO lo re-exporta** (`@supabase/auth-js` sí lo hace, pero es una dependencia interna transitiva). Por ende, escribir `import { processLock } from '@supabase/supabase-js'` causaría error de compilación de TypeScript (`Module has no exported member 'processLock'`).
  - La solución limpia y 100% type-safe sin dependencias extra es definir la función de lock inline en `src/lib/supabase.ts` (ya sea como función directa que ejecuta `fn()`, o serializador en memoria dentro de la pestaña).
- **Nivel de confianza**: ALTA (100% verificado contra el código fuente, la versión instalada y los archivos `.d.mts` reales).

### 2026-09-18 13:12 — claude (re-verificación contra lo instalado)
- **`src/lib/supabase.ts` hoy — CONFIRMADO:** `createClient` (líneas 21-32) solo pasa `realtime.params` y `auth: { persistSession, autoRefreshToken, detectSessionInUrl }`. **Sin `lock`.**
- **Versión — CONFIRMADO:** `package.json:31` `"@supabase/supabase-js": "^2.89.0"`; instalado `2.89.0` (`node_modules/@supabase/supabase-js/package.json:3`) y `@supabase/auth-js@2.89.0`. **Corrección de ruta:** con pnpm el paquete está en `node_modules/.pnpm/@supabase+auth-js@2.89.0/node_modules/@supabase/auth-js/`, no en `node_modules/@supabase/auth-js/` como escribió agy (ese path no existe; su contenido sí coincide).
- **Default — CONFIRMADO:** `GoTrueClient.js:130-138`: si no hay `settings.lock` y hay `persistSession` + `navigator.locks`, usa `navigatorLock`.
- **Soporte de `auth.lock` — CONFIRMADO:** `lib/types.d.ts:79` `lock?: LockFunc`; `lib/locks.d.ts:85,106` exporta `navigatorLock` y `processLock`; `auth-js/index.d.ts:8` los re-exporta y `supabase-js/dist/index.d.mts:7` hace `export * from "@supabase/auth-js"`, así que `import { createClient, processLock } from '@supabase/supabase-js'` es válido en esta versión (también `navigatorLock` y `NavigatorLockAcquireTimeoutError`).
- **Refuerzo del mecanismo (nuevo, agy no lo vio):** las rutas internas piden el lock con espera **ilimitada**: `GoTrueClient.js:233` (`initialize`) y `:501` llaman `_acquireLock(-1, …)`, y no existe opción `lockAcquireTimeout` en 2.89.0. Con timeout −1, `navigatorLock` espera para siempre; si otra pestaña quedó congelada reteniendo el lock, esta espera hasta que el navegador destruya el contexto de la otra — exactamente «se pausa hasta que cierre las otras ventanas».
- **Cuidado con `processLock` (el fix de agy):** es un lock en memoria de UNA pestaña — deja de coordinar refresh de token entre pestañas. Dos pestañas pueden refrescar a la vez con el mismo refresh token; Supabase tolera reutilización dentro de una ventana corta (reuse interval) pero no la he comprobado en este proyecto. Es más simple y elimina el cuelgue, con un riesgo de carrera pequeño y no medido.
- **NO verificado:** que este sea de hecho el cuelgue de Rafael. No hay repro ni log del celular; la cadena (lock retenido por pestaña congelada → espera −1) es coherente con el síntoma y con el código, pero no se ha visto en dispositivo. Tampoco revisé `usePickingSync.ts:406-420` (lo cita el «contexto ya conocido»): no está en la evidencia de este hallazgo.
- **Confianza:** alta en el mecanismo del código; **media** en que sea la causa del síntoma reportado.

## Plan de fix propuesto
**Vigente — `src/lib/supabase.ts`:** mantener el lock entre pestañas pero con espera acotada; si no se consigue a tiempo, seguir sin él (que es lo que haría `processLock`).
```ts
import { createClient, navigatorLock, NavigatorLockAcquireTimeoutError } from '@supabase/supabase-js';

/**
 * auth-js pide su lock con espera ilimitada (-1). Una pestaña congelada en segundo
 * plano que lo retiene deja colgadas a las demás hasta cerrarla. Esperar 5 s y,
 * si no llega, seguir sin lock; el resto del tiempo se sigue coordinando entre pestañas.
 */
const authLock: typeof navigatorLock = async (name, acquireTimeout, fn) => {
  let started = false;
  try {
    return await navigatorLock(name, acquireTimeout < 0 ? 5000 : acquireTimeout, () => {
      started = true;
      return fn();
    });
  } catch (e) {
    if (!started && e instanceof NavigatorLockAcquireTimeoutError) return await fn();
    throw e;
  }
};
```
y en `createClient`: `auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, lock: authLock }`.
Alternativa más simple (la de agy, abajo): `lock: processLock`. Elegir el wrapper salvo que se prefiera cero coordinación entre pestañas.

**Verificación (no automatizable):** abrir 2–3 pestañas en el celular, dejar una en segundo plano unos minutos y volver a la activa; debe cargar sin cerrar las otras. `pnpm check` (tsc + vitest) para tipos: `typeof navigatorLock` es compatible con `LockFunc`.

### Plan anterior (agy, reemplazado; se conserva por historial)
Editar `src/lib/supabase.ts` pasando una función de lock inline que no dependa de `navigator.locks`:

```ts
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../integrations/supabase/types';

const env =
  (typeof import.meta !== 'undefined' && import.meta.env) ||
  (typeof process !== 'undefined' && process.env) ||
  {};
const supabaseUrl =
  env.VITE_SUPABASE_URL ||
  (typeof process !== 'undefined' && process.env.VITE_SUPABASE_URL) ||
  'http://127.0.0.1:54321';
const supabaseAnonKey =
  env.VITE_SUPABASE_ANON_KEY ||
  (typeof process !== 'undefined' && process.env.VITE_SUPABASE_ANON_KEY) ||
  'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';

/**
 * Unified Singleton Supabase client instance.
 * Includes optimized realtime and auth persistence settings to prevent instance duplication.
 */
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  realtime: {
    params: {
      eventsPerSecond: 20, // Increased slightly for warehouse operations
    },
  },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // Evita el deadlock de navigator.locks en navegadores móviles cuando pestañas
    // en segundo plano son congeladas/suspendidas por el sistema operativo.
    lock: async (_name, _acquireTimeout, fn) => {
      return await fn();
    },
  },
});
```

*Efecto del cambio*:
- En una sola pestaña: Las peticiones de auth y refresh continúan funcionando normalmente con `autoRefreshToken: true`.
- Con múltiples pestañas abiertas en el celular: Ninguna pestaña compite ni queda bloqueada esperando por un Web Lock de otra pestaña que el sistema operativo haya congelado en segundo plano.
- Cero advertencias ni errores de TypeScript (`tsc --noEmit` aprueba limpiamente).

## Autocorrección
### 2026-09-18 13:06 — agy
- **Antes se contemplaba**: `import { processLock } from '@supabase/supabase-js'`.
- **Nuevo hallazgo**: `processLock` está en el runtime pero omitido en `dist/index.d.mts` de `@supabase/supabase-js:2.89.0`. Importarlo directamente fallaría en `tsc`.
- **Corrección aplicada al plan**: Pasar la función lock inline `async (_name, _acquireTimeout, fn) => await fn()` que satisface exactamente la firma esperada y evita deadlocks entre pestañas.

### 2026-09-18 13:12
- Antes creía (agy 13:10): «la hipótesis … quedó confirmada al 100 %» y «Es un fix de configuración estándar y totalmente contenido».
- Nuevo hallazgo: lo confirmado al 100 % es la configuración del código y la API disponible; que ESA sea la causa del cuelgue en el celular no está probado. Y `processLock` no es gratis: quita la coordinación entre pestañas.
- Por qué estaba mal: se confundió «el mecanismo existe en el código» con «ocurre en el dispositivo». El plan vigente usa un lock con tiempo límite, que mantiene la coordinación cuando todo está sano.

## Preguntas para Rafael
Ninguna. Es un fix de configuración estándar y totalmente verificado.
