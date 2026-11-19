/**
 * AI 对手接口。
 *
 * 与棋种解耦：AI 只认“局面字符串 + 走子方”，
 * 由具体引擎决定怎么转换为自己的协议（如 UCI 的 FEN）。
 */
import type { Move } from '../core/types'

/** 难度档位 */
export type Difficulty = 'easy' | 'medium' | 'hard'

export interface ThinkOptions {
  /** 难度档位，决定引擎强度与思考时间 */
  difficulty: Difficulty
  /**
   * 局面，国际象棋为 FEN，象棋为 9×10 局面串，五子棋为坐标串。
   * AI 实现负责把它翻译成自己的协议格式。
   */
  position: string
  /** 走子方："w" / "b"（象棋为 "r" / "b"，五子棋为 "b" / "w"） */
  turn: string
  /** 中止信号：用于“新对局”或“悔棋”时取消正在进行的思考 */
  signal?: AbortSignal
  /** 五子棋专用：黑棋是否启用禁手规则 */
  forbidden?: boolean
}

export interface AiEngine {
  /**
   * 思考并返回一步棋。
   * 无合法着法或思考被中止时返回 null。
   */
  think(options: ThinkOptions): Promise<Move | null>

  /** 释放底层资源（Worker 等） */
  dispose(): void
}

/** 难度对应的引擎参数 */
export interface DifficultyProfile {
  /** UCI Skill Level，0–20 */
  skillLevel: number
  /** 思考时限（毫秒） */
  movetimeMs: number
  /** 给界面显示的说明 */
  label: string
  /** 大致对应的 Elo，仅作展示 */
  approxElo: number
}

export const DIFFICULTY_PROFILES: Record<Difficulty, DifficultyProfile> = {
  easy: { skillLevel: 3, movetimeMs: 300, label: '简单', approxElo: 800 },
  medium: { skillLevel: 10, movetimeMs: 600, label: '中等', approxElo: 1400 },
  hard: { skillLevel: 20, movetimeMs: 1200, label: '困难', approxElo: 2000 },
}
