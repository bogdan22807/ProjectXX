import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Listen on all addresses (IPv4 + IPv6). Default `localhost` often binds only
    // to ::1, so http://127.0.0.1:5173 fails and the tab looks blank / won't load.
    host: true,
    // Allow browser access through Cursor VM forwarded hostnames.
    allowedHosts: ['.cursorvm.com'],
  },
})
