/**
 * 按棋种分发 AI 引擎。
 *
 * 三个棋种各有独立的 AI 实现，接口统一为 AiEngine：
 * - 国际象棋 → Stockfish（Web Worker，UCI 协议）
 * - 中国象棋 → 自研 Alpha-Beta 搜索
 * - 五子棋   → 自研棋形评估 + 浅层搜索
 *
 * 为什么要这一层：GameScreen 只知道「当前棋种」，不该关心背后是
 * Worker 还是纯 JS 搜索。把选择逻辑收在这里，新增棋种时只改这一个文件。
 *
 * 实例缓存：象棋与五子棋的 AI 无跨局状态，全局复用一个即可；
 * Stockfish 内部已有单例，这里直接转发。
 */
import type { AiEngine, ThinkOptions } from './types'
import type { Move } from '../core/types'
import { getStockfish } from './stockfish'
import { XiangqiAi } from './xiangqi-ai'
import { GomokuAi } from './gomoku-ai'

/** 棋种 id → AI 实例的惰性缓存 */
const instances = new Map<string, AiEngine>()

/** 该棋种是否有可用的 AI */
export function hasAi(gameId: string): boolean {
  return gameId === 'chess' || gameId === 'xiangqi' || gameId === 'gomoku'
}

/** 取某棋种的 AI 实例；无 AI 的棋种返回 null */
export function getAi(gameId: string): AiEngine | null {
  const cached = instances.get(gameId)
  if (cached) return cached

  let engine: AiEngine | null = null
  switch (gameId) {
    case 'chess':
      engine = getStockfish()
      break
    case 'xiangqi':
      engine = new XiangqiAi()
      break
    case 'gomoku':
      engine = new GomokuAi()
      break
    default:
      return null
  }

  instances.set(gameId, engine)
  return engine
}

/**
 * 统一的思考入口。
 *
 * 相比直接调用 AiEngine.think，这里多做两件事：
 * 1. 棋种不支持 AI 时直接返回 null，调用方无需判断
 * 2. 五子棋的禁手开关通过 options.forbidden 透传
 */
export async function think(
  gameId: string,
  options: ThinkOptions,
): Promise<Move | null> {
  const engine = getAi(gameId)
  if (!engine) return null
  try {
    return await engine.think(options)
  } catch {
    // AI 失败不应让对局卡死：返回 null，界面保持原局面
    return null
  }
}

/** 释放全部 AI 资源（切换棋种或离开对局时调用） */
export function disposeAll(): void {
  for (const engine of instances.values()) engine.dispose()
  instances.clear()
}
