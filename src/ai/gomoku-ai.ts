/**
 * 五子棋 AI：基于棋形评估的启发式搜索。
 *
 * 五子棋的分支因子极大（15×15 有 225 个空点），完整 Alpha-Beta 在浏览器里
 * 跑不动。因此采用两层策略：
 *
 * 1. **候选点收缩**：只考虑已有棋子周围 2 格内的空点，远离战场的点
 *    在开局阶段没有价值。这一条把分支因子从 225 降到 20～40。
 * 2. **棋形评分 + 浅层搜索**：对每个候选点算「攻防收益」，
 *    取前 N 个做 2～4 层搜索。评估函数按「活四 > 冲四 > 活三 > 眠三」加权。
 *
 * 禁手：开启禁手规则时，黑棋的禁手点直接从候选里剔除，
 * 与引擎的合法着法保持一致。
 */
import type { Move } from '../core/types'
import type { AiEngine, ThinkOptions } from './types'
import { checkForbidden } from '../games/gomoku/forbidden'
import type { Cell as ForbiddenCell } from '../games/gomoku/forbidden'

/** 棋盘边长 */
const SIZE = 15

/** 单格：0 空、1 黑、2 白 */
type Cell = 0 | 1 | 2

/** 四个方向 */
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
]

/**
 * 棋形分值。
 *
 * 数值取「必胜 > 活四 > 冲四 > 活三 > 眠三 > 活二」的严格递减，
 * 并留出足够间隔，避免多个小棋形叠加后超过大棋形。
 */
const SCORE = {
  /** 五连 */
  FIVE: 10000000,
  /** 活四：两端都空，必胜 */
  OPEN_FOUR: 1000000,
  /** 冲四：一端被封，对手必须应 */
  FOUR: 100000,
  /** 活三：下一步可成活四 */
  OPEN_THREE: 50000,
  /** 眠三 */
  SLEEP_THREE: 5000,
  /** 活二 */
  OPEN_TWO: 3000,
  /** 眠二 */
  SLEEP_TWO: 300,
} as const

/** 候选点周围的搜索半径 */
const NEAR_RADIUS = 2

/** 局面评估：以「轮到走子的一方」为正 */
class Evaluator {
  /**
   * 计算某点落子后、某方向上的棋形分值。
   *
   * 做法：把该方向的 9 格线取出来，试落子，然后统计包含落点的
   * 连续同色段长度与两端状态，映射到 SCORE 表。
   */
  static shapeScore(
    board: Cell[][],
    x: number,
    y: number,
    color: Cell,
    dx: number,
    dy: number,
  ): number {
    const line: number[] = []
    for (let i = -4; i <= 4; i++) {
      const nx = x + dx * i
      const ny = y + dy * i
      if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE) line.push(3)
      else line.push(board[ny][nx])
    }

    const center = 4
    line[center] = color

    // 求包含中心的连续段
    let l = center
    let r = center
    while (l - 1 >= 0 && line[l - 1] === color) l--
    while (r + 1 < line.length && line[r + 1] === color) r++
    const count = r - l + 1
    const leftEmpty = l - 1 >= 0 && line[l - 1] === 0
    const rightEmpty = r + 1 < line.length && line[r + 1] === 0
    const openEnds = (leftEmpty ? 1 : 0) + (rightEmpty ? 1 : 0)

    if (count >= 5) return SCORE.FIVE
    if (count === 4) {
      if (openEnds === 2) return SCORE.OPEN_FOUR
      if (openEnds === 1) return SCORE.FOUR
      return 0
    }
    if (count === 3) {
      if (openEnds === 2) return SCORE.OPEN_THREE
      if (openEnds === 1) return SCORE.SLEEP_THREE
      return 0
    }
    if (count === 2) {
      if (openEnds === 2) return SCORE.OPEN_TWO
      if (openEnds === 1) return SCORE.SLEEP_TWO
      return 0
    }

    // 跳形（如「●●_●」）：在窗口内滑动 5 格，若恰好 4 子 1 空则算冲四
    for (let start = 0; start + 5 <= line.length; start++) {
      if (center < start || center >= start + 5) continue
      let same = 0
      let empty = 0
      let blocked = false
      for (let k = start; k < start + 5; k++) {
        if (line[k] === color) same++
        else if (line[k] === 0) empty++
        else {
          blocked = true
          break
        }
      }
      if (!blocked && same === 4 && empty === 1) return SCORE.FOUR
      if (!blocked && same === 3 && empty === 2) return SCORE.SLEEP_THREE
    }

    return 0
  }

  /** 某点对某方的总收益：四个方向求和 */
  static pointValue(
    board: Cell[][],
    x: number,
    y: number,
    color: Cell,
  ): number {
    let sum = 0
    for (const [dx, dy] of DIRS) {
      sum += Evaluator.shapeScore(board, x, y, color, dx, dy)
    }
    return sum
  }

  /** 整盘评估：己方棋形总分 - 对方棋形总分（权重更高，倾向防守） */
  static evaluateBoard(board: Cell[][], self: Cell): number {
    const other: Cell = self === 1 ? 2 : 1
    let mine = 0
    let theirs = 0
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (board[y][x] !== 0) continue
        mine += Evaluator.pointValue(board, x, y, self)
        theirs += Evaluator.pointValue(board, x, y, other)
      }
    }
    return mine - theirs * 1.1
  }
}

/** 候选点：带启发分，用于排序与截断 */
interface Candidate {
  x: number
  y: number
  /** 进攻分（己方在此落子的收益） */
  attack: number
  /** 防守分（对手在此落子的收益） */
  defend: number
}

/** 从局面字符串解析棋盘与走子方 */
function parsePosition(position: string): { board: Cell[][]; turn: Cell } {
  const board: Cell[][] = Array.from({ length: SIZE }, () =>
    Array<Cell>(SIZE).fill(0),
  )
  if (position) {
    for (const token of position.split(',')) {
      const m = /^([bw])([a-o])(\d{1,2})$/.exec(token)
      if (!m) continue
      const x = m[2].charCodeAt(0) - 97
      const y = Number(m[3]) - 1
      if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) continue
      board[y][x] = m[1] === 'b' ? 1 : 2
    }
  }
  // 黑先：棋子数为偶数则轮到黑
  let count = 0
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) if (board[y][x] !== 0) count++
  }
  return { board, turn: count % 2 === 0 ? 1 : 2 }
}

/** 收集候选点：已有棋子 NEAR_RADIUS 格内的空点；空盘则取天元 */
function collectCandidates(
  board: Cell[][],
  self: Cell,
  forbiddenRule: boolean,
): Candidate[] {
  const other: Cell = self === 1 ? 2 : 1
  const hasStone = board.some((row) => row.some((c) => c !== 0))

  if (!hasStone) {
    // 空盘：天元附近随机一点，避免每局完全相同
    const cx = 7 + Math.floor(Math.random() * 2) - 1
    const cy = 7 + Math.floor(Math.random() * 2) - 1
    return [{ x: cx, y: cy, attack: 1, defend: 1 }]
  }

  const seen = new Set<number>()
  const out: Candidate[] = []

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (board[y][x] === 0) continue
      // 以该子为中心，扫描周围半径
      for (let dy = -NEAR_RADIUS; dy <= NEAR_RADIUS; dy++) {
        for (let dx = -NEAR_RADIUS; dx <= NEAR_RADIUS; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE) continue
          if (board[ny][nx] !== 0) continue
          const key = ny * SIZE + nx
          if (seen.has(key)) continue
          seen.add(key)

          // 禁手点对黑棋不合法，直接排除
          if (forbiddenRule && self === 1) {
            const numeric = board.map((row) =>
              row.map((c) => c as ForbiddenCell),
            )
            if (checkForbidden(numeric, nx, ny, SIZE).forbidden) continue
          }

          out.push({
            x: nx,
            y: ny,
            attack: Evaluator.pointValue(board, nx, ny, self),
            defend: Evaluator.pointValue(board, nx, ny, other),
          })
        }
      }
    }
  }

  return out
}

/** 判断某点落子是否直接成五 */
function isWinningPoint(board: Cell[][], x: number, y: number, color: Cell): boolean {
  board[y][x] = color
  let win = false
  for (const [dx, dy] of DIRS) {
    if (Evaluator.shapeScore(board, x, y, color, dx, dy) >= SCORE.FIVE) {
      win = true
      break
    }
  }
  board[y][x] = 0
  return win
}

/** 难度 → 候选点数量与搜索深度 */
const LEVEL: Record<string, { width: number; depth: number }> = {
  easy: { width: 6, depth: 1 },
  medium: { width: 10, depth: 2 },
  hard: { width: 14, depth: 4 },
}

/**
 * 五子棋 AI。
 *
 * 决策流程：
 * 1. 己方能一步成五 → 直接走（必胜）
 * 2. 对手能一步成五 → 堵（必防）
 * 3. 否则按「进攻 + 防守 × 权重」排序候选点，取前 N 个做浅层搜索
 * 4. 搜索用负极大，评估函数是「己方棋形 - 对方棋形」
 */
export class GomokuAi implements AiEngine {
  think(options: ThinkOptions): Promise<Move | null> {
    const { position, difficulty, signal } = options

    return new Promise<Move | null>((resolve) => {
      setTimeout(() => {
        if (signal?.aborted) {
          resolve(null)
          return
        }

        const { board, turn } = parsePosition(position)
        const self = turn
        const other: Cell = self === 1 ? 2 : 1
        const forbiddenRule = options.forbidden === true
        const level = LEVEL[difficulty] ?? LEVEL.medium

        // ---- 1. 己方能一步成五，直接走 ----
        const candidates = collectCandidates(board, self, forbiddenRule)
        if (candidates.length === 0) {
          resolve(null)
          return
        }

        for (const c of candidates) {
          if (isWinningPoint(board, c.x, c.y, self)) {
            resolve({ from: sq(c.x, c.y), to: sq(c.x, c.y) })
            return
          }
        }

        // ---- 2. 对手能一步成五，必须堵 ----
        for (const c of candidates) {
          if (isWinningPoint(board, c.x, c.y, other)) {
            // 堵点若对黑棋是禁手（己方为黑），则不能堵，退而求其次
            if (forbiddenRule && self === 1) {
              const numeric = board.map((row) =>
                row.map((v) => v as ForbiddenCell),
              )
              if (checkForbidden(numeric, c.x, c.y, SIZE).forbidden) continue
            }
            resolve({ from: sq(c.x, c.y), to: sq(c.x, c.y) })
            return
          }
        }

        // ---- 3. 排序候选点 ----
        // 防守权重略高于进攻：漏防一步就输，漏攻只是错过机会
        const ranked = [...candidates].sort((a, b) => {
          const sa = a.attack + a.defend * 1.2
          const sb = b.attack + b.defend * 1.2
          return sb - sa
        })

        const top = ranked.slice(0, level.width)

        // 简单档：直接取评分最高的点，不加搜索
        if (difficulty === 'easy') {
          // 在前三中随机，避免每局一模一样
          const pick = top[Math.floor(Math.random() * Math.min(3, top.length))]
          resolve({ from: sq(pick.x, pick.y), to: sq(pick.x, pick.y) })
          return
        }

        // ---- 4. 浅层负极大搜索 ----
        let best = top[0]
        let bestScore = -Infinity

        for (const c of top) {
          if (signal?.aborted) break
          board[c.y][c.x] = self
          const score = -negamax(
            board,
            other,
            level.depth - 1,
            forbiddenRule,
            -Infinity,
            -bestScore === -Infinity ? Infinity : -bestScore,
            signal,
          )
          board[c.y][c.x] = 0

          if (score > bestScore) {
            bestScore = score
            best = c
          }
        }

        resolve({ from: sq(best.x, best.y), to: sq(best.x, best.y) })
      }, 0)
    })
  }

  dispose(): void {
    // 无外部资源
  }
}

/** 负极大搜索（五子棋） */
function negamax(
  board: Cell[][],
  side: Cell,
  depth: number,
  forbiddenRule: boolean,
  alpha: number,
  beta: number,
  signal?: AbortSignal,
): number {
  if (signal?.aborted) return 0

  if (depth <= 0) {
    return Evaluator.evaluateBoard(board, side)
  }

  const candidates = collectCandidates(board, side, forbiddenRule)
  if (candidates.length === 0) return 0

  // 取前若干，控制分支
  candidates.sort((a, b) => b.attack + b.defend * 1.2 - (a.attack + a.defend * 1.2))
  const width = Math.min(8, candidates.length)
  const other: Cell = side === 1 ? 2 : 1

  let best = -Infinity
  for (let i = 0; i < width; i++) {
    const c = candidates[i]
    board[c.y][c.x] = side
    // 立即成五 → 极高分，直接返回
    let immediateWin = false
    for (const [dx, dy] of DIRS) {
      if (Evaluator.shapeScore(board, c.x, c.y, side, dx, dy) >= SCORE.FIVE) {
        immediateWin = true
        break
      }
    }
    let score: number
    if (immediateWin) {
      score = SCORE.FIVE
    } else {
      score = -negamax(board, other, depth - 1, forbiddenRule, -beta, -alpha, signal)
    }
    board[c.y][c.x] = 0

    if (score > best) best = score
    if (score > alpha) alpha = score
    if (alpha >= beta) break
  }

  return best === -Infinity ? 0 : best
}

/** 索引 → 坐标串 "a1" */
function sq(x: number, y: number): string {
  return `${String.fromCharCode(97 + x)}${y + 1}`
}
