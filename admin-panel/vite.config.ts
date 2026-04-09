import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // App is deployed under /admin-panel on Vercel.
  base: '/admin-panel/',
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    // Allow browser access through Cursor VM forwarded hostnames.
    allowedHosts: ['.cursorvm.com'],
  },
})
