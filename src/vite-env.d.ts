/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_API_KEY: string;
  readonly VITE_OPENAI_API_KEY: string;
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** `<commit>-<time>` of the build this page is running (vite.config.ts). */
declare const __BUILD_ID__: string;

declare module 'papaparse' {
  export function parse<T>(input: string, config: Record<string, unknown>): { data: T[] };
  // Add minimal needed types
}
