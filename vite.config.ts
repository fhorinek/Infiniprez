import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
  // CSP-friendly defaults for this project:
  // - do not use the React Fast Refresh plugin runtime
  // - disable HMR websocket client injection
  server: {
    hmr: false,
  },
})
