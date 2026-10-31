import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Mesma origem em dev: proxy Socket.IO para o servidor.
const serverPort = process.env.PORT ?? '3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.CLIENT_PORT ?? 5173),
    proxy: {
      '/socket.io': {
        target: `http://localhost:${serverPort}`,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist/client',
    sourcemap: true,
  },
});
