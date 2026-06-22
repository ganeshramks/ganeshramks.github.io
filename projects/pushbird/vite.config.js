import { defineConfig } from 'vite';

export default defineConfig({
  base: '/projects/pushbird/',
  server: {
    fs: {
      // Allow Vite to serve the local MediaPipe wasm binaries straight out of node_modules
      allow: ['.']
    }
  }
});
