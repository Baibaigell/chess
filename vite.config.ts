import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// COOP/COEP 头：多线程 Stockfish 需要 SharedArrayBuffer（见 README 风险 2）。
// 第一批用单线程版引擎，这组头先留着，不依赖它也能跑。
const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  plugins: [react()],
  server: {
    headers: crossOriginIsolationHeaders,
  },
  preview: {
    headers: crossOriginIsolationHeaders,
  },
})
