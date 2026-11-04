import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // `host: true` exposes the dev server on the local network so a phone
    // running Nimiq Pay can load the Mini App during development.
    port: 5173,
    host: true,
  },
})
