import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: '0.0.0.0' },
  build: {
    outDir: 'dist',
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/src/pages/Boards')) return 'boards'
          if (id.includes('/src/pages/Settings')) return 'settings'
          if (id.includes('/src/pages/DevTools')) return 'devtools'
          if (id.includes('node_modules')) {
            if (id.includes('lucide-react')) return 'icons'
            if (id.includes('zustand')) return 'state'
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react-vendor'
          }
        },
      },
    },
  },
})
