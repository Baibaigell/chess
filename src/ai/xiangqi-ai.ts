/**
 * 中国象棋 AI：Alpha-Beta 剪枝 + 置换表 + 历史启发。
 *
 * 为什么自己实现棋盘而不用 XiangqiEngine：
 * 引擎的 legalMoves() 每次都做全量合法性过滤（含 wouldExposeOwnKing 的整盘扫描），
 * 搜索里要调用上万次，性能不可接受。这里用紧凑的 16×16 数组表示棋盘，
 * 走法生成、将军判定、评估全部自包含，只在最外层与引擎交换局面字符串。
 *
 * 棋盘表示：
 * - 内部用 10×9 的一维数组，索引 y*9+x
 * - 棋子用整数编码：类型 1..7（将士象马车炮兵）+ 阵营位（红 0、黑 8）
 * - 0 表示空
 *
 * 局面字符串沿用引擎的格式："rnbakabnr/.../RNBAKABNR r"
 * 大写红方、小写黑方、'/' 分行、末尾空格加走子方。
 */
import type { Move } from '../core/types'
import type { AiEngine, ThinkOptions } from './types'
import { DIFFICULTY_PROFILES } from './types'

const COLS = 9
const ROWS = 10
const SIZE = COLS * ROWS

/** 棋子类型编号 */
const K = 1 // 将帅
const A = 2 // 士仕
const B = 3 // 象相
const N = 4 // 马
const R = 5 // 车
const C = 6 // 炮
const P = 7 // 兵卒

/** 阵营：红 0、黑 8，用位或叠加到类型上 */
const RED = 0
const BLACK = 8

/** 从编码取类型 / 阵营 */
const kindOf = (p: number): number => p & 7
const sideOf = (p: number): number => p & 8

/**
 * 子力价值（红方视角）。
 * 采用通行估值：车 900、马 400、炮 450、士 200、象 200、兵 100（过河后更高）。
 */
const VALUE: Record<number, number> = {
  [K]: 100000,
  [A]: 200,
  [B]: 200,
  [N]: 400,
  [R]: 900,
  [C]: 450,
  [P]: 100,
}

/**
 * 位置价值表（红方视角，黑方镜像取用）。
 * 只给兵与马做了位置加权，其余棋子位置差异不显著。
 * 索引为 y*9+x，y=0 在上（黑方底线），y=9 在下（红方底线）。
 */
const PAWN_TABLE = new Int16Array(SIZE)
const HORSE_TABLE = new Int16Array(SIZE)

// 兵：越靠近对方九宫越有价值，过河后显著提升
for (let y = 0; y < ROWS; y++) {
  for (let x = 0; x < COLS; x++) {
    const i = y * COLS + x
    // 红兵向上（y 减小）走，y<=4 表示已过河
    if (y <= 4) {
      // 过河兵：靠近中路和对方底线更强
      const centerBonus = 4 - Math.abs(x - 4)
      PAWN_TABLE[i] = 60 + (5 - y) * 6 + centerBonus * 3
    } else {
      PAWN_TABLE[i] = 0
    }
    // 马：中心区域更灵活
    HORSE_TABLE[i] = 12 - Math.abs(x - 4) * 2 - Math.abs(y - 4.5) * 2
  }
}

/** 一步走法 */
interface MoveInt {
  from: number
  to: number
  /** 被吃子编码，0 表示无 */
  captured: number
}

/** 走法列表上限，避免搜索中频繁扩容 */
const MAX_MOVES = 128

/**
 * 紧凑棋盘。
 *
 * 用一维 Int8Array 存棋子编码，另存红黑将帅位置以便快速判将。
 */
class Board {
  cells: Int8Array
  redKing: number
  blackKing: number

  constructor() {
    this.cells = new Int8Array(SIZE)
    this.redKing = -1
    this.blackKing = -1
  }

  clone(): Board {
    const b = new Board()
    b.cells.set(this.cells)
    b.redKing = this.redKing
    b.blackKing = this.blackKing
    return b
  }

  /** 从局面字符串载入 */
  load(position: string): boolean {
    this.cells.fill(0)
    this.redKing = -1
    this.blackKing = -1
    const boardPart = position.split(' ')[0]
    const rows = boardPart.split('/')
    if (rows.length !== ROWS) return false

    for (let y = 0; y < ROWS; y++) {
      const row = rows[y]
      if (row.length !== COLS) return false
      for (let x = 0; x < COLS; x++) {
        const ch = row[x]
        if (ch === '.') continue
        const lower = ch.toLowerCase()
        let kind = 0
        switch (lower) {
          case 'k':
            kind = K
            break
          case 'a':
            kind = A
            break
          case 'b':
            kind = B
            break
          case 'n':
            kind = N
            break
          case 'r':
            kind = R
            break
          case 'c':
            kind = C
            break
          case 'p':
            kind = P
            break
          default:
            return false
        }
        const side = ch === ch.toUpperCase() ? RED : BLACK
        const code = kind | side
        const i = y * COLS + x
        this.cells[i] = code
        if (kind === K) {
          if (side === RED) this.redKing = i
          else this.blackKing = i
        }
      }
    }
    return true
  }

  /** 走子方：从局面字符串末尾取 */
  static turnOf(position: string): number {
    const parts = position.split(' ')
    return parts[1] === 'b' ? BLACK : RED
  }

  /** 内部走一步（不做合法性校验，调用方保证合法） */
  make(m: MoveInt): void {
    this.cells[m.to] = this.cells[m.from]
    this.cells[m.from] = 0
    // 更新将帅位置
    const moved = this.cells[m.to]
    if (kindOf(moved) === K) {
      if (sideOf(moved) === RED) this.redKing = m.to
      else this.blackKing = m.to
    }
    // 被吃的是将帅（极少见，但搜索中可能出现）→ 标记为 -1
    if (m.captured && kindOf(m.captured) === K) {
      if (sideOf(m.captured) === RED) this.redKing = -1
      else this.blackKing = -1
    }
  }

  /** 撤销一步 */
  unmake(m: MoveInt): void {
    const moved = this.cells[m.to]
    this.cells[m.from] = moved
    this.cells[m.to] = m.captured
    if (kindOf(moved) === K) {
      if (sideOf(moved) === RED) this.redKing = m.from
      else this.blackKing = m.from
    }
    if (m.captured && kindOf(m.captured) === K) {
      if (sideOf(m.captured) === RED) this.redKing = m.to
      else this.blackKing = m.to
    }
  }

  /** 九宫判定 */
  static inPalace(x: number, y: number, side: number): boolean {
    if (x < 3 || x > 5) return false
    return side === RED ? y >= 7 && y <= 9 : y >= 0 && y <= 2
  }

  /**
   * 生成某方全部伪合法着法（不检查走后是否被将军）。
   * 返回的走法写入 out，返回实际数量。
   */
  genMoves(side: number, out: MoveInt[]): number {
    let n = 0
    for (let i = 0; i < SIZE; i++) {
      const p = this.cells[i]
      if (!p || sideOf(p) !== side) continue
      const x = i % COLS
      const y = (i - x) / COLS
      const kind = kindOf(p)

      switch (kind) {
        case K: {
          // 四方向一步，限九宫
          for (const [dx, dy] of [
            [0, 1],
            [0, -1],
            [1, 0],
            [-1, 0],
          ] as const) {
            const nx = x + dx
            const ny = y + dy
            if (!Board.inPalace(nx, ny, side)) continue
            n = this.pushMove(out, n, i, ny * COLS + nx, side)
          }
          break
        }

        case A: {
          for (const [dx, dy] of [
            [1, 1],
            [1, -1],
            [-1, 1],
            [-1, -1],
          ] as const) {
            const nx = x + dx
            const ny = y + dy
            if (!Board.inPalace(nx, ny, side)) continue
            n = this.pushMove(out, n, i, ny * COLS + nx, side)
          }
          break
        }

        case B: {
          for (const [dx, dy] of [
            [2, 2],
            [2, -2],
            [-2, 2],
            [-2, -2],
          ] as const) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue
            // 不能过河：红 y>=5，黑 y<=4
            if (side === RED ? ny < 5 : ny > 4) continue
            // 象眼
            if (this.cells[(y + dy / 2) * COLS + (x + dx / 2)]) continue
            n = this.pushMove(out, n, i, ny * COLS + nx, side)
          }
          break
        }

        case N: {
          const jumps: ReadonlyArray<readonly [number, number, number, number]> = [
            [1, 2, 0, 1],
            [-1, 2, 0, 1],
            [1, -2, 0, -1],
            [-1, -2, 0, -1],
            [2, 1, 1, 0],
            [2, -1, 1, 0],
            [-2, 1, -1, 0],
            [-2, -1, -1, 0],
          ]
          for (const [dx, dy, bx, by] of jumps) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue
            if (this.cells[(y + by) * COLS + (x + bx)]) continue // 马腿
            n = this.pushMove(out, n, i, ny * COLS + nx, side)
          }
          break
        }

        case R: {
          for (const [dx, dy] of [
            [0, 1],
            [0, -1],
            [1, 0],
            [-1, 0],
          ] as const) {
            let nx = x + dx
            let ny = y + dy
            while (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS) {
              const j = ny * COLS + nx
              const t = this.cells[j]
              if (!t) {
                out[n++] = { from: i, to: j, captured: 0 }
              } else {
                if (sideOf(t) !== side) out[n++] = { from: i, to: j, captured: t }
                break
              }
              nx += dx
              ny += dy
            }
          }
          break
        }

        case C: {
          for (const [dx, dy] of [
            [0, 1],
            [0, -1],
            [1, 0],
            [-1, 0],
          ] as const) {
            let nx = x + dx
            let ny = y + dy
            let screen = false
            while (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS) {
              const j = ny * COLS + nx
              const t = this.cells[j]
              if (!screen) {
                if (!t) {
                  out[n++] = { from: i, to: j, captured: 0 }
                } else {
                  screen = true // 找到炮架
                }
              } else if (t) {
                if (sideOf(t) !== side) out[n++] = { from: i, to: j, captured: t }
                break
              }
              nx += dx
              ny += dy
            }
          }
          break
        }

        case P: {
          const forward = side === RED ? -1 : 1
          const fy = y + forward
          if (fy >= 0 && fy < ROWS) {
            n = this.pushMove(out, n, i, fy * COLS + x, side)
          }
          // 过河后可左右走
          const crossed = side === RED ? y <= 4 : y >= 5
          if (crossed) {
            if (x > 0) n = this.pushMove(out, n, i, y * COLS + (x - 1), side)
            if (x < COLS - 1) n = this.pushMove(out, n, i, y * COLS + (x + 1), side)
          }
          break
        }
      }
    }
    return n
  }

  /** 若目标格为空或敌子则写入走法，返回新的 n */
  private pushMove(
    out: MoveInt[],
    n: number,
    from: number,
    to: number,
    side: number,
  ): number {
    if (n >= MAX_MOVES) return n
    const t = this.cells[to]
    if (t && sideOf(t) === side) return n
    out[n++] = { from, to, captured: t }
    return n
  }

  /**
   * 某方是否被将军（含飞将）。
   * 用「从将帅位置反向探测」而不是生成对方全部着法，快得多。
   */
  inCheck(side: number): boolean {
    const kingPos = side === RED ? this.redKing : this.blackKing
    if (kingPos < 0) return true
    const kx = kingPos % COLS
    const ky = (kingPos - kx) / COLS
    const enemy = side === RED ? BLACK : RED

    // 飞将：同列直线上第一个棋子若是对方将帅
    for (let dy = -1; dy <= 1; dy += 2) {
      let y = ky + dy
      while (y >= 0 && y < ROWS) {
        const p = this.cells[y * COLS + kx]
        if (p) {
          if (kindOf(p) === K && sideOf(p) === enemy) return true
          break
        }
        y += dy
      }
    }

    // 车 / 炮：沿四条直线探测
    for (const [dx, dy] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ] as const) {
      let nx = kx + dx
      let ny = ky + dy
      let screened = false
      while (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS) {
        const p = this.cells[ny * COLS + nx]
        if (p) {
          const pk = kindOf(p)
          const ps = sideOf(p)
          if (!screened) {
            // 第一个子：车或对方将帅（飞将已在上面处理）可吃
            if (ps === enemy && (pk === R || pk === K)) return true
            screened = true
          } else {
            // 第二个子：炮可吃
            if (ps === enemy && pk === C) return true
            break
          }
        }
        nx += dx
        ny += dy
      }
    }

    // 马：八个马位反向探测，注意马腿在马的旁边
    const horseAttacks: ReadonlyArray<readonly [number, number, number, number]> = [
      // [马相对将的偏移 dx,dy, 马腿相对马的偏移 bx,by]
      [1, 2, 0, -1],
      [-1, 2, 0, -1],
      [1, -2, 0, 1],
      [-1, -2, 0, 1],
      [2, 1, -1, 0],
      [2, -1, -1, 0],
      [-2, 1, 1, 0],
      [-2, -1, 1, 0],
    ]
    for (const [dx, dy, bx, by] of horseAttacks) {
      const hx = kx + dx
      const hy = ky + dy
      if (hx < 0 || hx >= COLS || hy < 0 || hy >= ROWS) continue
      const p = this.cells[hy * COLS + hx]
      if (!p || sideOf(p) !== enemy || kindOf(p) !== N) continue
      // 马腿：在马的 (bx,by) 方向
      const lx = hx + bx
      const ly = hy + by
      if (lx < 0 || lx >= COLS || ly < 0 || ly >= ROWS) continue
      if (!this.cells[ly * COLS + lx]) return true
    }

    // 兵：正面一步与过河后的左右一步
    const pawnFrom = side === RED ? ky - 1 : ky + 1
    if (pawnFrom >= 0 && pawnFrom < ROWS) {
      const p = this.cells[pawnFrom * COLS + kx]
      if (p && sideOf(p) === enemy && kindOf(p) === P) return true
    }
    for (const dx of [-1, 1]) {
      const nx = kx + dx
      if (nx < 0 || nx >= COLS) continue
      const p = this.cells[ky * COLS + nx]
      if (p && sideOf(p) === enemy && kindOf(p) === P) {
        // 兵能左右走的前提是它已过河
        const enemyCrossed = enemy === RED ? ky <= 4 : ky >= 5
        if (enemyCrossed) return true
      }
    }

    return false
  }

  /** 静态评估，返回红方视角分值 */
  evaluate(): number {
    let score = 0
    for (let i = 0; i < SIZE; i++) {
      const p = this.cells[i]
      if (!p) continue
      const kind = kindOf(p)
      const value = VALUE[kind] ?? 0
      if (sideOf(p) === RED) {
        score += value
        if (kind === P) score += PAWN_TABLE[i]
        else if (kind === N) score += HORSE_TABLE[i]
      } else {
        score -= value
        // 黑方位置表镜像
        const mx = i % COLS
        const my = (i - mx) / COLS
        const mirror = (ROWS - 1 - my) * COLS + mx
        if (kind === P) score -= PAWN_TABLE[mirror]
        else if (kind === N) score -= HORSE_TABLE[mirror]
      }
    }
    return score
  }
}

/** 走法排序：吃子优先，按被吃子价值降序 */
function scoreMove(m: MoveInt): number {
  if (!m.captured) return 0
  return (VALUE[kindOf(m.captured)] ?? 0) * 10
}

/** 置换表条目 */
interface TtEntry {
  score: number
  /** 该分值对应的搜索深度 */
  depth: number
}

/** 搜索上下文 */
interface SearchCtx {
  /** 置换表：key → 分值条目 */
  tt: Map<string, TtEntry>
  /** 历史启发：from*100+to → 累计得分 */
  history: Int32Array
  /** 节点计数，用于时间控制 */
  nodes: number
  /** 截止时间戳（毫秒） */
  deadline: number
  /** 是否已超时 */
  timeout: boolean
  /** 中止信号 */
  signal?: AbortSignal
}

/**
 * 计算局面 key（用于置换表）。
 * 用棋子编码拼接成字符串，比 BigInt 便宜，且在 JS 里做 Map key 足够快。
 */
function boardKey(board: Board, side: number): string {
  let s = ''
  for (let i = 0; i < SIZE; i++) s += String.fromCharCode(board.cells[i] + 48)
  return s + (side === RED ? 'r' : 'b')
}

/** 负极大搜索（negamax），带 Alpha-Beta 剪枝 */
function search(
  board: Board,
  side: number,
  depth: number,
  alpha: number,
  beta: number,
  ctx: SearchCtx,
  ply: number,
): number {
  ctx.nodes++

  // 每 2048 个节点检查一次超时，避免频繁取时间戳
  if ((ctx.nodes & 2047) === 0) {
    if (Date.now() > ctx.deadline || ctx.signal?.aborted) {
      ctx.timeout = true
      return 0
    }
  }
  if (ctx.timeout) return 0

  // 置换表命中：只接受同深度或更深的条目，避免浅层分值污染深层搜索
  const key = boardKey(board, side)
  const cached = ctx.tt.get(key)
  if (cached && cached.depth >= depth) return cached.score

  // 到达叶子：静态评估（红方视角转负极大视角）
  if (depth <= 0) {
    const ev = board.evaluate()
    return side === RED ? ev : -ev
  }

  const moves: MoveInt[] = new Array(MAX_MOVES)
  const n = board.genMoves(side, moves)

  // 排序：吃子优先 + 历史启发
  const ordered = moves.slice(0, n)
  ordered.sort((a, b) => {
    const sa = scoreMove(a) + ctx.history[a.from * 100 + a.to]
    const sb = scoreMove(b) + ctx.history[b.from * 100 + b.to]
    return sb - sa
  })

  let best = -Infinity
  let legalCount = 0

  for (const m of ordered) {
    board.make(m)
    // 走完后自己被将军 → 非法，跳过
    if (board.inCheck(side)) {
      board.unmake(m)
      continue
    }
    legalCount++

    const score = -search(board, side === RED ? BLACK : RED, depth - 1, -beta, -alpha, ctx, ply + 1)
    board.unmake(m)

    if (ctx.timeout) return best === -Infinity ? 0 : best

    if (score > best) best = score
    if (score > alpha) alpha = score
    if (alpha >= beta) {
      // 剪枝：记录历史启发
      if (!m.captured) ctx.history[m.from * 100 + m.to] += depth * depth
      break
    }
  }

  // 无合法着法：被将死或困毙，都判负
  if (legalCount === 0) return -90000 + ply

  ctx.tt.set(key, { score: best, depth })
  return best
}

/** 难度 → 搜索深度与时间预算 */
const DEPTH_BY_DIFFICULTY: Record<string, { depth: number; ms: number }> = {
  easy: { depth: 2, ms: 400 },
  medium: { depth: 3, ms: 900 },
  hard: { depth: 4, ms: 1800 },
}

/** 索引 → "a1" */
function idxToSquare(i: number): string {
  const x = i % COLS
  const y = (i - x) / COLS
  return `${String.fromCharCode(97 + x)}${y + 1}`
}

/** "a1" → 索引；非法返回 -1 */
function squareToIdx(sq: string): number {
  const m = /^([a-i])(\d{1,2})$/.exec(sq)
  if (!m) return -1
  const x = m[1].charCodeAt(0) - 97
  const y = Number(m[2]) - 1
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return -1
  return y * COLS + x
}

/**
 * 中国象棋 AI 实现。
 *
 * 每次 think() 都从局面字符串重建棋盘，不保留跨局状态，
 * 因此可以安全地在多局之间复用同一实例。
 */
export class XiangqiAi implements AiEngine {
  think(options: ThinkOptions): Promise<Move | null> {
    const { position, difficulty, signal } = options

    return new Promise<Move | null>((resolve) => {
      // 放到下一个宏任务，避免阻塞渲染线程的首帧
      setTimeout(() => {
        if (signal?.aborted) {
          resolve(null)
          return
        }

        const board = new Board()
        if (!board.load(position)) {
          resolve(null)
          return
        }
        const side = Board.turnOf(position)
        const cfg = DEPTH_BY_DIFFICULTY[difficulty] ?? DEPTH_BY_DIFFICULTY.medium

        // 生成根节点全部合法着法
        const raw: MoveInt[] = new Array(MAX_MOVES)
        const n = board.genMoves(side, raw)
        const legal: MoveInt[] = []
        for (let i = 0; i < n; i++) {
          const m = raw[i]
          board.make(m)
          if (!board.inCheck(side)) legal.push(m)
          board.unmake(m)
        }
        if (legal.length === 0) {
          resolve(null)
          return
        }

        const ctx: SearchCtx = {
          tt: new Map(),
          history: new Int32Array(100 * 100),
          nodes: 0,
          deadline: Date.now() + cfg.ms,
          timeout: false,
          signal,
        }

        // 简单档：加一点随机性，避免每局开局完全一样
        if (difficulty === 'easy' && legal.length > 1) {
          const pick = legal[Math.floor(Math.random() * legal.length)]
          resolve({ from: idxToSquare(pick.from), to: idxToSquare(pick.to) })
          return
        }

        // 迭代加深：先浅后深，超时也能拿到一个可用结果
        let bestMove: MoveInt = legal[0]
        for (let d = 1; d <= cfg.depth; d++) {
          let bestScore = -Infinity
          let currentBest: MoveInt | null = null

          // 上一轮最优着法排在最前，提高剪枝效率
          const ordered = [bestMove, ...legal.filter((m) => m !== bestMove)]

          for (const m of ordered) {
            if (ctx.timeout) break
            board.make(m)
            // 根节点用 alpha 窗口：已找到的最好分值作为下界
            const alpha = bestScore === -Infinity ? -Infinity : bestScore
            const score = -search(
              board,
              side === RED ? BLACK : RED,
              d - 1,
              -Infinity,
              -alpha,
              ctx,
              1,
            )
            board.unmake(m)

            if (ctx.timeout) break
            if (score > bestScore) {
              bestScore = score
              currentBest = m
            }
          }

          if (currentBest && !ctx.timeout) bestMove = currentBest
          if (ctx.timeout) break
        }

        resolve({ from: idxToSquare(bestMove.from), to: idxToSquare(bestMove.to) })
      }, 0)
    })
  }

  dispose(): void {
    // 无外部资源
  }
}

/** 供自测使用：把局面字符串转成索引，验证解析正确性 */
export const _internal = { Board, squareToIdx, idxToSquare, KIND: { K, A, B, N, R, C, P }, RED, BLACK }

/** 难度档位的说明，与其它棋种保持一致 */
export const XIANGQI_DIFFICULTY_LABEL = DIFFICULTY_PROFILES
