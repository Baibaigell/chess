/**
 * 棋种无关的对局引擎接口。
 *
 * 所有棋种都实现这一组方法，UI 与 AI 只依赖这里，
 * 不直接接触具体规则库（如 chess.js）。
 */

import type { GameResult } from './result'

/** 棋盘坐标，如 "e2"。各棋种自行定义坐标系含义。 */
export type Square = string

/** 一步棋。部分棋种需要额外字段（如升变），放在 promotion 中。 */
export interface Move {
  from: Square
  to: Square
  /** 升变为哪种棋子，只有需要升变的棋种才会给出 */
  promotion?: string
}

/** 走完一步后的着法记录，供界面显示着法列表。 */
export interface MoveRecord {
  move: Move
  /** 标准记谱，如 "Nf3"；不支持的棋种可留空 */
  san: string
  /** 该着法执行后的局面快照 */
  position: string
  /** 该着法吃掉的棋子（如 "p" / "q"），未吃子则无此字段 */
  captured?: string
}

export interface GameEngine {
  /** 当前该谁走子："w" / "b"，或棋种自定义的阵营标识 */
  turn(): string

  /** 当前全部合法着法 */
  legalMoves(): Move[]

  /** 执行一步棋；非法着法必须抛出错误，不得静默失败 */
  applyMove(move: Move): MoveRecord

  /** 撤销最后一步；没有可撤销的着法时返回 null */
  undoMove(): MoveRecord | null

  /** 当前局面的对局结果，未结束时返回进行中 */
  result(): GameResult

  /** 当前走子方是否正被将军 */
  isCheck(): boolean

  /** 完整对局着法记录 */
  history(): MoveRecord[]

  /** 序列化为可存档的字符串 */
  encode(): string

  /** 从序列化字符串恢复局面 */
  decode(state: string): void

  /** 当前局面快照（国际象棋为 FEN） */
  position(): string

  /**
   * 供自绘网格棋盘使用的二维显示单元。
   *
   * 只对 renderer 为 'grid' 的棋种有意义（象棋、五子棋）。
   * 返回值按 [y][x] 组织；两行代码即可实现，不由各棋种强依赖。
   */
  cellsView?(): Array<Array<{ text: string; side: string } | null>>
}
