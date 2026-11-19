/**
 * 五子棋引擎。
 *
 * 五子棋与国际象棋的差别：
 * - 没有「走子」，只有「落子」，棋盘点一旦占据就不再变化
 * - 没有吃子，因此没有子力价值
 * - 没有将军概念
 * - 胜负只有两种：连成五子，或棋盘下满
 *
 * 局面编码用「坐标串」表示：每个子写成 颜色+x+y 的四字符片段，
 * 例如 "b7,7w8,8" 表示黑在 (7,7)、白在 (8,8)。
 * 不使用 FEN，因为五子棋没有 FEN 标准。
 *
 * 禁手：通过构造参数开启「黑棋禁手」规则（三三、四四、长连）。
 * 开启后，构成禁手的点不是黑棋的合法着法——黑棋点不下去，
 * 界面会给出提示。白棋无禁手。规则实现见 forbidden.ts。
 */
import type { Move, MoveRecord, GameEngine } from '../../core/types'
import type { GameResult } from '../../core/result'
import { GameStatus, ONGOING, TerminationReason } from '../../core/result'
import { checkForbidden, FORBIDDEN_TEXT } from './forbidden'
import type { Cell as FCell } from './forbidden'

/** 棋盘边长，改动需同步 meta.ts 的 width/height */
const SIZE = 15

/** 单格内容：null 表示空，'b' 黑子，'w' 白子 */
type Cell = 'b' | 'w' | null

/** 四方向：横、竖、左上-右下、右上-左下 */
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
]

/** 连成几子获胜 */
const WIN_LEN = 5

/** 引擎构造选项 */
export interface GomokuOptions {
  /** 是否开启黑棋禁手（三三、四四、长连），默认关闭 */
  forbidden?: boolean
}

export class GomokuEngine implements GameEngine {
  /** board[y][x] */
  private board: Cell[][] = []
  private currentTurn: 'b' | 'w' = 'b'
  private records: MoveRecord[] = []
  /** 棋盘是否已下满且无人获胜 */
  private full = false
  /** 是否启用黑棋禁手规则 */
  private forbiddenRule = false

  constructor(position?: string, options: GomokuOptions = {}) {
    this.forbiddenRule = options.forbidden === true
    this.reset()
    if (position) this.decode(position)
  }

  private reset(): void {
    this.board = Array.from({ length: SIZE }, () => Array<Cell>(SIZE).fill(null))
    this.currentTurn = 'b'
    this.records = []
    this.full = false
  }

  /** 是否启用禁手规则 */
  isForbiddenRule(): boolean {
    return this.forbiddenRule
  }

  /** 运行期切换禁手规则（仅在开局前调用才有意义） */
  setForbiddenRule(on: boolean): void {
    this.forbiddenRule = on
  }

  /** 把 "a1" 这样的坐标解析为 {x,y}；越界或格式不对返回 null */
  private parseSquare(square: string): { x: number; y: number } | null {
    const m = /^([a-o])(\d{1,2})$/.exec(square)
    if (!m) return null
    const x = m[1].charCodeAt(0) - 97
    const y = Number(m[2]) - 1
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return null
    return { x, y }
  }

  /** {x,y} 转回 "a1" 形式的坐标 */
  private toSquare(x: number, y: number): string {
    return `${String.fromCharCode(97 + x)}${y + 1}`
  }

  /**
   * 把内部棋盘转成禁手判定用的数字棋盘。
   * 0 空、1 黑、2 白。每次调用都新建，避免判定逻辑改动内部状态。
   */
  private toNumericBoard(): FCell[][] {
    return this.board.map((row) =>
      row.map((c) => (c === 'b' ? 1 : c === 'w' ? 2 : 0) as FCell),
    )
  }

  /**
   * 某个空点对当前走子方是否为禁手。
   * 白棋永远不是禁手；未开启规则时永远不是禁手。
   */
  isForbiddenPoint(x: number, y: number): boolean {
    if (!this.forbiddenRule) return false
    if (this.currentTurn !== 'b') return false
    if (this.board[y][x] !== null) return false
    const numeric = this.toNumericBoard()
    return checkForbidden(numeric, x, y, SIZE).forbidden
  }

  /** 取某个点的禁手类型说明，供界面提示；非禁手返回 null */
  forbiddenReasonAt(square: string): string | null {
    if (!this.forbiddenRule || this.currentTurn !== 'b') return null
    const p = this.parseSquare(square)
    if (!p || this.board[p.y][p.x] !== null) return null
    const numeric = this.toNumericBoard()
    const res = checkForbidden(numeric, p.x, p.y, SIZE)
    if (!res.forbidden || !res.kind) return null
    return FORBIDDEN_TEXT[res.kind]
  }

  turn(): string {
    return this.currentTurn
  }

  /**
   * 五子棋的「合法着法」是全部空点，开启禁手时排除黑棋的禁手点。
   * 返回完整空点列表，供界面计算可落子的格子。
   *
   * 注意：15×15 下最多 225 条，界面每帧都会调用，
   * 因此只在开启禁手时才做逐点判定。
   */
  legalMoves(): Move[] {
    if (this.result().status !== GameStatus.Ongoing) return []
    const moves: Move[] = []
    // 开启禁手且轮到黑棋时，需要一份数字棋盘做判定
    const numeric =
      this.forbiddenRule && this.currentTurn === 'b'
        ? this.toNumericBoard()
        : null

    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (this.board[y][x] !== null) continue
        if (numeric && checkForbidden(numeric, x, y, SIZE).forbidden) continue
        const sq = this.toSquare(x, y)
        moves.push({ from: sq, to: sq })
      }
    }
    return moves
  }

  applyMove(move: Move): MoveRecord {
    const to = this.parseSquare(move.to)
    if (!to) throw new Error(`非法坐标: ${move.to}`)
    if (this.result().status !== GameStatus.Ongoing) {
      throw new Error('对局已结束')
    }
    if (this.board[to.y][to.x] !== null) {
      throw new Error(`该点已有棋子: ${move.to}`)
    }

    const color = this.currentTurn

    // 黑棋禁手校验：开启规则时禁手点不允许落子
    if (this.forbiddenRule && color === 'b') {
      const res = checkForbidden(this.toNumericBoard(), to.x, to.y, SIZE)
      if (res.forbidden && res.kind) {
        throw new Error(`禁手：${FORBIDDEN_TEXT[res.kind]}，不能在此落子`)
      }
    }

    this.board[to.y][to.x] = color

    const san = `${color === 'b' ? '黑' : '白'}${move.to}`
    const record: MoveRecord = {
      move: { from: move.to, to: move.to },
      san,
      position: this.encode(),
    }
    this.records.push(record)

    // 判定胜负：先看是否连五，再看是否下满
    if (!this.hasFiveAt(to.x, to.y)) {
      if (this.isFull()) {
        this.full = true
      } else {
        this.currentTurn = color === 'b' ? 'w' : 'b'
      }
    } else {
      // 有胜者时不再切换轮次，结果由 result() 推导
      this.full = false
    }

    return record
  }

  undoMove(): MoveRecord | null {
    const last = this.records[this.records.length - 1]
    if (!last) return null
    const p = this.parseSquare(last.move.to)
    if (p) this.board[p.y][p.x] = null
    this.records.pop()
    // 撤销后恢复轮次：撤销的是谁的子，就轮到谁
    this.currentTurn = (this.records.length % 2 === 0 ? 'b' : 'w') as 'b' | 'w'
    this.full = false
    return last
  }

  /** 以 (x,y) 为中心，检查四个方向是否已有五连（六子及以上也算赢） */
  private hasFiveAt(x: number, y: number): boolean {
    const color = this.board[y][x]
    if (!color) return false
    for (const [dx, dy] of DIRECTIONS) {
      let count = 1
      // 正向
      for (let step = 1; step < SIZE; step++) {
        const nx = x + dx * step
        const ny = y + dy * step
        if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE) break
        if (this.board[ny][nx] !== color) break
        count++
      }
      // 反向
      for (let step = 1; step < SIZE; step++) {
        const nx = x - dx * step
        const ny = y - dy * step
        if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE) break
        if (this.board[ny][nx] !== color) break
        count++
      }
      if (count >= WIN_LEN) return true
    }
    return false
  }

  private isFull(): boolean {
    return this.board.every((row) => row.every((c) => c !== null))
  }

  result(): GameResult {
    const last = this.records[this.records.length - 1]
    if (last) {
      const p = this.parseSquare(last.move.to)
      if (p && this.hasFiveAt(p.x, p.y)) {
        const color = this.board[p.y][p.x]
        return {
          status: color === 'b' ? GameStatus.FirstWin : GameStatus.SecondWin,
          reason: TerminationReason.FiveInRow,
        }
      }
    }
    if (this.full) {
      return { status: GameStatus.Draw, reason: TerminationReason.BoardFull }
    }
    return ONGOING
  }

  /** 五子棋没有将军 */
  isCheck(): boolean {
    return false
  }

  history(): MoveRecord[] {
    return [...this.records]
  }

  /**
   * 编码为坐标串："b7,7w8,8"。
   * 空棋盘返回空串，与 meta.initialPosition 一致。
   */
  encode(): string {
    return this.records
      .map((r) => {
        const c = r.san.startsWith('黑') ? 'b' : 'w'
        return `${c}${r.move.to}`
      })
      .join(',')
  }

  decode(state: string): void {
    this.reset()
    if (!state) return
    for (const token of state.split(',')) {
      const m = /^([bw])([a-o]\d{1,2})$/.exec(token)
      if (!m) continue
      const p = this.parseSquare(m[2])
      if (!p) continue
      this.board[p.y][p.x] = m[1] as Cell
      this.records.push({
        move: { from: m[2], to: m[2] },
        san: `${m[1] === 'b' ? '黑' : '白'}${m[2]}`,
        position: '',
      })
    }
    // 按落子数推导轮次
    this.currentTurn = this.records.length % 2 === 0 ? 'b' : 'w'
    this.full = this.isFull() && this.result().status === GameStatus.Ongoing
    // 回填每步的局面快照
    let acc = ''
    this.records.forEach((r) => {
      const c = r.san.startsWith('黑') ? 'b' : 'w'
      acc = acc ? `${acc},${c}${r.move.to}` : `${c}${r.move.to}`
      r.position = acc
    })
  }

  position(): string {
    return this.encode()
  }

  /** 供 GridBoard 渲染：每格返回阵营（五子棋无棋子文字，用圆点绘制） */
  cellsView(): Array<Array<{ text: string; side: string } | null>> {
    return this.board.map((row) =>
      row.map((c) => (c ? { text: '', side: c } : null)),
    )
  }
}
