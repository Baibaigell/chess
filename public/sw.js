/**
 * Service Worker：离线可用。
 *
 * 策略（刻意简单，避免缓存导致「改了代码看不到」的经典问题）：
 * - 导航请求（HTML）：network-first，失败回退缓存
 *   → 有网时永远拿到最新页面，没网时用上次的
 * - 静态资源（JS/CSS/图片/引擎）：stale-while-revalidate
 *   → 立即用缓存保证快，后台顺便更新
 * - WebSocket 与 /api/：完全不拦截
 *
 * 版本号改了才会重新预缓存；旧缓存会在 activate 时清掉。
 */
// 每次发布前端改动都要递增，否则客户端会一直用旧缓存
const VERSION = 'v5'
const CACHE = `chess-app-${VERSION}`

/** 预缓存的核心资源：只有这些是首次访问就要有的 */
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/assets/app.js',
  '/assets/app.css',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
]

/** 安装：预缓存核心资源 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      // 逐个添加：某个资源 404 不应让整个安装失败
      await Promise.all(
        PRECACHE.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: 'reload' }))
          } catch {
            /* 缺失的资源忽略，运行时再补 */
          }
        }),
      )
      // 立即接管，不等旧页面关闭
      await self.skipWaiting()
    })(),
  )
})

/** 激活：清掉旧版本缓存 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names.filter((n) => n.startsWith('chess-app-') && n !== CACHE).map((n) => caches.delete(n)),
      )
      await self.clients.claim()
    })(),
  )
})

/** 判断是否该由本 SW 处理 */
function shouldHandle(request, url) {
  if (request.method !== 'GET') return false
  // 不碰 API
  if (url.pathname.startsWith('/api/')) return false
  // 不碰 WebSocket 升级（虽然 fetch 事件里本来就不会有）
  if (request.headers.get('upgrade') === 'websocket') return false
  // 只处理同源
  if (url.origin !== self.location.origin) return false
  return true
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (!shouldHandle(request, url)) return

  // 导航请求：network-first
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request)
          const cache = await caches.open(CACHE)
          cache.put('/index.html', fresh.clone())
          return fresh
        } catch {
          const cache = await caches.open(CACHE)
          return (await cache.match('/index.html')) ?? (await cache.match('/')) ?? Response.error()
        }
      })(),
    )
    return
  }

  // 静态资源：network-first，离线才回退缓存
  //
  // 这里不能用 stale-while-revalidate：资源文件名没有内容 hash
  // （/assets/app.js 永远同名），先返回缓存会导致改动要刷新两次才生效，
  // 用户看到的是旧版本。联机对局本来就要求联网，缓存只在断网兜底。
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)

      try {
        const fresh = await fetch(request)
        // 只缓存成功的同源响应
        if (fresh.ok && fresh.type === 'basic') cache.put(request, fresh.clone())
        return fresh
      } catch {
        const cached = await cache.match(request)
        if (cached) return cached

        // 彻底离线且没缓存
        return new Response('离线且未缓存该资源', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        })
      }
    })(),
  )
})

/** 收到消息：支持页面主动要求跳过等待（新版本立即生效） */
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting()
})
