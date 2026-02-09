import honox from 'honox/vite'
import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => {
  if (mode === 'client') {
    return {
      plugins: [honox.client()],
    }
  }
  return {
    plugins: [
      honox(),
    ],
    build: {
      ssr: './server.node.ts',
      rollupOptions: {
        output: {
          entryFileNames: 'index.js'
        }
      }
    },
    server: {
      port: 17543,
    },
    ssr: {
      external: ['node-pty', 'ws', 'execa'],
    },
  }
})
