import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// https://vite.dev/config/
export default defineConfig({
  base: '/plasmid_network/',
  plugins: [react(), viteSingleFile()],
  build: {
    assetsInlineLimit: 1000000000, // 1GB, to force inline assets
  },
})
