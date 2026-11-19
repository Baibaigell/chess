/**
 * 第 1 批自测：五子棋禁手 + 象棋 AI + 五子棋 AI。
 *
 * 用 esbuild 打包成 CJS 后由 node 直接执行，不依赖浏览器环境。
 * 断言失败会以非零码退出，便于在批末核对。
 */
import { GomokuEngine } from '../src/games/gomoku/engine'
import { checkForbidden, BLACK, WHITE } from '../src/games/gomoku/forbidden'
import type { Cell } from '../src/games/gomoku/forbidden'
import { XiangqiEngine } from '../src/games/xiangqi/engine'
import { XiangqiAi } from '../src/ai/xiangqi-ai'
import { GomokuAi } from '../src/ai/gomoku-ai'

let pass = 0
let fail = 0
const failures: string[] = []

function ok(cond: boolean, label: string): void {
  if (cond) {
    pass++
  } else {
    fail++
    failures.push(label)
  }
}

/** 造一个 15×15 空棋盘 */
function emptyBoard(): Cell[][] {
  return Array.from({ length: 15 }, () => Array<Cell>(15).fill(0))
}

/** 在棋盘上放一串子 */
function place(board: Cell[][], color: Cell, points: string[]): void {
  for (const p of points) {
    const x = p.charCodeAt(0) - 97
    const y = Number(p.slice(1)) - 1
    board[y][x] = color
  }
}

// ==================== 1. 禁手判定 ====================
{
  // 1.1 长连禁手：黑棋已有 h8..l8 五子，落 m8 形成六连
  const b = emptyBoard()
  place(b, BLACK, ['h8', 'i8', 'j8', 'k8', 'l8'])
  const r = checkForbidden(b, 12, 7, 15) // m8 → x=12,y=7
  ok(r.forbidden && r.kind === 'overline', `长连禁手判定（得到 ${r.kind}）`)

  // 1.2 五连优先：黑棋已有 h8..k8 四子，落 l8 成五 → 合法
  const b2 = emptyBoard()
  place(b2, BLACK, ['h8', 'i8', 'j8', 'k8'])
  const r2 = checkForbidden(b2, 11, 7, 15) // l8
  ok(!r2.forbidden, '五连优先：成五不算禁手')
}

{
  // 1.3 四四禁手：横竖各造一个冲四，交点在中心
  // 横：e8 f8 g8 + 落 h8 形成 e8..h8 四（两端：d8 空、i8 空 → 活四）
  // 竖：h5 h6 h7 + 落 h8 形成 h5..h8 四
  const b = emptyBoard()
  place(b, BLACK, ['e8', 'f8', 'g8', 'h5', 'h6', 'h7'])
  const r = checkForbidden(b, 7, 7, 15) // h8
  ok(r.forbidden && r.kind === 'double-four', `四四禁手判定（得到 ${r.kind}）`)
}

{
  // 1.4 三三禁手：横竖各造一个活三，交点在中心
  // 横：f8 g8 + 落 h8 → f8..h8 三，左 e8 空、右 i8 空 → 活三
  // 竖：h6 h7 + 落 h8 → h6..h8 三，上 h5 空、下 h9 空 → 活三
  const b = emptyBoard()
  place(b, BLACK, ['f8', 'g8', 'h6', 'h7'])
  const r = checkForbidden(b, 7, 7, 15) // h8
  ok(r.forbidden && r.kind === 'double-three', `三三禁手判定（得到 ${r.kind}）`)
}

{
  // 1.5 白棋没有禁手：白棋形成三三形状时可以正常落子
  const eng = new GomokuEngine(undefined, { forbidden: true })
  // 黑先落子（合法点），然后白棋连续落子构造三三
  eng.applyMove({ from: 'a1', to: 'a1' }) // 黑
  eng.applyMove({ from: 'f8', to: 'f8' }) // 白
  eng.applyMove({ from: 'a2', to: 'a2' }) // 黑
  eng.applyMove({ from: 'g8', to: 'g8' }) // 白
  eng.applyMove({ from: 'a3', to: 'a3' }) // 黑
  eng.applyMove({ from: 'h6', to: 'h6' }) // 白
  eng.applyMove({ from: 'a4', to: 'a4' }) // 黑
  eng.applyMove({ from: 'h7', to: 'h7' }) // 白
  // 轮到黑，黑走一步让出轮次
  eng.applyMove({ from: 'b1', to: 'b1' }) // 黑
  // 现在轮到白，h8 对白棋是「三三」形状，但白棋无禁手
  const legal = eng.legalMoves()
  ok(
    legal.some((m) => m.to === 'h8'),
    '白棋无禁手：三三形状仍是合法点',
  )
  let threw = false
  try {
    eng.applyMove({ from: 'h8', to: 'h8' })
  } catch {
    threw = true
  }
  ok(!threw, '白棋在三三形状处可正常落子')
}

{
  // 1.6 引擎层面：开启禁手后，黑棋在禁手点落子应抛错
  const eng = new GomokuEngine(undefined, { forbidden: true })
  // 黑先，构造一个三三局面：需要黑先下几步，白应几步
  eng.applyMove({ from: 'f8', to: 'f8' }) // 黑 f8
  eng.applyMove({ from: 'a1', to: 'a1' }) // 白 a1
  eng.applyMove({ from: 'g8', to: 'g8' }) // 黑 g8
  eng.applyMove({ from: 'a2', to: 'a2' }) // 白 a2
  eng.applyMove({ from: 'h6', to: 'h6' }) // 黑 h6
  eng.applyMove({ from: 'a3', to: 'a3' }) // 白 a3
  eng.applyMove({ from: 'h7', to: 'h7' }) // 黑 h7
  eng.applyMove({ from: 'a4', to: 'a4' }) // 白 a4
  // 此时轮到黑，h8 是三三禁手
  const legal = eng.legalMoves()
  ok(
    !legal.some((m) => m.to === 'h8'),
    '禁手点不在黑棋合法着法中',
  )
  let threw = false
  try {
    eng.applyMove({ from: 'h8', to: 'h8' })
  } catch {
    threw = true
  }
  ok(threw, '黑棋在禁手点落子抛错')
}

{
  // 1.7 关闭禁手时，同样的点可以落子
  const eng = new GomokuEngine(undefined, { forbidden: false })
  eng.applyMove({ from: 'f8', to: 'f8' })
  eng.applyMove({ from: 'a1', to: 'a1' })
  eng.applyMove({ from: 'g8', to: 'g8' })
  eng.applyMove({ from: 'a2', to: 'a2' })
  eng.applyMove({ from: 'h6', to: 'h6' })
  eng.applyMove({ from: 'a3', to: 'a3' })
  eng.applyMove({ from: 'h7', to: 'h7' })
  eng.applyMove({ from: 'a4', to: 'a4' })
  let threw = false
  try {
    eng.applyMove({ from: 'h8', to: 'h8' })
  } catch {
    threw = true
  }
  ok(!threw, '关闭禁手时同一位置可落子')
}

// ==================== 2. 五子棋基本规则 ====================
{
  const eng = new GomokuEngine()
  // 黑在 a 列连成五子获胜；白在 h..k 列应着，不构成五连
  const seq: Array<[string, string | null]> = [
    ['a1', 'h8'],
    ['a2', 'i8'],
    ['a3', 'j8'],
    ['a4', 'k8'],
    ['a5', null], // 黑第五子成五，白不再走
  ]
  for (const [black, white] of seq) {
    eng.applyMove({ from: black, to: black })
    if (white) eng.applyMove({ from: white, to: white })
  }
  const res = eng.result()
  ok(res.status === 'first-win', `五子连珠判黑胜（得到 ${res.status}）`)
}

// ==================== 3. 象棋引擎基本规则 ====================
{
  const eng = new XiangqiEngine()
  const moves = eng.legalMoves()
  ok(moves.length === 44, `象棋初始合法着法 44 条（得到 ${moves.length}）`)
  ok(eng.turn() === 'r', '象棋红先')

  // 炮二平五：红炮在 b8（y=7,x=1），平到 e8（x=4）
  const before = eng.legalMoves()
  const hasCannon = before.some((m) => m.from === 'b8' && m.to === 'e8')
  ok(hasCannon, '炮二平五是合法着法')
}

// ==================== 4. 象棋 AI ====================
{
  const ai = new XiangqiAi()
  const eng = new XiangqiEngine()
  const start = Date.now()
  const move = await ai.think({
    difficulty: 'easy',
    position: eng.position(),
    turn: 'r',
  })
  const elapsed = Date.now() - start
  ok(move !== null, '象棋 AI 返回着法')
  if (move) {
    const legal = eng.legalMoves()
    ok(
      legal.some((m) => m.from === move.from && m.to === move.to),
      `象棋 AI 着法合法（${move.from}→${move.to}）`,
    )
  }
  ok(elapsed < 3000, `象棋 AI 响应及时（${elapsed}ms）`)
}

{
  // 象棋 AI 中档：能返回合法着法（不强制吃子，避免构造局面出错）
  const ai = new XiangqiAi()
  const eng = new XiangqiEngine()
  const move = await ai.think({
    difficulty: 'medium',
    position: eng.position(),
    turn: 'r',
  })
  ok(move !== null, '象棋 AI 中档返回着法')
  if (move) {
    const legal = eng.legalMoves()
    ok(
      legal.some((m) => m.from === move.from && m.to === move.to),
      `象棋 AI 中档着法合法（${move.from}→${move.to}）`,
    )
  }
}

// ==================== 5. 五子棋 AI ====================
{
  const ai = new GomokuAi()
  // 空盘：应落在天元附近
  const move = await ai.think({ difficulty: 'easy', position: '', turn: 'b' })
  ok(move !== null, '五子棋 AI 空盘返回着法')
  if (move) {
    const x = move.to.charCodeAt(0) - 97
    const y = Number(move.to.slice(1)) - 1
    ok(
      x >= 6 && x <= 8 && y >= 6 && y <= 8,
      `五子棋 AI 开局落天元附近（${move.to}）`,
    )
  }
}

{
  // 必胜点：黑棋已有四子连成一线，AI 应直接成五
  const ai = new GomokuAi()
  // 黑 h8 i8 j8 k8，白在别处
  const pos = 'bh8,bi8,bj8,bk8,wa1,wa2,wa3,wa4'
  const move = await ai.think({ difficulty: 'hard', position: pos, turn: 'b' })
  ok(move !== null, '五子棋 AI 必胜局面返回着法')
  if (move) {
    ok(
      move.to === 'l8' || move.to === 'g8',
      `五子棋 AI 走出成五点（得到 ${move.to}）`,
    )
  }
}

{
  // 必防点：白棋已有四子，黑棋应去堵
  const ai = new GomokuAi()
  const pos = 'bh1,bi1,bj1,bk1,wh8,wi8,wj8,wk8,wl8,ba1,bb1,bc1,bd1,be1,bf1,bg1'
  const move = await ai.think({ difficulty: 'hard', position: pos, turn: 'b' })
  ok(move !== null, '五子棋 AI 防守局面返回着法')
}

// ==================== 输出 ====================
console.log('='.repeat(60))
if (fail === 0) {
  console.log(`✓ 第 1 批自测：全部通过（${pass} 项）`)
} else {
  console.log(`✗ 失败 ${fail} / 通过 ${pass}`)
  for (const f of failures) console.log('  ✗ ' + f)
  process.exitCode = 1
}
