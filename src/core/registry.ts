/**
 * 棋种注册表。
 *
 * 当前注册三个棋种：国际象棋、中国象棋、五子棋。
 * 新增棋种只需在这里加一行，UI 通过 getAll() 自动列出。
 */
import type { GameMeta } from './meta'
import { UnsupportedGameError } from './meta'
import type { GameEngine } from './types'
import { chessMeta } from '../games/chess/meta'
import { ChessEngine } from '../games/chess/engine'
import { xiangqiMeta } from '../games/xiangqi/meta'
import { XiangqiEngine } from '../games/xiangqi/engine'
import { gomokuMeta } from '../games/gomoku/meta'
import { GomokuEngine } from '../games/gomoku/engine'

export interface GameEntry {
  meta: GameMeta
  /** 创建一个初始局面的引擎实例 */
  create(): GameEngine
  /**
   * 带选项创建引擎（可选）。
   * 只有需要开局前配置的棋种才提供，如五子棋的禁手开关。
   * 未提供时调用方应回退到 create()。
   */
  createWithOptions?(options: Record<string, unknown>): GameEngine
}

const registry = new Map<string, GameEntry>()

/** 注册一个棋种；重复注册同一 id 会抛错，便于早期发现冲突 */
export function register(entry: GameEntry): void {
  if (registry.has(entry.meta.id)) {
    throw new Error(`棋种重复注册: ${entry.meta.id}`)
  }
  registry.set(entry.meta.id, entry)
}

/** 按 id 取棋种，不存在时抛 UnsupportedGameError */
export function get(gameId: string): GameEntry {
  const entry = registry.get(gameId)
  if (!entry) throw new UnsupportedGameError(gameId)
  return entry
}

/** 全部已注册棋种，按注册顺序 */
export function getAll(): GameEntry[] {
  return [...registry.values()]
}

/** 是否存在该棋种 */
export function has(gameId: string): boolean {
  return registry.has(gameId)
}

// ---- 已注册棋种 ----

register({
  meta: chessMeta,
  create: () => new ChessEngine(),
})

register({
  meta: xiangqiMeta,
  create: () => new XiangqiEngine(),
})

register({
  meta: gomokuMeta,
  create: () => new GomokuEngine(),
  // 五子棋支持开局前开启黑棋禁手
  createWithOptions: (options) =>
    new GomokuEngine(undefined, { forbidden: options.forbidden === true }),
})
