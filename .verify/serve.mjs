/** 本地静态服务器：把打包产物以 http:// 提供，供浏览器自测
 *
 * 为什么需要它：直接双击 file:// 打开 index.html 时，
 * 浏览器的 CORS 策略会拦截 fetch 与 type="module" 脚本，
 * 导致大量"假失败"。用 http:// 打开才是真实行为。
 *
 * 用法：
 *   node .verify/serve.mjs
 *   然后浏览器打开 http://127.0.0.1:8123/selftest.html
 */
import http from 'http'
import fs from 'fs'
import path from 'path'

const ROOT = path.resolve('android/app/src/main/assets')
const PORT = 8123

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
}

http
  .createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0])
    if (p === '/') p = '/selftest.html'
    const file = path.join(ROOT, p)
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404)
      res.end('not found: ' + p)
      return
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cache-Control': 'no-store',
    })
    fs.createReadStream(file).pipe(res)
  })
  .listen(PORT, '127.0.0.1', () => {
    console.log('自测服务器已启动：')
    console.log('  http://127.0.0.1:' + PORT + '/selftest.html')
    console.log('  资源根目录: ' + ROOT)
  })
