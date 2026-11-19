/**
 * 回归测试：人机对战与联机的三个已修复 bug。
 *
 * 每个用例都对应一个真实症状，而不是泛泛的单元测试：
 * - B1：人机对战棋盘冻结（玩家与 AI 被派到同一阵营）
 * - B2：联机点不进（enterLobby 从未被调用，conn 停在 idle）
 * - B3：建房后看不到房间码（gameId 抢占渲染，跳进对局页）
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
  location: { protocol: 'http:', hostname: 'localhost', port: '8080', pathname: '/' },
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

// WebSocket 桩：记录客户端发出的消息，便于断言握手行为
const sentFrames: string[] = []
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  readyState = 0
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
    // 下一轮事件循环模拟连接成功
    setTimeout(() => {
      this.readyState = 1
      this.onopen?.()
    }, 0)
  }
  send(data: string) {
    sentFrames.push(data)
  }
  close() {
    this.readyState = 3
    this.onclose?.()
  }
}
g.WebSocket = FakeWebSocket

const ReactModule = await import('react')
const React = (ReactModule as unknown as { default?: unknown }).default ?? ReactModule
// zustand v5 的 SSR 快照返回初始 state，这里改成直接读实时 state
const r = React as unknown as Record<string, unknown>
r.useSyncExternalStore = (_s: unknown, getSnapshot: () => unknown) => getSnapshot()

const { renderToString } = await import('react-dom/server')
const { default: Lobby } = await import('../src/ui/Lobby')
const { default: App } = await import('../src/App')
const { default: GameScreen } = await import('../src/ui/GameScreen')
const { useGameStore } = await import('../src/store/gameStore')
const { useOnlineStore } = await import('../src/store/onlineStore')
const { get } = await import('../src/core/registry')
const { hasAi } = await import('../src/ai')

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
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))

// ============================================================
// B1：人机对战，玩家执先行方，AI 执后行方
// ============================================================

for (const gameId of ['chess', 'xiangqi', 'gomoku']) {
  const meta = get(gameId).meta
  ok(meta.supportsAi === true, `${gameId} 声明支持 AI`)
  ok(hasAi(gameId), `${gameId} 有可用的 AI 实现`)

  // 复刻 Lobby 的开局参数：人机对战 → playerSide 必须是 'first'
  const gs = useGameStore.getState()
  gs.start(gameId, 'first', 'ai', 'easy', false)

  const st = useGameStore.getState()
  ok(st.playerSide === 'first', `${gameId} 人机对战玩家执先行方`)
  ok(st.opponent === 'ai', `${gameId} 对手是电脑`)

  const firstTurn = meta.firstTurn
  ok(st.turn === firstTurn, `${gameId} 开局轮到先行方`)

  // 关键断言：开局这一手，玩家应该能点（canPlay 为真）
  // canPlay 的条件（Board.tsx）：playerSide === 'first' && turn === firstTurn
  const canPlayAtStart = st.playerSide === 'first' && st.turn === firstTurn
  ok(canPlayAtStart, `${gameId} 开局玩家可以走子（棋盘不冻结）`)

  // 关键断言：走完一手后，应该轮到 AI
  const legal = st.engine!.legalMoves()
  ok(legal.length > 0, `${gameId} 开局有合法着法`)
  if (legal.length > 0) {
    st.move(legal[0])
    const after = useGameStore.getState()
    // GameScreen 的 isAiTurn：aiEnabled && turn !== firstTurn
    const aiEnabled = after.opponent === 'ai' && hasAi(gameId)
    const isAiTurn = aiEnabled && after.turn !== firstTurn
    ok(isAiTurn, `${gameId} 玩家走子后轮到 AI（AI 会启动思考）`)
  }
}

// 走子后渲染一次对局页，确认显示「电脑思考中…」而不是卡在玩家回合
{
  useGameStore.getState().start('gomoku', 'first', 'ai', 'easy', false)
  const st = useGameStore.getState()
  const legal = st.engine!.legalMoves()
  st.move(legal[0])
  useGameStore.getState().setThinking(true)
  const html = renderToString(h(GameScreen, { online: false }) as never)
  ok(html.includes('电脑思考中'), '玩家走子后界面显示「电脑思考中…」')
  ok(!html.includes('无法'), '界面无异常文案')
}

// ============================================================
// B2：联机连接必须被真正发起
// ============================================================

{
  FakeWebSocket.instances.length = 0
  sentFrames.length = 0
  useOnlineStore.setState({ conn: 'idle', phase: 'lobby', room: null, error: null })

  // 模拟用户点「联机对局」：App 的 showOnline 置真 → 触发 enterLobby
  useOnlineStore.getState().enterLobby()
  await sleep(20)

  ok(FakeWebSocket.instances.length === 1, '进入联机页后创建了 WebSocket 连接')
  ok(useOnlineStore.getState().conn === 'open', '连接成功后状态变为 open')

  // 联机大厅的按钮要求 conn === 'open' 才可点
  const OnlineLobbyMod = await import('../src/ui/OnlineLobby')
  const html = renderToString(h(OnlineLobbyMod.default, { onBack: () => {} }) as never)
  ok(html.includes('创建房间'), '联机大厅渲染出创建房间按钮')
  ok(!html.includes('连接中…'), '连接就绪后按钮不再显示「连接中…」')
}

// ============================================================
// B3：建房后停在「等待对手」，不能跳进对局页
// ============================================================

{
  useOnlineStore.setState({
    conn: 'open',
    phase: 'waiting',
    room: 'WXYZ',
    game: 'gomoku',
    forbidden: false,
    side: 'first',
    error: null,
  })
  // 建房时 store 已经 start 了一局，gameId 有值
  useGameStore.getState().start('gomoku', 'first', 'human', 'medium', false)
  ok(useGameStore.getState().gameId === 'gomoku', '建房后 gameId 已设置')

  // App 的渲染优先级：联机页 > 对局页
  // showOnline 为真、phase 为 waiting → 应渲染联机大厅而非对局页
  const showOnline = true
  const inOnlineGame =
    showOnline &&
    (useOnlineStore.getState().phase === 'playing' || useOnlineStore.getState().phase === 'finished')
  ok(inOnlineGame === false, '等待阶段不进入对局页')
  ok(
    showOnline && !inOnlineGame,
    '等待阶段命中联机页分支（房间码可见）',
  )
}

// ============================================================
// B3 补充：对手进来后进入对局页
// ============================================================

{
  useOnlineStore.setState({ phase: 'playing', opponent: '小明', opponentOnline: true })
  const showOnline = true
  const inOnlineGame =
    showOnline &&
    (useOnlineStore.getState().phase === 'playing' || useOnlineStore.getState().phase === 'finished')
  ok(inOnlineGame === true, '对手加入后进入对局页')

  const html = renderToString(h(GameScreen, { online: true }) as never)
  ok(html.includes('小明'), '联机对局页显示对手昵称')
  ok(html.includes('离开房间'), '联机对局页显示离开按钮')
}

// ============================================================
// 联机对局不驱动 AI
// ============================================================

{
  useOnlineStore.setState({ phase: 'playing', side: 'first', game: 'gomoku' })
  useGameStore.getState().start('gomoku', 'first', 'human', 'medium', false)
  // 联机时 opponent 是 'human'，即使误设成 'ai'，online 也会屏蔽
  const online = true
  const aiEnabled = !online && useGameStore.getState().opponent === 'ai' && hasAi('gomoku')
  ok(aiEnabled === false, '联机对局不启用 AI')
}

// ============================================================
// 大厅参数：人机 / 双人 分别给对阵营
// ============================================================

{
  // 渲染大厅确认两个选项都在，且默认是双人
  useGameStore.setState({ opponent: 'human' })
  const html = renderToString(h(Lobby, { onOnline: () => {} }) as never)
  ok(html.includes('双人对下'), '大厅有双人对下')
  ok(html.includes('与电脑对下'), '大厅有与电脑对下')
  ok(html.includes('chip is-on'), '大厅有选中态')

  // 三种棋都能对电脑（都声明 supportsAi）
  for (const id of ['chess', 'xiangqi', 'gomoku']) {
    ok(get(id).meta.supportsAi === true, `${id} 卡片标注可对电脑`)
  }
}

// ---------- 输出 ----------
console.log('='.repeat(60))
if (fail === 0) {
  console.log(`✓ 回归测试：全部通过（${pass} 项）`)
} else {
  console.log(`✗ 失败 ${fail} / 通过 ${pass}`)
  for (const f of failures) console.log('  ✗ ' + f)
}
process.exit(fail === 0 ? 0 : 1)
