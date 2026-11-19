/**
 * 服务器地址设置的行为验证。
 *
 * 重点：APK 里页面来自 appassets.androidplatform.net，
 * 同源地址连不上，必须靠用户手动配置。这里验证配置的读写与规范化。
 */
const store = new Map<string, string>()
const ls = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
}

const g = globalThis as unknown as Record<string, unknown>
g.window = {
  location: { protocol: 'https:', hostname: 'appassets.androidplatform.net', port: '', pathname: '/' },
  addEventListener: () => {},
  localStorage: ls,
  sessionStorage: ls,
}
g.localStorage = ls
g.sessionStorage = ls
g.document = {
  getElementById: () => null,
  createElement: () => ({ style: {}, setAttribute: () => {}, appendChild: () => {} }),
  head: { appendChild: () => {} },
  body: { appendChild: () => {} },
  addEventListener: () => {},
}
g.location = (g.window as Record<string, unknown>).location
g.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(0), 0)
g.cancelAnimationFrame = (id: number) => clearTimeout(id)

const { getServerUrl, setServerUrl, resetServerUrl, normalizeServerUrl, validateServerUrl, resolveServerUrl, URL_KEY } =
  await import('../src/net/client')

let pass = 0
let fail = 0
const failures: string[] = []
function ok(cond: boolean, label: string): void {
  if (cond) pass++
  else {
    fail++
    failures.push(label)
  }
}
function eq(actual: unknown, expect: unknown, label: string): void {
  ok(actual === expect, `${label}（期望 ${String(expect)}，实际 ${String(actual)}）`)
}

// ============================================================
// 地址规范化
// ============================================================

eq(normalizeServerUrl('https://chess.onrender.com'), 'wss://chess.onrender.com', 'https 转 wss')
eq(normalizeServerUrl('http://1.2.3.4:8080'), 'ws://1.2.3.4:8080', 'http 转 ws')
eq(normalizeServerUrl('wss://a.com/'), 'wss://a.com', '去掉尾部斜杠')
eq(normalizeServerUrl('ws://localhost:8080'), 'ws://localhost:8080', 'ws 原样保留')
eq(normalizeServerUrl('chess.onrender.com'), 'wss://chess.onrender.com', '无协议公网默认 wss')
eq(normalizeServerUrl('localhost:8080'), 'ws://localhost:8080', '无协议本地默认 ws')
eq(normalizeServerUrl('192.168.1.5:8080'), 'ws://192.168.1.5:8080', '内网 IP 用 ws')
eq(normalizeServerUrl('   '), '', '空白返回空串')

// ============================================================
// 校验
// ============================================================

eq(validateServerUrl(''), null, '空值合法（用同源）')
eq(validateServerUrl('   '), null, '空白合法')
eq(validateServerUrl('wss://a.com'), null, '合法 wss')
eq(validateServerUrl('https://a.com'), null, 'https 也合法（会被转换）')
ok(validateServerUrl('不是地址') !== null, '乱码被拒绝')
ok(validateServerUrl('ftp://a.com') !== null, 'ftp 被拒绝')

// ============================================================
// 读写
// ============================================================

store.clear()
eq(getServerUrl(), null, '初始未配置返回 null')

setServerUrl('https://chess.onrender.com')
eq(getServerUrl(), 'wss://chess.onrender.com', '保存后自动转成 wss')
eq(store.get(URL_KEY), 'wss://chess.onrender.com', '确实写进 localStorage')

setServerUrl('')
eq(getServerUrl(), null, '存空值等于清除')
eq(store.has(URL_KEY), false, '空值会删掉键')

setServerUrl('wss://x.com')
resetServerUrl()
eq(getServerUrl(), null, 'reset 清掉配置')

// ============================================================
// resolveServerUrl：APK 场景
// ============================================================

// 未配置时，APK 会算出同源地址（连不上，所以必须让用户填）
store.clear()
eq(resolveServerUrl(), 'wss://appassets.androidplatform.net', 'APK 未配置时是同源地址')

// 配置后必须用配置的
setServerUrl('https://chess.onrender.com')
eq(resolveServerUrl(), 'wss://chess.onrender.com', '配置后 resolveServerUrl 用配置值')

// 配置里的尾部斜杠不影响
setServerUrl('wss://a.com///')
eq(resolveServerUrl(), 'wss://a.com', '多个尾部斜杠被清理')

// ============================================================
// 隐私模式：localStorage 抛异常不能崩
// ============================================================

{
  const broken = {
    getItem: () => {
      throw new Error('denied')
    },
    setItem: () => {
      throw new Error('denied')
    },
    removeItem: () => {
      throw new Error('denied')
    },
    clear: () => {},
  }
  const saved = (g.window as Record<string, unknown>).localStorage
  ;(g.window as Record<string, unknown>).localStorage = broken
  g.localStorage = broken

  let threw = false
  try {
    getServerUrl()
    setServerUrl('wss://a.com')
    resetServerUrl()
  } catch {
    threw = true
  }
  ok(!threw, 'localStorage 不可用时不抛异常')
  eq(getServerUrl(), null, '不可用时返回 null')

  ;(g.window as Record<string, unknown>).localStorage = saved
  g.localStorage = saved
}

// ---------- 输出 ----------
console.log('='.repeat(60))
if (fail === 0) {
  console.log(`✓ 服务器设置验证：全部通过（${pass} 项）`)
} else {
  console.log(`✗ 失败 ${fail} / 通过 ${pass}`)
  for (const f of failures) console.log('  ✗ ' + f)
}
process.exit(fail === 0 ? 0 : 1)
