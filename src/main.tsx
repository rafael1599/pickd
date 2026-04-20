import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SwipeableToaster } from './components/ui/SwipeableToaster';
import './index.css';
import App from './App';
import { QueryProvider } from './components/QueryProvider';
import { ErrorBoundary } from './components/ErrorBoundary';

// Chunk load error recovery — catches failed dynamic imports at runtime
// (e.g., after deploy invalidated old chunk hashes).
window.addEventListener('unhandledrejection', (event) => {
  const msg = String(event.reason?.message || event.reason || '');
  if (
    msg.includes('dynamically imported module') ||
    msg.includes('Failed to fetch') ||
    msg.includes('Loading chunk') ||
    msg.includes('ChunkLoadError')
  ) {
    console.warn('[ChunkRecovery] Dynamic import failed, reloading:', msg);
    // Prevent infinite loop
    const key = 'pickd-chunk-reload';
    const last = sessionStorage.getItem(key);
    const now = Date.now();
    if (last && now - Number(last) < 10000) return; // already reloaded recently
    sessionStorage.setItem(key, String(now));
    window.location.reload();
  }
});

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Failed to find the root element');

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryProvider>
        <App />
        <SwipeableToaster />
      </QueryProvider>
    </ErrorBoundary>
  </StrictMode>
);
