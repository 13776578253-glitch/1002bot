import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: import.meta.dirname,
  appType: 'mpa',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5199,
    strictPort: true,
  },
  build: {
    assetsInlineLimit: 0,
    rolldownOptions: {
      input: fileURLToPath(new URL('./index.html', import.meta.url)),
      output: {
        codeSplitting: {
          groups: [
            { name: 'vendor', test: /node_modules/ },
            { name: 'app', test: /playground|src/ },
          ],
        },
      },
    },
  },
});
