// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served at gordontu.com/data-visualization/presidential-margins-1868-2020/live/ (the route in wrangler.jsonc).
// Cloudflare looks files up in dist by the full path, so the output directory carries that path too.
export default defineConfig({
  base: '/data-visualization/presidential-margins-1868-2020/live/',
  build: { outDir: 'dist/data-visualization/presidential-margins-1868-2020/live' },
  plugins: [react()],
});
