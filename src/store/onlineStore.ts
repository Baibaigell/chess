/**
 * 联机对局状态。
 *
 * 与 gameStore 的关系：
 * - gameStore 持有「本地权威局面」，联机时它仍然是唯一真相来源：
 *   收到的对手走子也通过 gameStore.move() 应用，从而复用同一套引擎与 UI
 * - onlineStore 只管「房间、身份、连接状态、待回应的提议、聊天记录」
 *
 * 这样设计的好处：Board / MoveList / Clock 等 UI 组件完全不需要知道
 * 当前是本地对局还是联机对局。
 */
import { create } from 'zustand'
import { getOnlineClient } from '../net/client'
import type { ConnState } from '../net/client'
import type { GameId, Side, ServerMessage, MovePayload } from '../net/protocol'
import { GAME_NAME } from '../net/protocol'
import { useGameStore } from './gameStore'

/** 联机界面所处的阶段 */
export type OnlinePhase =
  /** 还没进房：显示建房/进房表单 */
  | 'lobby'
  /** 已建房，等待对手加入 */
  | 'waiting'
  /** 对局进行中 */
  | 'playing'
  /** 对局已结束 */
  | 'finished'

/** 聊天条目 */
export interface ChatEntry {
  from: string
  text: string
  /** 系统提示，界面用弱化样式 */
  system: boolean
  /** 收到时间戳 */
  at: number
}

/** 待回应的提议 */
export type PendingOffer = 'draw' | 'undo' | null

interface OnlineState {
  /** 连接状态 */
  conn: ConnState
  /** 当前阶段 */
  phase: OnlinePhase
  /** 房间码 */
  room: string | null
  /** 自己执哪一方 */
  side: Side | null
  /** 棋种 */
  game: GameId | null
  /** 五子棋禁手 */
  forbidden: boolean
  /** 对手昵称 */
  opponent: string
  /** 对手是否在线 */
  opponentOnline: boolean
  /** 聊天记录 */
  chat: ChatEntry[]
  /** 收到的待回应提议 */
  pendingOffer: PendingOffer
  /** 自己发出的提议等待回应 */
  offerSent: PendingOffer
  /** 最后一条错误信息 */
  error: string | null

  /** 进入联机大厅（重置状态） */
  enterLobby: () => void
  /** 建房 */
  createRoom: (game: GameId, name: string, forbidden: boolean) => void
  /** 进房 */
  joinRoom: (room: string, name: string) => void
  /** 处理服务端消息 */
  handleMessage: (msg: ServerMessage) => void
  /** 处理连接状态变化 */
  handleConnState: (state: ConnState) => void
  /** 发送聊天 */
  say: (text: string) => void
  /** 提议和棋 */
  offerDraw: () => void
  /** 回应和棋 */
  replyDraw: (accept: boolean) => void
  /** 提议悔棋 */
  offerUndo: () => void
  /** 回应悔棋 */
  replyUndo: (accept: boolean) => void
  /** 认输 */
  resign: () => void
  /** 离开房间 */
  leave: () => void
  /** 清掉错误提示 */
  clearError: () => void
}

/** 把 Side 转成 gameStore 的 playerSide */
function toPlayerSide(side: Side): 'first' | 'second' {
  return side
}

export const useOnlineStore = create<OnlineState>((set, getState) => ({
  conn: 'idle',
  phase: 'lobby',
  room: null,
  side: null,
  game: null,
  forbidden: false,
  opponent: '',
  opponentOnline: false,
  chat: [],
  pendingOffer: null,
  offerSent: null,
  error: null,

  enterLobby: () => {
    const client = getOnlineClient()
    client.setHandlers({
      onState: (s) => getState().handleConnState(s),
      onMessage: (m) => getState().handleMessage(m),
      onError: (e) => set({ error: e }),
    })
    client.connect()

    set({
      phase: 'lobby',
      room: null,
      side: null,
      game: null,
      forbidden: false,
      opponent: '',
      opponentOnline: false,
      chat: [],
      pendingOffer: null,
      offerSent: null,
      error: null,
    })
  },

  createRoom: (game, name, forbidden) => {
    set({ error: null })
    getOnlineClient().createRoom(game, name, forbidden)
  },

  joinRoom: (room, name) => {
    set({ error: null })
    getOnlineClient().joinRoom(room, name)
  },

  handleConnState: (state) => {
    set({ conn: state })
    // 断线时提示，重连成功后由 opponent-online 或 joined 消掉
    if (state === 'reconnecting') {
      set({ error: '连接已断开，正在重连…' })
    } else if (state === 'open') {
      const { error } = getState()
      if (error?.startsWith('连接已断开')) set({ error: null })
    }
  },

  handleMessage: (msg) => {
    switch (msg.type) {
      // ---- 建房成功 ----
      case 'created': {
        set({
          phase: 'waiting',
          room: msg.room,
          side: msg.side,
          game: msg.game,
          forbidden: msg.forbidden,
          opponent: '',
          opponentOnline: false,
          error: null,
        })
        // 预先把本地引擎开好，等对手进来就能直接走子
        useGameStore.getState().start(
          msg.game,
          toPlayerSide(msg.side),
          'human',
          'medium',
          msg.forbidden,
        )
        break
      }

      // ---- 进房成功 / 重连成功 ----
      case 'joined': {
        const alreadyStarted = useGameStore.getState().gameId === msg.game
        set({
          phase: 'playing',
          room: msg.room,
          side: msg.side,
          game: msg.game,
          forbidden: msg.forbidden,
          opponent: msg.opponent,
          opponentOnline: msg.opponentOnline,
          error: null,
        })

        if (!alreadyStarted) {
          useGameStore.getState().start(
            msg.game,
            toPlayerSide(msg.side),
            'human',
            'medium',
            msg.forbidden,
          )
        }
        break
      }

      // ---- 对手加入 ----
      case 'opponent-joined': {
        set({
          phase: 'playing',
          opponent: msg.name,
          opponentOnline: true,
        })
        break
      }

      // ---- 对手离开 ----
      case 'opponent-left': {
        set({ opponentOnline: false })
        if (!msg.temporary) {
          set({ phase: 'finished' })
        }
        break
      }

      // ---- 对手重连 ----
      case 'opponent-online': {
        set({ opponentOnline: true, error: null })
        break
      }

      // ---- 对手走子 ----
      case 'move-applied': {
        // 联机时双方都会收到同一条走子消息，包括发起方自己。
        // 发起方已经在本地应用过，重复应用会被引擎当作非法着法拒绝，
        // 因此这里统一「尝试应用，失败即忽略」——引擎的合法性校验
        // 天然去重，不需要额外判断是谁发的。
        applyRemoteMove(msg.move)
        break
      }

      // ---- 对局结束 ----
      case 'game-over': {
        set({ phase: 'finished', pendingOffer: null, offerSent: null })
        // 服务端只给结果，具体终局原因由本地引擎判定；
        // 认输与和棋需要主动写入 gameStore，因为引擎不知道
        const gs = useGameStore.getState()
        if (msg.reason === 'resign' || msg.reason === 'disconnect') {
          const winnerIsFirst = msg.winner === 'first'
          gs.setResult({
            status: winnerIsFirst ? 'first-win' : 'second-win',
            reason: msg.reason === 'resign' ? 'resignation' : 'timeout',
          })
        } else if (msg.reason === 'draw-agreed') {
          gs.setResult({ status: 'draw', reason: 'agreement' })
        }
        break
      }

      // ---- 和棋提议 ----
      case 'draw-offered': {
        set({ pendingOffer: 'draw' })
        break
      }
      case 'draw-resolved': {
        set({ offerSent: null, pendingOffer: null })
        pushChat(set, '系统', msg.accepted ? '和棋提议被接受' : '和棋提议被拒绝', true)
        break
      }

      // ---- 悔棋提议 ----
      case 'undo-offered': {
        set({ pendingOffer: 'undo' })
        break
      }
      case 'undo-resolved': {
        set({ offerSent: null, pendingOffer: null })
        if (msg.accepted) {
          // 本地撤销一步，与对方保持一致
          useGameStore.getState().undo()
          pushChat(set, '系统', '对手同意悔棋', true)
        } else {
          pushChat(set, '系统', '悔棋提议被拒绝', true)
        }
        break
      }

      // ---- 聊天 ----
      case 'chat': {
        pushChat(set, msg.from, msg.text, msg.system === true)
        break
      }

      // ---- 错误 ----
      case 'error': {
        set({ error: msg.message })
        break
      }

      case 'pong':
        break
    }
  },

  say: (text) => {
    const trimmed = text.trim()
    if (!trimmed) return
    getOnlineClient().sendChat(trimmed)
  },

  offerDraw: () => {
    if (getState().offerSent) return
    getOnlineClient().sendDrawOffer()
    set({ offerSent: 'draw' })
  },

  replyDraw: (accept) => {
    getOnlineClient().sendDrawReply(accept)
    set({ pendingOffer: null })
  },

  offerUndo: () => {
    if (getState().offerSent) return
    getOnlineClient().sendUndoOffer()
    set({ offerSent: 'undo' })
  },

  replyUndo: (accept) => {
    getOnlineClient().sendUndoReply(accept)
    set({ pendingOffer: null })
  },

  resign: () => {
    getOnlineClient().sendResign()
  },

  leave: () => {
    getOnlineClient().leave()
    useGameStore.getState().leave()
    set({
      phase: 'lobby',
      room: null,
      side: null,
      game: null,
      forbidden: false,
      opponent: '',
      opponentOnline: false,
      chat: [],
      pendingOffer: null,
      offerSent: null,
      error: null,
      conn: 'closed',
    })
  },

  clearError: () => set({ error: null }),
}))

/** 往聊天记录里追加一条，最多保留 100 条 */
function pushChat(
  set: (partial: Partial<OnlineState>) => void,
  from: string,
  text: string,
  system: boolean,
): void {
  const prev = useOnlineStore.getState().chat
  const next = [...prev, { from, text, system, at: Date.now() }]
  set({ chat: next.length > 100 ? next.slice(next.length - 100) : next })
}

/**
 * 把远端走子应用到本地引擎。
 *
 * 联机时服务端会把走子广播给双方（含发起方），因此这里可能收到
 * 自己刚走过的那一步。引擎的合法性校验会让重复应用抛错，
 * 捕获后忽略即可，不需要额外记录「上一步是谁走的」。
 */
function applyRemoteMove(move: MovePayload): void {
  const gs = useGameStore.getState()
  if (!gs.engine) return
  try {
    gs.move({
      from: move.from,
      to: move.to,
      ...(move.promotion ? { promotion: move.promotion } : {}),
    })
  } catch {
    /* 重复或非法走子，忽略 */
  }
}

/** 棋种 id 的中文名，界面直接用 */
export { GAME_NAME }
