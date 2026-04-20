import { lazy } from 'react';

/**
 * Wraps React.lazy() with automatic retry + page reload on chunk load failure.
 * When a dynamically imported module fails (e.g., after deploy invalidated the
 * chunk), retries once. If the retry also fails, reloads the page so the browser
 * fetches fresh chunk references from the new index.html.
 */
export function lazyWithRetry<T extends { default: React.ComponentType<any> }>(
  factory: () => Promise<T>
): React.LazyExoticComponent<T['default']> {
  return lazy(() =>
    factory().catch((err) => {
      console.warn('[lazyWithRetry] Chunk load failed, retrying...', err);
      // Retry once after a brief delay
      return new Promise<T>((resolve, reject) => {
        setTimeout(() => {
          factory()
            .then(resolve)
            .catch((retryErr) => {
              console.error('[lazyWithRetry] Retry failed, reloading page', retryErr);
              // Prevent infinite reload loops — check if we already reloaded
              const reloadKey = 'pickd-chunk-reload';
              const lastReload = sessionStorage.getItem(reloadKey);
              const now = Date.now();
              if (lastReload && now - Number(lastReload) < 10000) {
                // Already reloaded recently — show error instead
                reject(retryErr);
                return;
              }
              sessionStorage.setItem(reloadKey, String(now));
              window.location.reload();
            });
        }, 1000);
      });
    })
  );
}
