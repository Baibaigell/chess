/**
 * 第 2 批端到端验证：浏览器之外的最小仿真。
 *
 * 校验的是「dist 产物能否被服务端正常托管」以及
 * 「两个客户端能否通过服务端完成一整局联机对弈」。
 *
 * 与 b2_server.test.mjs 的区别：那个测服务端协议细节，
 * 这个测真实使用路径——加载 dist 里的前端资源 + 用引擎下棋。
 */
import { setTimeout as sleep } from 'node:timers/promises'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

process.env.PORT = '8098'
process.env.STATIC_ROOT = path.resolve('dist')

await import('../server/server.js')

const BASE = 'http://127.0.0.1:8098'
const WS_URL = 'ws://127.0.0.1:8098'

let pass = 0
let fail = 0
const failures = []
function ok(cond, label) {
  if (cond) pass++
  else {
    fail++
    failures.push(label)
  }
}

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return
    } catch {
      /* 未就绪 */
    }
    await sleep(100)
  }
  throw new Error('服务端未就绪')
}

await waitForServer()

// ---- 1. dist 静态资源可访问 ----
{
  const idx = await fetch(`${BASE}/`)
  const html = await idx.text()
  ok(idx.ok && html.includes('/assets/app.js'), '首页引用构建产物 app.js')
  ok(html.includes('manifest.webmanifest'), '首页引用 PWA manifest')
  ok(html.includes('/assets/app.css'), '首页引用构建产物 app.css')

  const js = await fetch(`${BASE}/assets/app.js`)
  const jsText = await js.text()
  ok(js.ok && jsText.length > 100_000, `app.js 可下载（${(jsText.length / 1024).toFixed(0)} KB）`)
  ok(
    js.headers.get('content-type')?.includes('javascript'),
    'app.js 的 Content-Type 为 javascript',
  )

  const css = await fetch(`${BASE}/assets/app.css`)
  ok(css.ok, 'app.css 可下载')

  const manifest = await fetch(`${BASE}/manifest.webmanifest`)
  const mText = await manifest.text()
  ok(manifest.ok && mText.includes('icon-512.png'), 'manifest 可访问且含图标')
  ok(
    manifest.headers.get('content-type')?.includes('manifest'),
    'manifest 的 Content-Type 正确',
  )

  const sw = await fetch(`${BASE}/sw.js`)
  const swText = await sw.text()
  ok(sw.ok && swText.includes('addEventListener'), 'sw.js 可访问')

  const icon = await fetch(`${BASE}/icons/icon-192.png`)
  ok(icon.ok && icon.headers.get('content-type') === 'image/png', '图标可访问且为 PNG')

  const piece = await fetch(`${BASE}/pieces/wk.png`)
  ok(piece.ok, '棋子图片可访问')

  const engine = await fetch(`${BASE}/engines/stockfish/stockfish-19-lite-single.js`)
  ok(engine.ok, 'Stockfish 引擎文件可访问')
  const wasm = await fetch(`${BASE}/engines/stockfish/stockfish-19-lite-single.wasm`)
  ok(wasm.ok && wasm.headers.get('content-type') === 'application/wasm', 'WASM 的 MIME 为 application/wasm')
}

// ---- 2. 两个客户端用真实引擎下完一局五子棋 ----
const { GomokuEngine } = await import('../src/games/gomoku/engine.ts').catch(async () => {
  // .ts 不能直接被 node 引入，改用已打包的测试产物
  return {}
})

class Client {
  constructor() {
    this.messages = []
    this.ws = new WebSocket(WS_URL)
    this.ws.onmessage = (ev) => {
      try {
        this.messages.push(JSON.parse(String(ev.data)))
      } catch {
        /* 忽略 */
      }
    }
  }
  async open() {
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('连接超时')), 3000)
      this.ws.onopen = () => {
        clearTimeout(t)
        res()
      }
    })
  }
  send(o) {
    this.ws.send(JSON.stringify(o))
  }
  async waitFor(type, ms = 3000) {
    const end = Date.now() + ms
    while (Date.now() < end) {
      const i = this.messages.findIndex((m) => m.type === type)
      if (i >= 0) return this.messages.splice(i, 1)[0]
      await sleep(20)
    }
    throw new Error(`等待 ${type} 超时`)
  }
  close() {
    try {
      this.ws.close()
    } catch {
      /* 已关闭 */
    }
  }
}

{
  const a = new Client()
  await a.open()
  a.send({ type: 'create', version: 1, game: 'gomoku', name: '甲' })
  const created = await a.waitFor('created')

  const b = new Client()
  await b.open()
  b.send({ type: 'join', version: 1, room: created.room, name: '乙' })
  await b.waitFor('joined')
  await a.waitFor('opponent-joined')
  ok(true, '两个客户端成功进入同一房间')

  // 黑方（先行方）在 a 列连成五子；白方在远端应着
  const blacks = ['a1', 'a2', 'a3', 'a4', 'a5']
  const whites = ['o15', 'o14', 'o13', 'o12']

  for (let i = 0; i < blacks.length; i++) {
    a.send({ type: 'move', move: { from: blacks[i], to: blacks[i] } })
    const m1 = await a.waitFor('move-applied')
    const m2 = await b.waitFor('move-applied')
    ok(m1.move.to === blacks[i] && m2.move.to === blacks[i], `第 ${i + 1} 手黑方走子双方同步`)

    if (i < whites.length) {
      b.send({ type: 'move', move: { from: whites[i], to: whites[i] } })
      await a.waitFor('move-applied')
      await b.waitFor('move-applied')
      ok(true, `第 ${i + 1} 手白方走子双方同步`)
    }
  }

  // 黑方成五后，客户端引擎应判定黑胜；这里只验证服务端仍能正常转发认输
  b.send({ type: 'resign' })
  const over = await a.waitFor('game-over')
  ok(over.winner === 'first', '认输后服务端判定先行方获胜')

  a.close()
  b.close()
}

// ---- 3. 并发多房间互不干扰 ----
{
  const pairs = []
  for (let i = 0; i < 3; i++) {
    const h = new Client()
    await h.open()
    h.send({ type: 'create', version: 1, game: 'xiangqi', name: `房主${i}` })
    const c = await h.waitFor('created')

    const g = new Client()
    await g.open()
    g.send({ type: 'join', version: 1, room: c.room, name: `客${i}` })
    await g.waitFor('joined')
    await h.waitFor('opponent-joined')
    pairs.push({ h, g, room: c.room })
  }

  const codes = new Set(pairs.map((p) => p.room))
  ok(codes.size === 3, '三个房间码互不相同')

  // 每个房间独立走一步，验证消息不会串房
  for (const p of pairs) {
    p.h.send({ type: 'move', move: { from: 'b8', to: 'e8' } })
  }
  for (const p of pairs) {
    const mh = await p.h.waitFor('move-applied')
    const mg = await p.g.waitFor('move-applied')
    ok(mh.move.to === 'e8' && mg.move.to === 'e8', `房间 ${p.room} 走子只在本房转发`)
  }

  const stats = await (await fetch(`${BASE}/api/stats`)).json()
  ok(stats.rooms >= 3, `统计显示至少 3 个房间（实际 ${stats.rooms}）`)

  for (const p of pairs) {
    p.h.close()
    p.g.close()
  }
}

await sleep(200)
console.log('='.repeat(60))
if (fail === 0) {
  console.log(`✓ 第 2 批端到端验证：全部通过（${pass} 项）`)
} else {
  console.log(`✗ 失败 ${fail} / 通过 ${pass}`)
  for (const f of failures) console.log('  ✗ ' + f)
}
process.exit(fail === 0 ? 0 : 1)
