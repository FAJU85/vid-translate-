import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Without VITE_API_BASE the app calls /api on its own origin; in dev that is
    // forwarded to a local `wrangler dev` (see worker/).
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
});
