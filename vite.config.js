import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/plasmid_network/',
  plugins: [react()],
  build: {
    assetsInlineLimit: 0, // disable inlining to copy .parquet files as real assets
  },
})
