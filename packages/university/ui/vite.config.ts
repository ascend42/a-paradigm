import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  server: {
    port: parseInt(process.env.PORT || '3839', 10),
    open: false,
    proxy: {
      '/api': {
        target: 'http://localhost:3839',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  define: {
    __PARADIGM_VERSION__: JSON.stringify(process.env.npm_package_version || '0.1.0'),
  },
});
