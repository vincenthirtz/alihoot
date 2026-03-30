import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        player: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
        login: resolve(__dirname, 'login.html'),
        history: resolve(__dirname, 'history.html'),
        leaderboard: resolve(__dirname, 'leaderboard.html'),
        profile: resolve(__dirname, 'profile.html'),
      },
    },
  },
  server: {
    proxy: {
      '/socket.io': 'http://localhost:3000',
      '/api': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    },
  },
});
