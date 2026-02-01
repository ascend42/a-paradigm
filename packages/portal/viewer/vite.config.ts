import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  server: {
    port: parseInt(process.env.PORT || '42195', 10), // Marathon distance: 42.195km
    open: false, // CLI will handle opening
  },
  build: {
    outDir: 'dist/ui',
    sourcemap: true,
  },
  define: {
    __PORTAL_VIEWER_VERSION__: JSON.stringify(process.env.npm_package_version || '0.1.0'),
  },
});
