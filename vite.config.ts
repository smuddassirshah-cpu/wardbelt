// Decision notes: JSX compiled by esbuild directly (no @preact/preset-vite) to keep the
// dependency list to PLAN.md section 10. The service worker is injectManifest so src/sw.ts
// owns notification click handling while Workbox supplies the precache manifest.
// VITE_BASE_PATH sets the GitHub Pages sub-path; VITE_APP_VERSION is the git SHA in CI.
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

const base = process.env.VITE_BASE_PATH ?? '/';
const version = process.env.VITE_APP_VERSION ?? 'dev';

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  resolve: {
    alias: {
      '@domain': fileURLToPath(new URL('./src/domain', import.meta.url)),
      '@store': fileURLToPath(new URL('./src/store', import.meta.url)),
      '@scheduler': fileURLToPath(new URL('./src/scheduler', import.meta.url)),
      '@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
      '@fixtures': fileURLToPath(new URL('./tests/fixtures', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    modulePreload: { polyfill: false },
  },
  plugins: [
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Wardbelt',
        short_name: 'Wardbelt',
        description: 'Surgical ward task belt for a single veterinary nurse shift',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#FAFAF9',
        theme_color: '#0F6E56',
        lang: 'en-GB',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
      },
      devOptions: { enabled: false },
    }),
  ],
  preview: { port: 4173, strictPort: true },
  server: { port: 5173, strictPort: true },
});
