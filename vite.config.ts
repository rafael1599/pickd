import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      // Proxy R2 images to avoid CORS issues in dev (pub-*.r2.dev doesn't honor CORS rules)
      '/r2-proxy': {
        target: 'https://pub-1a61139939fa4f3ba21ee7909510985c.r2.dev',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/r2-proxy/, ''),
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    exclude: ['node_modules', 'tests/e2e'],
  },
});
