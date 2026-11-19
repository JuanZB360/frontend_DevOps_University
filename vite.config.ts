/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

/**
 * Configuración de Vite (build y servidor de desarrollo) y Vitest (tests).
 * https://vite.dev/config/
 */
export default defineConfig(({ mode }) => {
  // Lee frontend/.env (y el entorno del sistema, que tiene prioridad).
  // Prefijo '' = también las variables sin VITE_, que NO llegan al navegador.
  const env = loadEnv(mode, process.cwd(), '')
  return {
  plugins: [react()],
  server: {
    port: 5173,
    // En desarrollo, /api se redirige al backend Spring Boot (API_PROXY_TARGET en .env).
    proxy: {
      '/api': {
        target: env.API_PROXY_TARGET || 'http://localhost:8090',
        // Para el navegador, /api es del mismo origen (Vite). Se quita la cabecera
        // Origin para que el backend no aplique CORS: así funciona aunque Vite
        // arranque en 5174, 5175… porque el 5173 esté ocupado.
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => proxyReq.removeHeader('origin'))
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  }
})
