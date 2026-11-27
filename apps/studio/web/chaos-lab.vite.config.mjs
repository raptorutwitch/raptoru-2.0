// Construction du Chaos Lab seul (npm run chaos:lab) ; n'influe pas sur la construction de Studio (index.html).
import { URL, fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  build: {
    outDir: 'dist/chaos-lab',
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL('./chaos-lab.html', import.meta.url)),
    },
  },
  logLevel: 'warn',
});
