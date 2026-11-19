/**
 * 五子棋禁手判定（黑棋专用）。
 *
 * 采用《中国五子棋竞赛规则》的三类禁手：
 * - 三三禁手：黑棋一子落下同时形成两个或以上的「活三」
 * - 四四禁手：黑棋一子落下同时形成两个或以上的「四」
 * - 长连禁手：黑棋一子落下形成六个或以上连续同色子
 *
 * 判定优先级（规则第五章）：
 * 1. 五连优先：落子若在某方向恰好成五，即为胜着，禁手失效
 * 2. 长连：某方向连成六子及以上 → 长连禁手
 * 3. 四四：两个及以上方向形成「四」→ 四四禁手
 * 4. 三三：两个及以上方向形成「活三」→ 三三禁手
 *
 * 定义（全部以「落子后包含落点的那一段」为准）：
 * - 四：再落一子即可成五的棋形（含直四、跳四）
 * - 活四：四子连成一线且两端皆空（对手无法同时堵住两端）
 * - 活三：再落一子即可成活三的棋形（即一步能变成活四）
 *
 * 白棋没有禁手；长连对白棋不算禁手，仍按五连获胜处理。
 *
 * 本模块不修改调用方棋盘：内部试落后一定会还原。
 */

/** 单格：0 空、1 黑、2 白 */
export type Cell = 0 | 1 | 2

/** 黑棋 */
export const BLACK = 1 as const
/** 白棋 */
export const WHITE = 2 as const

/** 四个方向：横、竖、右下、右上 */
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
]

/** 禁手类型 */
export type ForbiddenKind = 'double-three' | 'double-four' | 'overline'

/** 禁手判定结果 */
export interface ForbiddenResult {
  forbidden: boolean
  kind: ForbiddenKind | null
}

const OK: ForbiddenResult = { forbidden: false, kind: null }

/** 棋形统计：以落点为中心的连续同色段 */
interface RunInfo {
  /** 连续同色子个数（含中心） */
  count: number
  /** 左端是否为空位 */
  leftEmpty: boolean
  /** 右端是否为空位 */
  rightEmpty: boolean
}

/**
 * 取以 (x,y) 为中心、沿 (dx,dy) 方向 ±5 的 11 格线。
 *
 * 为什么是 ±5 而不是 ±4：判定长连需要看到中心两侧各 5 格。
 * 例如已有 h8..l8 五子（中心 m8 的左侧 5 格），
 * 若窗口只到 ±4 就看不到最左的 h8，会把六连误判成五连。
 *
 * 越界记为 3（视为墙），这样边界自然被当作封堵。
 */
const WINDOW = 5
const CENTER = WINDOW

function lineAround(
  board: Cell[][],
  x: number,
  y: number,
  dx: number,
  dy: number,
  size: number,
): number[] {
  const out: number[] = []
  for (let i = -WINDOW; i <= WINDOW; i++) {
    const nx = x + dx * i
    const ny = y + dy * i
    if (nx < 0 || nx >= size || ny < 0 || ny >= size) out.push(3)
    else out.push(board[ny][nx])
  }
  return out
}

/** 求包含 index 的连续同色段信息 */
function runAt(line: number[], index: number, color: number): RunInfo {
  let l = index
  let r = index
  while (l - 1 >= 0 && line[l - 1] === color) l--
  while (r + 1 < line.length && line[r + 1] === color) r++
  return {
    count: r - l + 1,
    leftEmpty: l - 1 >= 0 && line[l - 1] === 0,
    rightEmpty: r + 1 < line.length && line[r + 1] === 0,
  }
}

/** 该方向是否恰好成五（不含长连） */
function isFive(line: number[], center: number): boolean {
  return runAt(line, center, BLACK).count === 5
}

/** 该方向是否长连（六子及以上） */
function isOverline(line: number[], center: number): boolean {
  return runAt(line, center, BLACK).count >= 6
}

/** 该方向是否形成「四」：存在一个空位，补上即成五 */
function isFour(line: number[], center: number): boolean {
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== 0) continue
    const saved = line[i]
    line[i] = BLACK
    const five = runAt(line, center, BLACK).count === 5
    line[i] = saved
    if (five) return true
  }
  return false
}

/** 该方向是否形成「活三」：存在一个空位，补上即成活四 */
function isOpenThree(line: number[], center: number): boolean {
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== 0) continue
    const saved = line[i]
    line[i] = BLACK
    const run = runAt(line, center, BLACK)
    // 活四：四子连成一线，两端皆空
    const openFour = run.count === 4 && run.leftEmpty && run.rightEmpty
    line[i] = saved
    if (openFour) return true
  }
  return false
}

/**
 * 判断黑棋在 (x,y) 落子是否构成禁手。
 *
 * 调用方需保证：(x,y) 为空、轮到黑棋走。
 * 返回 forbidden=false 表示合法；forbidden=true 时 kind 给出禁手类型。
 */
export function checkForbidden(
  board: Cell[][],
  x: number,
  y: number,
  size: number,
): ForbiddenResult {
  if (board[y][x] !== 0) return OK

  // 试落黑子，结束后必定还原
  board[y][x] = BLACK
  try {
    const center = CENTER
    const lines = DIRS.map(([dx, dy]) => lineAround(board, x, y, dx, dy, size))

    // ---- 1. 五连优先：恰好成五即为胜着，禁手失效 ----
    if (lines.some((line) => isFive(line, center))) return OK

    // ---- 2. 长连禁手 ----
    if (lines.some((line) => isOverline(line, center))) {
      return { forbidden: true, kind: 'overline' }
    }

    // ---- 3. 四四禁手：两个及以上方向成四 ----
    let fours = 0
    for (const line of lines) {
      if (isFour(line, center)) fours++
    }
    if (fours >= 2) return { forbidden: true, kind: 'double-four' }

    // ---- 4. 三三禁手：两个及以上方向成活三 ----
    let threes = 0
    for (const line of lines) {
      if (isOpenThree(line, center)) threes++
    }
    if (threes >= 2) return { forbidden: true, kind: 'double-three' }

    return OK
  } finally {
    board[y][x] = 0
  }
}

/** 禁手类型的中文说明，供界面提示 */
export const FORBIDDEN_TEXT: Record<ForbiddenKind, string> = {
  'double-three': '三三禁手',
  'double-four': '四四禁手',
  overline: '长连禁手',
}
