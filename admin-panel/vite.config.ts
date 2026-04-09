import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const base = process.env.VITE_BASE ?? '/'

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    // Allow browser access through Cursor VM forwarded hostnames.
    allowedHosts: ['.cursorvm.com'],
  },
})
