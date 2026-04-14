import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const base = process.env.VITE_BASE ?? '/'

/** Backend for dev/preview proxy; must match where `npm run dev` in /backend listens (default 3000). */
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000'

const apiProxy = {
  '/api': { target: apiProxyTarget, changeOrigin: true },
} as const

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    proxy: { ...apiProxy },
  },
  // Without this, `vite preview` serves the SPA for `/api/*` (200 + index.html) and the client fails to parse JSON.
  preview: {
    proxy: { ...apiProxy },
  },
})
