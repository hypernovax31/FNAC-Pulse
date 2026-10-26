import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/\/node_modules\/(?:@firebase|firebase)\/firestore\//.test(id)) return 'firebase-firestore';
          if (/\/node_modules\/(?:@firebase|firebase)\/auth\//.test(id)) return 'firebase-auth';
          if (id.includes('/node_modules/@firebase/') || id.includes('/node_modules/firebase/')) return 'firebase-core';
          if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/') || id.includes('/node_modules/scheduler/')) return 'react';
        },
      },
    },
  },
});
