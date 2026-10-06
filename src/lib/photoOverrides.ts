/**
 * Una foto girada a mano cambia de URL (la misma llave con `?v=` nuevo,
 * `replace_photo_url`). Las pantallas que ya la tienen en memoria la siguen
 * pidiendo con la URL vieja hasta que se recarguen: este registro les dice cuál
 * es la nueva, al instante y sin recargar nada.
 */
import { useSyncExternalStore } from 'react';

const byBase = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;

const baseOf = (url: string) =>
  url
    .split('?')[0]
    .replace('/photos/gallery/thumbs/', '/photos/gallery/')
    .replace('/photos/thumbs/', '/photos/');

/** La URL a mostrar: la nueva si la foto se giró en esta sesión (miniatura incluida). */
export function resolvePhotoUrl(url: string): string {
  if (!url || url.startsWith('blob:') || url.startsWith('data:')) return url;
  const next = byBase.get(baseOf(url));
  if (!next) return url;
  const version = next.includes('?') ? next.slice(next.indexOf('?')) : '';
  return url.split('?')[0] + version;
}

export function setPhotoOverride(oldUrl: string, newUrl: string): void {
  byBase.set(baseOf(oldUrl), newUrl);
  version += 1;
  listeners.forEach((l) => l());
}

/** Se vuelve a pintar cuando se gira cualquier foto. */
export function usePhotoOverrides(): typeof resolvePhotoUrl {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version
  );
  return resolvePhotoUrl;
}
