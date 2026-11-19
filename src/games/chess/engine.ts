/**
 * 把 chess.js 适配成 GameEngine。
 *
 * chess.js 1.x 的注意点：
 * - moves() 默认返回 SAN 字符串，取着法对象要传 { verbose: true }
 * - move() 接受 SAN 或 { from, to, promotion }，非法着法会抛异常
 * - fen() 用于局面快照，load() 用于从 FEN 恢复
 */
import { Chess } from 'chess.js'
import type { Move, MoveRecord, GameEngine } from '../../core/types'
import type { GameResult } from '../../core/result'
import {
  GameStatus,
  ONGOING,
  TerminationReason,
} from '../../core/result'

/** chess.js verbose 着法的字段子集 */
interface VerboseMove {
  color: string
  from: string
  to: string
  san: string
  promotion?: string
  captured?: string
  after: string
}

export class ChessEngine implements GameEngine {
  private game: Chess
  private records: MoveRecord[] = []

  constructor(position?: string) {
    this.game = position ? new Chess(position) : new Chess()
  }

  turn(): string {
    return this.game.turn()
  }

  legalMoves(): Move[] {
    const verbose = this.game.moves({ verbose: true }) as VerboseMove[]
    return verbose.map((m) => {
      const move: Move = { from: m.from, to: m.to }
      if (m.promotion) move.promotion = m.promotion
      return move
    })
  }

  applyMove(move: Move): MoveRecord {
    // chess.js 对非法着法抛异常，交由调用方处理，不静默吞掉
    const applied = this.game.move({
      from: move.from,
      to: move.to,
      ...(move.promotion ? { promotion: move.promotion } : {}),
    }) as VerboseMove

    const record: MoveRecord = {
      move: {
        from: applied.from,
        to: applied.to,
        ...(applied.promotion ? { promotion: applied.promotion } : {}),
      },
      san: applied.san,
      position: applied.after,
      ...(applied.captured ? { captured: applied.captured } : {}),
    }
    this.records.push(record)
    return record
  }

  undoMove(): MoveRecord | null {
    if (this.records.length === 0) return null
    this.game.undo()
    return this.records.pop() ?? null
  }

  result(): GameResult {
    if (!this.game.isGameOver()) return ONGOING

    if (this.game.isCheckmate()) {
      // 将杀时轮到走子的一方是被将死的一方
      return {
        status:
          this.game.turn() === 'w' ? GameStatus.SecondWin : GameStatus.FirstWin,
        reason: TerminationReason.Checkmate,
      }
    }
    if (this.game.isStalemate()) {
      return {
        status: GameStatus.Draw,
        reason: TerminationReason.Stalemate,
      }
    }
    if (this.game.isInsufficientMaterial()) {
      return {
        status: GameStatus.Draw,
        reason: TerminationReason.InsufficientMaterial,
      }
    }
    if (this.game.isThreefoldRepetition()) {
      return {
        status: GameStatus.Draw,
        reason: TerminationReason.ThreefoldRepetition,
      }
    }
    if (this.game.isDrawByFiftyMoves()) {
      return {
        status: GameStatus.Draw,
        reason: TerminationReason.FiftyMoveRule,
      }
    }
    // 兜底：chess.js 判为结束但上面都不匹配
    return { status: GameStatus.Draw, reason: null }
  }

  history(): MoveRecord[] {
    return [...this.records]
  }

  isCheck(): boolean {
    return this.game.isCheck()
  }

  encode(): string {
    // FEN 后半段（轮次、易位权、吃过路兵、回合数）已包含全部必要状态
    return this.game.fen()
  }

  decode(state: string): void {
    this.game = new Chess(state)
    this.records = []
  }

  position(): string {
    return this.game.fen()
  }

  /** 供测试与调试：底层 chess.js 实例 */
  get raw(): Chess {
    return this.game
  }
}
