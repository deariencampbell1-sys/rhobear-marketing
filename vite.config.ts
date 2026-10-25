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
  },
});