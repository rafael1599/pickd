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

import fs from 'node:fs';
import path from 'node:path';

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

/**
 * Cloudflare Pages rejects any asset > 25 MiB.
 * onnxruntime-web's JSEP WASM binary is ~28.3 MiB.
 * This plugin slices any .wasm file > 24 MiB in dist/assets/ into 2 halves of ~13.5 MiB each,
 * unlinks the oversized original, and provides a dev server middleware to serve the parts.
 */
const splitLargeWasmPlugin = (): Plugin => ({
  name: 'pickd-split-large-wasm',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (
        req.url === '/assets/ort-wasm-simd-threaded.jsep.part1.wasm' ||
        req.url === '/assets/ort-wasm-simd-threaded.jsep.part2.wasm'
      ) {
        const wasmPath = path.resolve(
          __dirname,
          'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm'
        );
        if (!fs.existsSync(wasmPath)) return next();
        const buf = fs.readFileSync(wasmPath);
        const half = Math.ceil(buf.length / 2);
        const isPart1 = req.url.endsWith('part1.wasm');
        const chunk = isPart1 ? buf.subarray(0, half) : buf.subarray(half);
        res.setHeader('Content-Type', 'application/wasm');
        res.setHeader('Content-Length', chunk.length);
        res.end(chunk);
        return;
      }
      next();
    });
  },
  closeBundle() {
    const distAssetsDir = path.resolve(__dirname, 'dist/assets');
    if (!fs.existsSync(distAssetsDir)) return;

    const files = fs.readdirSync(distAssetsDir);
    for (const file of files) {
      if (!file.endsWith('.wasm')) continue;
      const filePath = path.join(distAssetsDir, file);
      const stats = fs.statSync(filePath);

      // Cloudflare Pages limit is 25 MiB (26,214,400 bytes)
      if (stats.size > 24 * 1024 * 1024) {
        console.log(
          `[split-wasm] Found oversized wasm file: ${file} (${(stats.size / 1024 / 1024).toFixed(2)} MiB)`
        );
        const buf = fs.readFileSync(filePath);
        const half = Math.ceil(buf.length / 2);
        const part1 = buf.subarray(0, half);
        const part2 = buf.subarray(half);

        const p1Path = path.join(distAssetsDir, 'ort-wasm-simd-threaded.jsep.part1.wasm');
        const p2Path = path.join(distAssetsDir, 'ort-wasm-simd-threaded.jsep.part2.wasm');

        fs.writeFileSync(p1Path, part1);
        fs.writeFileSync(p2Path, part2);

        // Remove the original oversized file so Cloudflare Pages won't reject the deploy
        fs.unlinkSync(filePath);
        console.log(
          `[split-wasm] Split into part1 (${(part1.length / 1024 / 1024).toFixed(2)} MiB) and part2 (${(part2.length / 1024 / 1024).toFixed(2)} MiB); removed original.`
        );
      }
    }
  },
});

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), versionFile(), splitLargeWasmPlugin()],
  // The barcode reader's Worker loads zxing-wasm lazily; code-splitting in a
  // Worker needs ES module output (src/lib/recognition/barcodes.worker.ts).
  worker: { format: 'es' },
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
