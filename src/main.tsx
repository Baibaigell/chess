import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

// 棋盘样式：chessground 必需，缺失则棋子与棋盘完全不可见
import 'chessground/assets/chessground.base.css'
import 'chessground/assets/chessground.brown.css'
// 棋子图形：12 种棋子的 SVG 以内嵌 data URI 形式提供，必须在 brown 之后
import 'chessground/assets/chessground.cburnett.css'
// 本项目样式放在棋盘样式之后，便于覆盖
import './styles/global.css'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('未找到 #root 挂载点')

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

/**
 * 注册 Service Worker，让页面可添加到主屏幕并离线玩本地对局。
 *
 * 开发服务器上不注册：SW 的缓存会让改动看不到。
 * vite 开发端口是 5173 / 预览是 4173，正式部署不会用这两个端口。
 */
const isDevServer = ['5173', '4173'].includes(location.port)
if ('serviceWorker' in navigator && !isDevServer) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // 注册失败不影响正常使用，静默忽略
    })
  })
}
