import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Client build for rhobear.ai. Prerendering happens after `vite build`
// in scripts/prerender.mjs, which writes one index.html per canonical route.
export default defineConfig({
  base: '/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // No index.html entry: HTML is generated per route by scripts/prerender.mjs.
    // main.tsx is the hydration bundle, injected into dynamic routes only.
    rollupOptions: {
      input: { main: 'src/main.tsx' },
    },
  },
});