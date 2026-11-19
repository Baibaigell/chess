/**
 * 中国象棋引擎。
 *
 * 坐标系：x 为列 0..8（左→右），y 为行 0..9（上→下）。
 * y=0..4 是黑方半场，y=5..9 是红方半场，中间河界在 y=4 与 y=5 之间。
 *
 * 红方在下方（y 较大），向上走；黑方在上方，向下走。
 *
 * 规则要点：
 * - 将/帅：九宫内直走一步；「飞将」——两将同一列且中间无子时可直接吃将
 * - 士/仕：九宫内斜走一步
 * - 象/相：走「田」字，不能过河，象眼被堵不能走
 * - 马：走「日」字，马腿被堵不能走
 * - 车：直线任意距离
 * - 炮：不吃子时同车；吃子时中间必须恰好隔一个棋子（翻山）
 * - 兵/卒：未过河只能前进；过河后可左右走
 *
 * 胜负：将/帅被吃（含飞将），或一方无任何合法着法（困毙，判负）。
 */
import type { Move, MoveRecord, GameEngine } from '../../core/types'
import type { GameResult } from '../../core/result'
import { GameStatus, ONGOING, TerminationReason } from '../../core/result'

const COLS = 9
const ROWS = 10

/** 棋子类型：k 将帅、a 士仕、b 象相、n 马、r 车、c 炮、p 兵卒 */
type Kind = 'k' | 'a' | 'b' | 'n' | 'r' | 'c' | 'p'

/** 阵营：r 红、b 黑 */
type Side = 'r' | 'b'

interface Piece {
  kind: Kind
  side: Side
}

/** 各阵营棋子的汉字，索引为 kind */
const HANZI: Record<Side, Record<Kind, string>> = {
  b: { k: '將', a: '士', b: '象', n: '馬', r: '車', c: '砲', p: '卒' },
  r: { k: '帥', a: '仕', b: '相', n: '傌', r: '俥', c: '炮', p: '兵' },
}

/**
 * 初始布局，从上到下逐行写。
 * 用字符表示：「.」空，小写为黑方，大写为红方。
 */
const INITIAL_ROWS: string[] = [
  'rnbakabnr',
  '.........',
  '.c.....c.',
  'p.p.p.p.p',
  '.........',
  '.........',
  'P.P.P.P.P',
  '.C.....C.',
  '.........',
  'RNBAKABNR',
]

export class XiangqiEngine implements GameEngine {
  /** board[y][x] */
  private board: (Piece | null)[][] = []
  private currentTurn: Side = 'r'
  private records: MoveRecord[] = []

  constructor(position?: string) {
    this.reset()
    if (position) this.decode(position)
  }

  private reset(): void {
    this.board = Array.from({ length: ROWS }, () => Array<Piece | null>(COLS).fill(null))
    INITIAL_ROWS.forEach((row, y) => {
      for (let x = 0; x < COLS; x++) {
        const ch = row[x]
        if (ch === '.') continue
        this.board[y][x] = {
          kind: ch.toLowerCase() as Kind,
          side: ch === ch.toUpperCase() ? 'r' : 'b',
        }
      }
    })
    this.currentTurn = 'r'
    this.records = []
  }

  /** "a1" → {x,y}，x 取 a..i，y 取 1..10 */
  private parseSquare(square: string): { x: number; y: number } | null {
    const m = /^([a-i])(\d{1,2})$/.exec(square)
    if (!m) return null
    const x = m[1].charCodeAt(0) - 97
    const y = Number(m[2]) - 1
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return null
    return { x, y }
  }

  private toSquare(x: number, y: number): string {
    return `${String.fromCharCode(97 + x)}${y + 1}`
  }

  private at(x: number, y: number): Piece | null {
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return null
    return this.board[y][x]
  }

  /** 九宫范围：红在 y=7..9，黑在 y=0..2，x 恒为 3..5 */
  private inPalace(x: number, y: number, side: Side): boolean {
    if (x < 3 || x > 5) return false
    return side === 'r' ? y >= 7 && y <= 9 : y >= 0 && y <= 2
  }

  turn(): string {
    return this.currentTurn
  }

  legalMoves(): Move[] {
    const out: Move[] = []
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const p = this.board[y][x]
        if (!p || p.side !== this.currentTurn) continue
        for (const m of this.pseudoMoves(x, y, false)) {
          // 过滤掉会让己方被将军的着法（含送将、飞将）
          if (this.wouldExposeOwnKing(x, y, m.x, m.y)) continue
          out.push({ from: this.toSquare(x, y), to: this.toSquare(m.x, m.y) })
        }
      }
    }
    return out
  }

  /**
   * 某棋子的伪合法着法。
   * allowKingTarget 为 true 时允许「吃到对方将/帅」，用于判断将军。
   */
  private pseudoMoves(
    x: number,
    y: number,
    allowKingTarget: boolean,
  ): Array<{ x: number; y: number; captured: Piece | null }> {
    const piece = this.at(x, y)
    if (!piece) return []
    const { kind, side } = piece
    const out: Array<{ x: number; y: number; captured: Piece | null }> = []

    /** 尝试落到 (tx,ty)；返回 true 表示可以继续延伸（未碰到子） */
    const tryTo = (tx: number, ty: number): boolean => {
      if (tx < 0 || tx >= COLS || ty < 0 || ty >= ROWS) return false
      const target = this.board[ty][tx]
      if (!target) {
        out.push({ x: tx, y: ty, captured: null })
        return true
      }
      if (target.side !== side) {
        // 吃子：对方将帅只有在允许时才作为目标（正常走子时吃将即胜）
        if (target.kind !== 'k' || allowKingTarget || true) {
          out.push({ x: tx, y: ty, captured: target })
        }
      }
      return false
    }

    const forward = side === 'r' ? -1 : 1

    switch (kind) {
      // 将 / 帅
      case 'k': {
        for (const [dx, dy] of [
          [0, 1],
          [0, -1],
          [1, 0],
          [-1, 0],
        ] as const) {
          const nx = x + dx
          const ny = y + dy
          if (this.inPalace(nx, ny, side)) tryTo(nx, ny)
        }
        // 飞将：同列直线前进，若第一个遇到的子是对方将帅则可直接吃
        let cy = y + forward
        while (cy >= 0 && cy < ROWS) {
          const p = this.at(x, cy)
          if (p) {
            if (p.kind === 'k' && p.side !== side) {
              out.push({ x, y: cy, captured: p })
            }
            break
          }
          cy += forward
        }
        break
      }

      // 士 / 仕
      case 'a': {
        for (const [dx, dy] of [
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ] as const) {
          const nx = x + dx
          const ny = y + dy
          if (this.inPalace(nx, ny, side)) tryTo(nx, ny)
        }
        break
      }

      // 象 / 相：走田字，不过河，象眼不能有子
      case 'b': {
        for (const [dx, dy] of [
          [2, 2],
          [2, -2],
          [-2, 2],
          [-2, -2],
        ] as const) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue
          // 不能过河：红必须 y>=5，黑必须 y<=4
          if (side === 'r' ? ny < 5 : ny > 4) continue
          // 象眼
          if (this.at(x + dx / 2, y + dy / 2)) continue
          tryTo(nx, ny)
        }
        break
      }

      // 马：走日字，马腿不能有子
      case 'n': {
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
          if (this.at(x + bx, y + by)) continue // 马腿被堵
          tryTo(nx, ny)
        }
        break
      }

      // 车：直线任意距离
      case 'r': {
        for (const [dx, dy] of [
          [0, 1],
          [0, -1],
          [1, 0],
          [-1, 0],
        ] as const) {
          let step = 1
          while (true) {
            const nx = x + dx * step
            const ny = y + dy * step
            if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) break
            if (!tryTo(nx, ny)) break
            step++
          }
        }
        break
      }

      // 炮：不吃子同车；吃子必须隔一个子
      case 'c': {
        for (const [dx, dy] of [
          [0, 1],
          [0, -1],
          [1, 0],
          [-1, 0],
        ] as const) {
          let step = 1
          let screen = false // 是否已翻过炮架
          while (true) {
            const nx = x + dx * step
            const ny = y + dy * step
            if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) break
            const target = this.at(nx, ny)
            if (!screen) {
              if (!target) {
                out.push({ x: nx, y: ny, captured: null })
              } else {
                screen = true // 碰到炮架
              }
            } else if (target) {
              if (target.side !== side) {
                out.push({ x: nx, y: ny, captured: target })
              }
              break
            }
            step++
          }
        }
        break
      }

      // 兵 / 卒
      case 'p': {
        tryTo(x, y + forward)
        // 过河后才能左右走
        const crossed = side === 'r' ? y <= 4 : y >= 5
        if (crossed) {
          tryTo(x - 1, y)
          tryTo(x + 1, y)
        }
        break
      }
    }

    return out
  }

  /** 找出某方将帅位置 */
  private findKing(side: Side): { x: number; y: number } | null {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const p = this.board[y][x]
        if (p && p.kind === 'k' && p.side === side) return { x, y }
      }
    }
    return null
  }

  /** 某方是否正被将军（含飞将） */
  private isSideInCheck(side: Side): boolean {
    const king = this.findKing(side)
    if (!king) return true // 将被吃，视为被将军
    const other: Side = side === 'r' ? 'b' : 'r'

    // 飞将：两将同列且中间无子，直接视为被将军
    const otherKing = this.findKing(other)
    if (otherKing && otherKing.x === king.x) {
      const lo = Math.min(otherKing.y, king.y)
      const hi = Math.max(otherKing.y, king.y)
      let blocked = false
      for (let y = lo + 1; y < hi; y++) {
        if (this.board[y][king.x]) {
          blocked = true
          break
        }
      }
      if (!blocked) return true
    }

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const p = this.board[y][x]
        if (!p || p.side !== other) continue
        const moves = this.pseudoMoves(x, y, true)
        if (moves.some((m) => m.x === king.x && m.y === king.y)) return true
      }
    }
    return false
  }

  /** 试走一步后，己方是否被将军（用于过滤非法着法） */
  private wouldExposeOwnKing(fx: number, fy: number, tx: number, ty: number): boolean {
    const piece = this.board[fy][fx]
    if (!piece) return false
    const target = this.board[ty][tx]
    this.board[ty][tx] = piece
    this.board[fy][fx] = null
    const bad = this.isSideInCheck(piece.side)
    this.board[fy][fx] = piece
    this.board[ty][tx] = target
    return bad
  }

  applyMove(move: Move): MoveRecord {
    const from = this.parseSquare(move.from)
    const to = this.parseSquare(move.to)
    if (!from || !to) throw new Error(`非法坐标: ${move.from}→${move.to}`)

    const piece = this.board[from.y][from.x]
    if (!piece) throw new Error(`起点无棋子: ${move.from}`)
    if (piece.side !== this.currentTurn) throw new Error('未轮到该方走子')

    const legal = this.legalMoves()
    if (!legal.some((m) => m.from === move.from && m.to === move.to)) {
      throw new Error(`非法着法: ${move.from}→${move.to}`)
    }

    const target = this.board[to.y][to.x]
    const captured = target ? target.kind : undefined

    this.board[to.y][to.x] = piece
    this.board[from.y][from.x] = null

    // 记谱：汉字棋子 + 起止坐标，便于阅读
    const san = `${HANZI[piece.side][piece.kind]}${move.from}-${move.to}`
    const record: MoveRecord = {
      move: { from: move.from, to: move.to },
      san,
      position: this.encode(),
      ...(captured ? { captured } : {}),
    }
    this.records.push(record)

    // 将被吃：直接判终局
    if (captured === 'k') return record

    this.currentTurn = piece.side === 'r' ? 'b' : 'r'
    return record
  }

  undoMove(): MoveRecord | null {
    const last = this.records[this.records.length - 1]
    if (!last) return null
    const from = this.parseSquare(last.move.from)
    const to = this.parseSquare(last.move.to)
    if (from && to) {
      const moved = this.board[to.y][to.x]
      this.board[from.y][from.x] = moved
      this.board[to.y][to.x] = last.captured
        ? { kind: last.captured as Kind, side: moved?.side === 'r' ? 'b' : 'r' }
        : null
    }
    this.records.pop()
    this.currentTurn = (this.records.length % 2 === 0 ? 'r' : 'b') as Side
    return last
  }

  result(): GameResult {
    const last = this.records[this.records.length - 1]
    // 将帅被吃
    if (last?.captured === 'k') {
      const mover: Side = this.records.length % 2 === 1 ? 'r' : 'b'
      return {
        status: mover === 'r' ? GameStatus.FirstWin : GameStatus.SecondWin,
        reason: TerminationReason.Checkmate,
      }
    }

    // 困毙：当前走子方无任何合法着法，判负
    let hasMove = false
    for (let y = 0; y < ROWS && !hasMove; y++) {
      for (let x = 0; x < COLS && !hasMove; x++) {
        const p = this.board[y][x]
        if (!p || p.side !== this.currentTurn) continue
        for (const m of this.pseudoMoves(x, y, false)) {
          if (!this.wouldExposeOwnKing(x, y, m.x, m.y)) {
            hasMove = true
            break
          }
        }
      }
    }
    if (hasMove) return ONGOING

    return {
      status: this.currentTurn === 'r' ? GameStatus.SecondWin : GameStatus.FirstWin,
      reason: TerminationReason.Stalemate,
    }
  }

  isCheck(): boolean {
    return this.isSideInCheck(this.currentTurn)
  }

  history(): MoveRecord[] {
    return [...this.records]
  }

  /**
   * 编码为紧凑字符串：每行 9 个字符，「.」空，小写黑方、大写红方，
   * 行间用「/」分隔，末尾附走子方：「rnbakabnr/.../RNBAKABNR r」。
   */
  encode(): string {
    const rows = this.board.map((row) =>
      row
        .map((p) => {
          if (!p) return '.'
          const ch = p.kind
          return p.side === 'r' ? ch.toUpperCase() : ch
        })
        .join(''),
    )
    return `${rows.join('/')} ${this.currentTurn}`
  }

  decode(state: string): void {
    this.reset()
    const [boardPart, turnPart] = state.split(' ')
    if (!boardPart) return
    const rows = boardPart.split('/')
    this.board = Array.from({ length: ROWS }, () => Array<Piece | null>(COLS).fill(null))
    rows.forEach((row, y) => {
      if (y >= ROWS) return
      for (let x = 0; x < COLS && x < row.length; x++) {
        const ch = row[x]
        if (ch === '.') continue
        this.board[y][x] = {
          kind: ch.toLowerCase() as Kind,
          side: ch === ch.toUpperCase() ? 'r' : 'b',
        }
      }
    })
    if (turnPart === 'r' || turnPart === 'b') this.currentTurn = turnPart
  }

  position(): string {
    return this.encode()
  }

  /** 供 GridBoard 渲染：每格返回汉字与阵营 */
  cellsView(): Array<Array<{ text: string; side: string } | null>> {
    return this.board.map((row) =>
      row.map((p) => (p ? { text: HANZI[p.side][p.kind], side: p.side } : null)),
    )
  }
}
