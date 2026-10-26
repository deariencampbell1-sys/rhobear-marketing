import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// No @types/node in this wave's frozen dependency list, so `process` is read
// through globalThis rather than declared. RHOBEAR_DIST unset means `dist/`.
const env = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process
  ?.env;

// Client build for rhobear.ai. Prerendering happens after `vite build`
// in scripts/prerender.mjs, which writes one index.html per canonical route.
export default defineConfig({
  base: '/',
  plugins: [react()],
  build: {
    // RHOBEAR_DIST unset means `dist/`, the production directory. The routes
    // test sets it so `npm run build` itself can run without touching `dist/`.
    outDir: env?.RHOBEAR_DIST || 'dist',
    emptyOutDir: true,
    // No index.html entry: HTML is generated per route by scripts/prerender.mjs.
    // main.tsx is the hydration bundle, injected into dynamic routes only.
    rollupOptions: {
      input: { main: 'src/main.tsx' },
    },
  },
});