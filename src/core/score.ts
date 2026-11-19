/**
 * 棋子价值与吃子计分。
 *
 * 各棋种的棋子代号与价值不同，因此价值表按棋种 id 分开。
 * 国际象棋：兵 1、马/象 3、车 5、后 9（王不计分）
 * 中国象棋：兵 1、士/象 2、马 4、炮 4.5、车 9（将帅不计分）
 * 五子棋：没有吃子，因此没有价值表
 */
import type { MoveRecord } from './types'

/** 棋子代号到分数的映射 */
export type PieceValueTable = Record<string, number>

/** 国际象棋（chess.js 用小写字母） */
const CHESS_VALUE: PieceValueTable = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
}

/**
 * 中国象棋（本项目的引擎用 k/a/b/n/r/c/p）。
 * 采用通行估分，炮略高于马。
 */
const XIANGQI_VALUE: PieceValueTable = {
  p: 1,
  a: 2,
  b: 2,
  n: 4,
  c: 4.5,
  r: 9,
  k: 0,
}

/** 棋种 id → 价值表；表中没有的棋种表示不计分 */
const VALUE_TABLES: Record<string, PieceValueTable> = {
  chess: CHESS_VALUE,
  xiangqi: XIANGQI_VALUE,
}

/** 取某个棋种的价值表；五子棋等无吃子棋种返回空表 */
export function valueTableFor(gameId: string | null): PieceValueTable {
  if (!gameId) return {}
  return VALUE_TABLES[gameId] ?? {}
}

/** 该棋种是否有吃子计分 */
export function hasScoring(gameId: string | null): boolean {
  return Object.keys(valueTableFor(gameId)).length > 0
}

/** 棋子代号到中文名（国际象棋） */
export const PIECE_NAME: Record<string, string> = {
  p: '兵',
  n: '马',
  b: '象',
  r: '车',
  q: '后',
  k: '王',
}

export interface Score {
  /** 先行方累计吃子分 */
  first: number
  /** 后行方累计吃子分 */
  second: number
  /** 净分差（先行 - 后行），正数表示先行方占优 */
  advantage: number
}

/**
 * 由着法历史计算双方吃子得分。
 *
 * 着法记录按时间顺序排列，偶数索引（0、2、4…）为先行方所走，
 * 奇数索引（1、3、5…）为后行方所走，因此用索引奇偶判断得分归属。
 */
export function computeScore(history: MoveRecord[], gameId: string | null): Score {
  const table = valueTableFor(gameId)
  let first = 0
  let second = 0

  history.forEach((rec, i) => {
    if (!rec.captured) return
    const value = table[rec.captured] ?? 0
    if (i % 2 === 0) first += value
    else second += value
  })

  return { first, second, advantage: first - second }
}

/** 把分值格式化为带正负号的字符串，如 "+3" / "-9" / "0" */
export function formatAdvantage(advantage: number): string {
  // 象棋有 4.5 这样的半分值，需要保留一位小数
  const rounded = Math.round(advantage * 10) / 10
  if (rounded > 0) return `+${rounded}`
  return String(rounded)
}
