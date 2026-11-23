import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { assistantRelay } from './server/assistantRelay.js';

// base './' lets the built site run from any sub-path (GitHub Pages, a university server, a USB stick + local server).
export default defineConfig({
  base: './',
  // the assistant's relay: /api/assistant adds the Gemini key from this computer (server/assistantRelay.js)
  plugins: [react(), assistantRelay()],
  build: { chunkSizeWarningLimit: 1200 },
});
