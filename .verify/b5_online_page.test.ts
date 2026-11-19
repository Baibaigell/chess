/**
 * 回归测试：联机页「一闪而过」。
 *
 * 症状：点「联机对局」后能看到联机大厅，但立刻退回主大厅。
 *
 * 根因：App.tsx 里有个 effect 把「phase === 'lobby' && !gameId」当作
 * 「用户已离开房间」的信号，自动收起联机页。但 phase 的初始值就是
 * 'lobby'、gameId 初始为 null，所以点进去的瞬间条件就成立，立即被弹回。
 *
 * 本测试直接复刻 App 的渲染判定逻辑，验证各种状态下该显示哪一页。
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
  location: { protocol: 'http:', hostname: '127.0.0.1', port: '8080', pathname: '/' },
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

const ReactModule = await import('react')
const React = (ReactModule as unknown as { default?: unknown }).default ?? ReactModule
const r = React as unknown as Record<string, unknown>
r.useSyncExternalStore = (_s: unknown, getSnapshot: () => unknown) => getSnapshot()

const { renderToString } = await import('react-dom/server')
const { default: OnlineLobby } = await import('../src/ui/OnlineLobby')
const { useGameStore } = await import('../src/store/gameStore')
const { useOnlineStore } = await import('../src/store/onlineStore')

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
const h = React.createElement

/**
 * 复刻 App.tsx 的页面判定（改后的版本）。
 *
 * 返回 'online' | 'game' | 'lobby'。
 * 注意：这里刻意不包含「phase === 'lobby' 就自动收起」的逻辑，
 * 那正是被修掉的 bug。
 */
function whichPage(showOnline: boolean): 'online' | 'game' | 'lobby' {
  const gameId = useGameStore.getState().gameId
  const phase = useOnlineStore.getState().phase
  const inOnlineGame = showOnline && (phase === 'playing' || phase === 'finished')

  if (showOnline && !inOnlineGame) return 'online'
  if (gameId) return 'game'
  return 'lobby'
}

// ============================================================
// 核心用例：点进联机页必须留在联机页
// ============================================================

{
  // 初始状态：从未进过房间
  useOnlineStore.setState({ phase: 'lobby', room: null, conn: 'idle', error: null })
  useGameStore.setState({ gameId: null })

  ok(whichPage(false) === 'lobby', '未点联机时显示主大厅')

  // 点击「联机对局」→ showOnline = true
  // 关键断言：此时必须留在联机页，不能被弹回
  const page = whichPage(true)
  ok(page === 'online', `点联机后停在联机页（实际 ${page}）`)

  // 再确认一次：即使 phase 仍是初始值 'lobby'、gameId 仍为 null
  ok(useOnlineStore.getState().phase === 'lobby', '此时 phase 仍是初始值 lobby')
  ok(useGameStore.getState().gameId === null, '此时 gameId 仍为 null')
  ok(whichPage(true) === 'online', 'phase=lobby 且 gameId=null 时不会弹回主大厅')
}

// ============================================================
// 连接建立后仍在联机页
// ============================================================

{
  useOnlineStore.setState({ conn: 'open', phase: 'lobby' })
  ok(whichPage(true) === 'online', '连接成功后停在联机页')
}

// ============================================================
// 建房后停在等待页（能看到房间码）
// ============================================================

{
  useOnlineStore.setState({
    conn: 'open',
    phase: 'waiting',
    room: 'AB3D',
    side: 'first',
    game: 'gomoku',
    error: null,
  })
  useGameStore.getState().start('gomoku', 'first', 'human', 'medium', false)

  ok(useGameStore.getState().gameId === 'gomoku', '建房后 gameId 已有值')
  ok(whichPage(true) === 'online', '等待阶段停在联机页（房间码可见）')

  // 渲染出来确认房间码真的在
  const html = renderToString(h(OnlineLobby, { onBack: () => {} }) as never)
  ok(html.includes('AB3D'), '等待页渲染出房间码 AB3D')
  ok(html.includes('等待对手'), '等待页渲染出「等待对手」')
}

// ============================================================
// 对手加入后进入对局页
// ============================================================

{
  useOnlineStore.setState({ phase: 'playing', opponent: '小明', opponentOnline: true })
  ok(whichPage(true) === 'game', '对手加入后进入对局页')
}

// ============================================================
// 对局结束后仍留在对局页
// ============================================================

{
  useOnlineStore.setState({ phase: 'finished' })
  ok(whichPage(true) === 'game', '对局结束后仍在对局页')
}

// ============================================================
// 显式退出：leave() 清空状态并回到主大厅
// ============================================================

{
  useOnlineStore.setState({
    conn: 'open',
    phase: 'waiting',
    room: 'XY9Z',
    side: 'first',
    game: 'gomoku',
    opponent: '小明',
  })
  useGameStore.getState().start('gomoku', 'first', 'human', 'medium', false)

  // 复刻 App.exitOnline()：先 leave 再 setShowOnline(false)
  useOnlineStore.getState().leave()
  const showOnline = false

  const st = useOnlineStore.getState()
  ok(st.phase === 'lobby', 'leave() 后 phase 回到 lobby')
  ok(st.room === null, 'leave() 后房间号清空')
  ok(st.game === null, 'leave() 后棋种清空')
  ok(useGameStore.getState().gameId === null, 'leave() 后 gameId 清空')
  ok(whichPage(showOnline) === 'lobby', '退出后回到主大厅')
}

// ============================================================
// 刷新后凭据自动进联机页
// ============================================================

{
  // 无凭据：不该自动进联机页
  store.clear()
  useOnlineStore.setState({ phase: 'lobby', room: null })
  useGameStore.setState({ gameId: null })

  const { OnlineClient } = await import('../src/net/client')
  ok(OnlineClient.loadCredential() === null, '无凭据时 loadCredential 返回 null')

  // 有凭据：应自动进联机页
  store.set('chess-app.online.cred', JSON.stringify({ room: 'QWER', token: 'abc123' }))
  const cred = OnlineClient.loadCredential()
  ok(cred !== null && cred.room === 'QWER', '有凭据时能读出房间号')
  ok(whichPage(true) === 'online', '刷新后有凭据则停在联机页')
}

// ============================================================
// 三种棋的联机大厅都能渲染
// ============================================================

{
  store.clear()
  useOnlineStore.setState({ conn: 'open', phase: 'lobby', room: null, error: null })
  const html = renderToString(h(OnlineLobby, { onBack: () => {} }) as never)
  ok(html.includes('创建房间'), '联机大厅有创建房间')
  ok(html.includes('加入房间'), '联机大厅有加入房间')
  ok(html.includes('国际象棋'), '联机大厅可选国际象棋')
  ok(html.includes('中国象棋'), '联机大厅可选中国象棋')
  ok(html.includes('五子棋'), '联机大厅可选五子棋')
  ok(!html.includes('undefined'), '联机大厅无 undefined')
}

// ---------- 输出 ----------
console.log('='.repeat(60))
if (fail === 0) {
  console.log(`✓ 联机页回归测试：全部通过（${pass} 项）`)
} else {
  console.log(`✗ 失败 ${fail} / 通过 ${pass}`)
  for (const f of failures) console.log('  ✗ ' + f)
}
process.exit(fail === 0 ? 0 : 1)
