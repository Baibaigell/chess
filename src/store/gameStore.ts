/**
 * 对局状态管理。
 *
 * 只保存“能重建整个对局”的最小状态：引擎实例本身不放进 store，
 * 由 encode() 得到的局面字符串驱动重建，避免把类实例塞进可序列化状态。
 *
 * 阵营不写死为白/黑：不同棋种先行方不同（国际象棋白、象棋红、五子棋黑），
 * 因此判定胜负时一律用 meta.firstTurn 判断「谁先走」。
 */
import { create } from 'zustand'
import type { GameEngine, Move, MoveRecord } from '../core/types'
import type { GameResult } from '../core/result'
import { GameStatus, ONGOING } from '../core/result'
import { get } from '../core/registry'
import type { Difficulty } from '../ai/types'

/** 玩家阵营：先行方 / 后行方 / 双人对下 */
export type PlayerSide = 'first' | 'second' | 'both'

/** 对手类型：同机双人 / 电脑 */
export type Opponent = 'human' | 'ai'

interface GameState {
  /** 当前棋种 id */
  gameId: string | null
  /** 当前局面（编码形式） */
  position: string
  /** 走子方 */
  turn: string
  /** 着法记录 */
  history: MoveRecord[]
  /** 对局结果 */
  result: GameResult
  /** 玩家执哪一方 */
  playerSide: PlayerSide
  /** 引擎实例，仅内部使用，不参与渲染 diff */
  engine: GameEngine | null
  /** 对手类型 */
  opponent: Opponent
  /** AI 难度 */
  difficulty: Difficulty
  /** AI 是否正在思考 */
  thinking: boolean
  /** 五子棋：黑棋是否启用禁手规则 */
  forbidden: boolean

  start: (
    gameId: string,
    playerSide?: PlayerSide,
    opponent?: Opponent,
    difficulty?: Difficulty,
    forbidden?: boolean,
  ) => void
  move: (move: Move) => void
  undo: () => void
  restart: () => void
  resign: () => void
  /** 退出对局，回到大厅 */
  leave: () => void
  /** 从引擎同步派生状态 */
  sync: () => void
  /**
   * 直接写入对局结果。
   *
   * 用于「引擎无法自行判定」的终局：认输、双方同意和棋、对手掉线。
   * 这些情况规则引擎不知道，必须由上层（联机层或按钮）告知。
   */
  setResult: (result: GameResult) => void
  setThinking: (v: boolean) => void
  setDifficulty: (d: Difficulty) => void
  setOpponent: (o: Opponent) => void
  setForbidden: (v: boolean) => void
}

function deriveFrom(engine: GameEngine, playerSide: PlayerSide) {
  return {
    engine,
    position: engine.position(),
    turn: engine.turn(),
    history: engine.history(),
    result: engine.result(),
    playerSide,
  }
}

export const useGameStore = create<GameState>((set, getState) => ({
  gameId: null,
  position: '',
  turn: 'w',
  history: [],
  result: { ...ONGOING },
  playerSide: 'first',
  engine: null,
  opponent: 'human',
  difficulty: 'medium',
  thinking: false,
  forbidden: false,

  start: (gameId, playerSide = 'both', opponent = 'human', difficulty = 'medium', forbidden = false) => {
    const entry = get(gameId)
    // 五子棋的禁手开关在创建引擎时传入，引擎据此过滤黑棋禁手点
    const engine =
      gameId === 'gomoku'
        ? (entry.createWithOptions?.({ forbidden }) ?? entry.create())
        : entry.create()
    set({
      gameId,
      ...deriveFrom(engine, playerSide),
      opponent,
      difficulty,
      thinking: false,
      forbidden,
    })
  },

  move: (move) => {
    const { engine, playerSide } = getState()
    if (!engine) return
    try {
      engine.applyMove(move)
    } catch {
      // 非法着法由引擎抛出，这里吞掉并保持局面不变，
      // 界面据此不刷新即可，不需要额外错误态
      return
    }
    set(deriveFrom(engine, playerSide))
  },

  undo: () => {
    const { engine, playerSide } = getState()
    if (!engine) return
    engine.undoMove()
    set(deriveFrom(engine, playerSide))
  },

  restart: () => {
    const { gameId, playerSide, opponent, difficulty, forbidden } = getState()
    if (!gameId) return
    getState().start(gameId, playerSide, opponent, difficulty, forbidden)
  },

  resign: () => {
    const { turn, result, gameId } = getState()
    if (result.status !== GameStatus.Ongoing || !gameId) return
    // 认输方是当前走子方，因此胜方是另一方。
    // 用 meta.firstTurn 判断先行方，避免把「白/黑」写死。
    const firstTurn = get(gameId).meta.firstTurn
    const resignerIsFirst = turn === firstTurn
    set({
      result: {
        status: resignerIsFirst ? GameStatus.SecondWin : GameStatus.FirstWin,
        reason: 'resignation',
      },
    })
  },

  sync: () => {
    const { engine, playerSide } = getState()
    if (!engine) return
    set(deriveFrom(engine, playerSide))
  },

  setResult: (result) => set({ result }),

  leave: () => {
    set({
      gameId: null,
      position: '',
      turn: 'w',
      history: [],
      result: { ...ONGOING },
      playerSide: 'first',
      engine: null,
      opponent: 'human',
      difficulty: 'medium',
      thinking: false,
      forbidden: false,
    })
  },

  setThinking: (v) => set({ thinking: v }),

  setDifficulty: (d) => set({ difficulty: d }),

  setOpponent: (o) => set({ opponent: o }),

  setForbidden: (v) => set({ forbidden: v }),
}))
