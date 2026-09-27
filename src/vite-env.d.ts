/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** `<commit>-<time>` of the build this page is running (vite.config.ts). */
declare const __BUILD_ID__: string;

/** Epoch of data resets (vite.config.ts). Incremented when schema changes require local wipe. */
declare const __RESET_EPOCH__: number;

declare module 'papaparse' {
  export function parse<T>(input: string, config: Record<string, unknown>): { data: T[] };
  // Add minimal needed types
}
