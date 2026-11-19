/**
 * 第 3 批界面渲染验证：不依赖浏览器。
 *
 * 用 react-dom/server 把组件树渲染成 HTML 字符串。
 * 这能抓到真实运行时才会暴露的错误：组件抛异常、Hook 用法错误、
 * 引用了浏览器才有的全局变量等。
 *
 * 需要先把 window / document / localStorage 等全局桩好，
 * 因为 store 和 net 模块在模块顶层就会读它们。
 */

// ---------- 浏览器全局桩 ----------
const store = new Map<string, string>()

const localStorageStub = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
}

const g = globalThis as unknown as Record<string, unknown>
g.window = {
  location: { protocol: 'http:', hostname: 'localhost', port: '8080', pathname: '/' },
  addEventListener: () => {},
  localStorage: localStorageStub,
  sessionStorage: localStorageStub,
}
g.localStorage = localStorageStub
g.sessionStorage = localStorageStub
g.document = {
  getElementById: () => null,
  createElement: () => ({ style: {}, setAttribute: () => {}, appendChild: () => {} }),
  head: { appendChild: () => {} },
  body: { appendChild: () => {} },
  addEventListener: () => {},
}
// navigator 在 Node 里是只读 getter，用 defineProperty 覆盖
try {
  Object.defineProperty(g, 'navigator', {
    value: { serviceWorker: undefined, userAgent: 'node' },
    configurable: true,
    writable: true,
  })
} catch {
  /* 部分 Node 版本不允许覆盖，忽略：代码里对 navigator 的访问都有存在性判断 */
}
g.location = (g.window as Record<string, unknown>).location
// requestAnimationFrame 由 chessground 在挂载时用，服务端渲染不会走到
g.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(0), 0)
g.cancelAnimationFrame = (id: number) => clearTimeout(id)

// ---------- 导入被测组件 ----------
const ReactModule = await import('react')
const React = (ReactModule as unknown as { default?: unknown }).default ?? ReactModule

/**
 * 让 zustand 在服务端渲染时读取「实时 state」而不是初始快照。
 *
 * zustand v5 的 hook 走 useSyncExternalStore 的第三个参数（getServerSnapshot），
 * 而它返回的是 getInitialState()。本测试需要在渲染前改 state，
 * 因此把 useSyncExternalStore 换成「直接读 getState」的实现。
 * 只影响这个测试进程，不进入产品代码。
 */
const r = React as unknown as Record<string, unknown>
r.useSyncExternalStore = (
  _subscribe: unknown,
  getSnapshot: () => unknown,
): unknown => getSnapshot()

const { renderToString } = await import('react-dom/server')
const { default: Lobby } = await import('../src/ui/Lobby')
const { default: OnlineLobby } = await import('../src/ui/OnlineLobby')
const { default: App } = await import('../src/App')
const { default: GameScreen } = await import('../src/ui/GameScreen')
const { useGameStore } = await import('../src/store/gameStore')
const { useOnlineStore } = await import('../src/store/onlineStore')
const { getAll } = await import('../src/core/registry')
const { FORBIDDEN_TEXT } = await import('../src/games/gomoku/forbidden')

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

/** 渲染并返回 HTML，异常视为失败 */
function render(el: unknown, label: string): string {
  try {
    return renderToString(el as never)
  } catch (e) {
    fail++
    failures.push(`${label}：渲染抛异常 ${String(e).slice(0, 200)}`)
    return ''
  }
}

const h = React.createElement

// ---------- 1. 大厅 ----------
{
  const html = render(h(Lobby, { onOnline: () => {} }), '大厅')
  ok(html.includes('选择棋种'), '大厅渲染出标题')
  ok(html.includes('国际象棋'), '大厅列出国际象棋')
  ok(html.includes('中国象棋'), '大厅列出中国象棋')
  ok(html.includes('五子棋'), '大厅列出五子棋')
  ok(html.includes('双人对下'), '大厅有双人选项')
  ok(html.includes('与电脑对下'), '大厅有人机选项')
  ok(html.includes('联机对局'), '大厅有联机入口')
  ok(html.includes('禁手'), '大厅有五子棋禁手开关')
  ok(!html.includes('undefined'), '大厅无 undefined 字样')
  ok(!html.includes('NaN'), '大厅无 NaN')
}

// ---------- 2. 联机大厅 ----------
{
  useOnlineStore.setState({ conn: 'open', phase: 'lobby', error: null })
  const html = render(h(OnlineLobby, { onBack: () => {} }), '联机大厅')
  ok(html.includes('创建房间'), '联机大厅有创建房间')
  ok(html.includes('加入房间'), '联机大厅有加入房间')
  ok(html.includes('你的昵称'), '联机大厅有昵称输入')
  ok(html.includes('已连接'), '联机大厅显示连接状态')
  ok(!html.includes('undefined'), '联机大厅无 undefined')
}

// ---------- 3. 联机等待页 ----------
{
  useOnlineStore.setState({
    conn: 'open',
    phase: 'waiting',
    room: 'AB3D',
    game: 'gomoku',
    forbidden: true,
    error: null,
  })
  const html = render(h(OnlineLobby, { onBack: () => {} }), '等待对手')
  ok(html.includes('AB3D'), '等待页显示房间码')
  ok(html.includes('等待对手'), '等待页显示标题')
  ok(html.includes('禁手'), '等待页显示禁手状态')
}

// ---------- 4. 三种棋的对局页 ----------
for (const g2 of getAll()) {
  const id = g2.meta.id
  // 重置为本地双人
  useOnlineStore.setState({ phase: 'lobby' })
  useGameStore.getState().start(id, 'both', 'human', 'medium', false)
  const html = render(h(App), `对局页 ${id}`)
  ok(html.length > 0, `对局页 ${id} 渲染成功`)
  ok(html.includes(g2.meta.name), `对局页 ${id} 显示棋种名`)
  ok(html.includes('返回大厅'), `对局页 ${id} 有返回按钮`)
  ok(html.includes('认输'), `对局页 ${id} 有认输按钮`)
  ok(!html.includes('undefined'), `对局页 ${id} 无 undefined`)

  // 网格棋盘应有格子
  if (g2.meta.renderer === 'grid') {
    ok(html.includes('grid-board'), `对局页 ${id} 渲染网格棋盘`)
  }
}

// ---------- 5. 人机模式显示 AI 信息 ----------
{
  useGameStore.getState().start('gomoku', 'second', 'ai', 'hard', false)
  const html = render(h(App), '对局页 人机')
  ok(html.includes('电脑'), '人机模式显示电脑对手')
  ok(html.includes('困难') || html.includes('高') || html.includes('强'), '人机模式显示难度')
}

// ---------- 6. 五子棋禁手提示 ----------
{
  useGameStore.getState().start('gomoku', 'both', 'human', 'medium', true)
  const html = render(h(App), '对局页 禁手')
  ok(html.includes('禁手'), '开启禁手时显示规则提示')
  for (const text of Object.values(FORBIDDEN_TEXT)) {
    ok(html.includes(text), `禁手提示包含「${text}」`)
  }
}

// ---------- 7. 联机对局面板 ----------
{
  useOnlineStore.setState({
    conn: 'open',
    phase: 'playing',
    room: 'XY9Z',
    side: 'second',
    game: 'xiangqi',
    forbidden: false,
    opponent: '小明',
    opponentOnline: true,
    chat: [
      { from: '系统', text: '小明 加入了房间', system: true, at: 1 },
      { from: '小明', text: '你好', system: false, at: 2 },
    ],
    pendingOffer: 'draw',
    offerSent: null,
    error: null,
  })
  useGameStore.getState().start('xiangqi', 'second', 'human', 'medium', false)
  // 直接渲染 GameScreen 并显式传 online：
  // App 里的 showOnline 是组件内部状态，外部无法置位
  const html = render(h(GameScreen, { online: true }), '对局页 联机')
  ok(html.includes('XY9Z'), '联机对局显示房间码')
  ok(html.includes('小明'), '联机对局显示对手昵称')
  ok(html.includes('你好'), '联机对局显示聊天记录')
  ok(html.includes('和棋'), '联机对局显示和棋提议')
  ok(html.includes('同意'), '联机对局显示同意按钮')
  ok(html.includes('离开房间'), '联机对局显示离开按钮')
  ok(!html.includes('电脑'), '联机对局不显示电脑对手')
  ok(html.includes('后行方'), '联机对局显示自己阵营')
}

// ---------- 8. 联机对局结束 ----------
{
  useOnlineStore.setState({ phase: 'finished', pendingOffer: null })
  const html = render(h(GameScreen, { online: true }), '对局页 联机结束')
  ok(html.length > 0, '联机结束态渲染成功')
  ok(html.includes('对局已结束') || html.includes('对局结束'), '联机结束态显示结束提示')
}

// ---------- 输出 ----------
console.log('='.repeat(60))
if (fail === 0) {
  console.log(`✓ 第 3 批界面渲染验证：全部通过（${pass} 项）`)
} else {
  console.log(`✗ 失败 ${fail} / 通过 ${pass}`)
  for (const f of failures) console.log('  ✗ ' + f)
}
process.exit(fail === 0 ? 0 : 1)
