/// <reference types="vitest" />
import { execSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Which build this is — the commit Cloudflare Pages built (else the local HEAD)
 * and when. A page that stays open keeps running the build it loaded, so the app
 * compares this with the `version.json` being served and offers the new one
 * (hooks/useAppUpdate). Until 11 Sep 2026 nothing did: a fix reached a phone only
 * when someone happened to reload it.
 */
const BUILD_ID = (() => {
  let sha = process.env.CF_PAGES_COMMIT_SHA ?? '';
  if (!sha) {
    try {
      sha = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    } catch {
      sha = 'dev';
    }
  }
  return `${sha.trim().slice(0, 7)}-${Date.now().toString(36)}`;
})();

const versionFile = (): Plugin => ({
  name: 'pickd-version-file',
  apply: 'build',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'version.json',
      source: JSON.stringify({ build: BUILD_ID }),
    });
  },
});

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), versionFile()],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
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
