import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

/**
 * Bundles the e2e harness into a single IIFE the fixture page can load with a
 * plain script tag. Mirrors the extension's own build settings — inlined
 * fonts above all — so the harness exercises the same bytes the extension
 * ships.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(import.meta.dirname, '../.build'),
    emptyOutDir: true,
    lib: {
      entry: resolve(import.meta.dirname, 'index.ts'),
      name: 'ForgeHarness',
      formats: ['iife'],
      fileName: () => 'harness.js',
    },
    assetsInlineLimit: (filePath: string, content: Buffer) => {
      if (/\.woff2?$/i.test(filePath)) return true;
      return content.length < 4096;
    },
  },
  define: {
    'import.meta.env.MODE': JSON.stringify('production'),
    // React's ESM entry reads `process.env.NODE_ENV`, which does not exist in
    // a plain page. WXT substitutes this for the extension build; the harness
    // has to do it itself.
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
});
