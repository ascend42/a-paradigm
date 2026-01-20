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
    port: parseInt(process.env.PORT || '3000', 10),
    open: false, // CLI will handle opening
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  define: {
    __PARADIGM_VERSION__: JSON.stringify(process.env.npm_package_version || '0.1.0'),
  },
});
