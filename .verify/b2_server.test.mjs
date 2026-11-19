/**
 * 第 2 批自测：联机服务端。
 *
 * 沙箱禁止 spawn，因此不启动子进程，而是在同一进程内 require 服务端
 * （它自己 listen），再用 Node 内置的全局 WebSocket 客户端连接。
 *
 * 覆盖：
 * - HTTP 健康检查与静态回退
 * - 建房、进房、房间码校验
 * - 走子转发与回合校验
 * - 认输、和棋提议与回应
 * - 悔棋提议与回应
 * - 聊天转发
 * - 断线与重连
 */
import { setTimeout as sleep } from 'node:timers/promises'

// 服务端监听 8099，避免与开发端口冲突
process.env.PORT = '8099'
process.env.STATIC_ROOT = 'dist'

// 直接引入服务端模块，它会自行 listen
await import('../server/server.js')

const BASE = 'http://127.0.0.1:8099'
const WS_URL = 'ws://127.0.0.1:8099'

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

/** 等 HTTP 服务就绪 */
async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`)
      if (res.ok) return
    } catch {
      /* 还没起来 */
    }
    await sleep(100)
  }
  throw new Error('服务端未就绪')
}

/** 一个测试用的 WebSocket 客户端，带消息队列便于 await */
class TestClient {
  constructor() {
    this.messages = []
    this.closed = false
    this.ws = new WebSocket(WS_URL)
    this.ws.onmessage = (ev) => {
      try {
        this.messages.push(JSON.parse(String(ev.data)))
      } catch {
        /* 忽略非 JSON */
      }
    }
    this.ws.onclose = () => {
      this.closed = true
    }
  }

  async open() {
    if (this.ws.readyState === 1) return
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('连接超时')), 3000)
      this.ws.onopen = () => {
        clearTimeout(t)
        resolve()
      }
    })
  }

  send(obj) {
    this.ws.send(JSON.stringify(obj))
  }

  /** 等待某类型的消息，超时抛错 */
  async waitFor(type, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const idx = this.messages.findIndex((m) => m.type === type)
      if (idx >= 0) return this.messages.splice(idx, 1)[0]
      await sleep(20)
    }
    throw new Error(
      `等待消息 ${type} 超时；已收到: ${this.messages.map((m) => m.type).join(',')}`,
    )
  }

  clear() {
    this.messages = []
  }

  close() {
    try {
      this.ws.close()
    } catch {
      /* 已关闭 */
    }
  }
}

// ==================== 开始 ====================

await waitForServer()

// ---- HTTP ----
{
  const res = await fetch(`${BASE}/api/health`)
  const body = await res.json()
  ok(res.ok && body.ok === true, 'HTTP 健康检查返回 ok')
  ok(typeof body.rooms === 'number', '健康检查返回房间数')

  const stats = await (await fetch(`${BASE}/api/stats`)).json()
  ok(typeof stats.players === 'number', '统计接口返回在线玩家数')

  const r2 = await fetch(`${BASE}/some/unknown/path`)
  const text = await r2.text()
  ok(
    r2.status === 200 || text.includes('dist/index.html'),
    'SPA 回退：未知路径返回 index.html 或明确提示',
  )
}

// ---- 建房 ----
const a = new TestClient()
await a.open()
a.send({ type: 'create', version: 1, game: 'gomoku', name: '甲', forbidden: true })
const created = await a.waitFor('created')
ok(typeof created.room === 'string' && created.room.length === 4, `房间码为 4 位（${created.room}）`)
ok(created.side === 'first', '建房者执先行方')
ok(created.game === 'gomoku', '建房棋种正确')
ok(created.forbidden === true, '禁手选项透传')
ok(typeof created.token === 'string' && created.token.length > 10, '下发重连令牌')

const roomCode = created.room

// ---- 进房 ----
const b = new TestClient()
await b.open()
b.send({ type: 'join', version: 1, room: roomCode, name: '乙' })
const joined = await b.waitFor('joined')
ok(joined.side === 'second', '加入者执后行方')
ok(joined.opponent === '甲', '加入者看到对手昵称')
ok(joined.game === 'gomoku', '加入者获知棋种')
ok(joined.forbidden === true, '加入者获知禁手设置')

const oppJoined = await a.waitFor('opponent-joined')
ok(oppJoined.name === '乙', '房主收到对手加入通知')

// ---- 房间不存在 ----
{
  const c = new TestClient()
  await c.open()
  c.send({ type: 'join', version: 1, room: 'ZZZZ', name: '丙' })
  const err = await c.waitFor('error')
  ok(err.code === 'room-not-found', `不存在的房间报错（得到 ${err.code}）`)
  c.close()
}

// ---- 版本不匹配 ----
{
  const c = new TestClient()
  await c.open()
  c.send({ type: 'create', version: 99, game: 'chess', name: '丁' })
  const err = await c.waitFor('error')
  ok(err.code === 'version-mismatch', `版本不匹配被拒（得到 ${err.code}）`)
  c.close()
}

// ---- 走子转发与回合校验 ----
a.clear()
b.clear()

b.send({ type: 'move', move: { from: 'h8', to: 'h8' } })
{
  const err = await b.waitFor('error')
  ok(err.code === 'not-your-turn', `未轮到走子被拒（得到 ${err.code}）`)
}

a.send({ type: 'move', move: { from: 'h8', to: 'h8' } })
const moveA = await a.waitFor('move-applied')
const moveB = await b.waitFor('move-applied')
ok(moveA.move.from === 'h8' && moveA.move.to === 'h8', '走子转发给发起方')
ok(moveB.move.to === 'h8', '走子转发给对手')

b.send({ type: 'move', move: { from: 'i8', to: 'i8' } })
await a.waitFor('move-applied')
await b.waitFor('move-applied')
ok(true, '回合翻转后对手可走子')

a.clear()
a.send({ type: 'move', move: { from: 'zz', to: 'h8' } })
{
  const err = await a.waitFor('error')
  ok(err.code === 'bad-message', `非法坐标被拒（得到 ${err.code}）`)
}

// ---- 聊天 ----
a.clear()
b.clear()
a.send({ type: 'chat', text: '你好' })
const chatA = await a.waitFor('chat')
const chatB = await b.waitFor('chat')
ok(chatA.text === '你好' && chatB.text === '你好', '聊天双方都收到')
ok(chatA.from === '甲', '聊天带发送者昵称')

// ---- 和棋提议 ----
a.clear()
b.clear()
a.send({ type: 'draw-offer' })
const drawOffered = await b.waitFor('draw-offered')
ok(drawOffered.type === 'draw-offered', '对手收到和棋提议')

b.send({ type: 'draw-reply', accept: false })
const drawResolved = await a.waitFor('draw-resolved')
ok(drawResolved.accepted === false, '拒绝和棋的回应被转发')

a.clear()
b.clear()
a.send({ type: 'draw-offer' })
await b.waitFor('draw-offered')
b.send({ type: 'draw-reply', accept: true })
const resolved2 = await a.waitFor('draw-resolved')
const over2 = await a.waitFor('game-over')
ok(resolved2.accepted === true, '同意和棋的回应被转发')
ok(over2.winner === null && over2.reason === 'draw-agreed', '和棋结束对局')

// ---- 对局已结束后再走子 ----
a.clear()
a.send({ type: 'move', move: { from: 'a1', to: 'a1' } })
{
  const err = await a.waitFor('error')
  ok(err.code === 'game-over', `结束后走子被拒（得到 ${err.code}）`)
}

a.close()
b.close()

// ---- 悔棋流程（新房间） ----
{
  const c1 = new TestClient()
  await c1.open()
  c1.send({ type: 'create', version: 1, game: 'xiangqi', name: '红' })
  const r1 = await c1.waitFor('created')

  const c2 = new TestClient()
  await c2.open()
  c2.send({ type: 'join', version: 1, room: r1.room, name: '黑' })
  await c2.waitFor('joined')
  await c1.waitFor('opponent-joined')

  c1.send({ type: 'move', move: { from: 'b8', to: 'e8' } })
  await c1.waitFor('move-applied')
  await c2.waitFor('move-applied')

  c1.clear()
  c2.clear()
  c1.send({ type: 'undo-offer' })
  const offered = await c2.waitFor('undo-offered')
  ok(offered.type === 'undo-offered', '对手收到悔棋提议')

  c2.send({ type: 'undo-reply', accept: true })
  const undoResolved = await c1.waitFor('undo-resolved')
  ok(undoResolved.accepted === true, '同意悔棋的回应被转发')

  c1.clear()
  c1.send({ type: 'move', move: { from: 'h3', to: 'h4' } })
  const afterUndo = await Promise.race([
    c1.waitFor('move-applied').then(() => 'ok'),
    c1.waitFor('error').then((e) => e.code),
  ])
  ok(afterUndo === 'ok', `悔棋后轮到提议方（得到 ${afterUndo}）`)

  c1.close()
  c2.close()
}

// ---- 认输 ----
{
  const c1 = new TestClient()
  await c1.open()
  c1.send({ type: 'create', version: 1, game: 'chess', name: '白' })
  const r1 = await c1.waitFor('created')

  const c2 = new TestClient()
  await c2.open()
  c2.send({ type: 'join', version: 1, room: r1.room, name: '黑' })
  await c2.waitFor('joined')
  await c1.waitFor('opponent-joined')

  c1.clear()
  c2.clear()
  c2.send({ type: 'resign' })
  const over = await c1.waitFor('game-over')
  ok(over.winner === 'first' && over.reason === 'resign', '认输后对手获胜')

  c1.close()
  c2.close()
}

// ---- 断线与重连 ----
{
  const c1 = new TestClient()
  await c1.open()
  c1.send({ type: 'create', version: 1, game: 'gomoku', name: '甲' })
  const r1 = await c1.waitFor('created')
  const token1 = r1.token

  const c2 = new TestClient()
  await c2.open()
  c2.send({ type: 'join', version: 1, room: r1.room, name: '乙' })
  await c2.waitFor('joined')
  await c1.waitFor('opponent-joined')

  c2.clear()
  c1.close()
  const left = await c2.waitFor('opponent-left')
  ok(left.temporary === true, '对手断线通知为临时')

  const c1b = new TestClient()
  await c1b.open()
  c1b.send({ type: 'reconnect', version: 1, room: r1.room, token: token1 })
  const rejoined = await c1b.waitFor('joined')
  ok(rejoined.side === 'first', '重连恢复原阵营')

  const online = await c2.waitFor('opponent-online')
  ok(online.type === 'opponent-online', '对手收到重连通知')

  c1b.clear()
  c2.clear()
  c1b.send({ type: 'move', move: { from: 'h8', to: 'h8' } })
  const mv = await c1b.waitFor('move-applied')
  ok(mv.move.to === 'h8', '重连后可继续走子')

  c1b.close()
  c2.close()
}

// ---- 无效令牌 ----
{
  const c = new TestClient()
  await c.open()
  c.send({ type: 'reconnect', version: 1, room: 'ZZZZ', token: 'deadbeef' })
  const err = await c.waitFor('error')
  ok(err.code === 'room-not-found', `无效房间的重连被拒（得到 ${err.code}）`)
  c.close()
}

// ---- 房间满 ----
{
  const c1 = new TestClient()
  await c1.open()
  c1.send({ type: 'create', version: 1, game: 'gomoku', name: '甲' })
  const r1 = await c1.waitFor('created')

  const c2 = new TestClient()
  await c2.open()
  c2.send({ type: 'join', version: 1, room: r1.room, name: '乙' })
  await c2.waitFor('joined')
  await c1.waitFor('opponent-joined')

  const c3 = new TestClient()
  await c3.open()
  c3.send({ type: 'join', version: 1, room: r1.room, name: '丙' })
  const err = await c3.waitFor('error')
  ok(err.code === 'room-full', `第三人进房被拒（得到 ${err.code}）`)

  c1.close()
  c2.close()
  c3.close()
}

// ---- 输出 ----
await sleep(200)
console.log('='.repeat(60))
if (fail === 0) {
  console.log(`✓ 第 2 批服务端自测：全部通过（${pass} 项）`)
} else {
  console.log(`✗ 失败 ${fail} / 通过 ${pass}`)
  for (const f of failures) console.log('  ✗ ' + f)
  process.exitCode = 1
}
process.exit(fail === 0 ? 0 : 1)
