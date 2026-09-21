import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    __CARD_REDEEM_BUILD__: 'false',
    __STATIC_COMPLIANCE_BUILD__: 'true',
  },
  // Publish only an explicit asset allowlist, never the blog's public directory.
  publicDir: false,
  build: {
    outDir: 'dist-start',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: { input: 'start.html' },
  },
});
