import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const base = process.env.VITE_BASE ?? '/'

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    proxy: {
      '/accounts': { target: 'http://localhost:3000', changeOrigin: true },
      '/proxies': { target: 'http://localhost:3000', changeOrigin: true },
      '/profiles': { target: 'http://localhost:3000', changeOrigin: true },
      '/logs': { target: 'http://localhost:3000', changeOrigin: true },
      '/warmup': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
})
