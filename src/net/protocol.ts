/**
 * 联机协议：客户端与服务端共用的消息定义。
 *
 * 设计原则：
 * - 服务端只做「转发 + 回合校验 + 房间管理」，不跑规则引擎。
 *   规则由客户端判定，双方都用同一份引擎代码，结果一致。
 * - 所有消息都是 JSON 文本帧，字段 type 区分种类。
 * - 协议版本号放在握手消息里，两端不一致时服务端直接拒绝，
 *   避免旧客户端连新服务端出现难以诊断的错位。
 */

/** 协议版本；两端必须一致 */
export const PROTOCOL_VERSION = 1

/** 支持的棋种 id */
export type GameId = 'chess' | 'xiangqi' | 'gomoku'

/** 一方阵营：先行方 / 后行方 */
export type Side = 'first' | 'second'

/** 走一步棋 */
export interface MovePayload {
  from: string
  to: string
  promotion?: string
}

// ==================== 客户端 → 服务端 ====================

/** 创建房间 */
export interface CreateRoomMsg {
  type: 'create'
  /** 协议版本 */
  version: number
  /** 棋种 */
  game: GameId
  /** 昵称 */
  name: string
  /** 五子棋是否启用禁手 */
  forbidden?: boolean
}

/** 加入房间 */
export interface JoinRoomMsg {
  type: 'join'
  version: number
  /** 4 位房间码 */
  room: string
  name: string
}

/** 走子 */
export interface MoveMsg {
  type: 'move'
  move: MovePayload
}

/** 认输 */
export interface ResignMsg {
  type: 'resign'
}

/** 提议和棋 */
export interface DrawOfferMsg {
  type: 'draw-offer'
}

/** 回应和棋提议 */
export interface DrawReplyMsg {
  type: 'draw-reply'
  accept: boolean
}

/** 提议悔棋 */
export interface UndoOfferMsg {
  type: 'undo-offer'
}

/** 回应悔棋提议 */
export interface UndoReplyMsg {
  type: 'undo-reply'
  accept: boolean
}

/** 聊天消息 */
export interface ChatMsg {
  type: 'chat'
  text: string
}

/** 心跳 */
export interface PingMsg {
  type: 'ping'
}

/** 断线后重连，用 token 恢复身份 */
export interface ReconnectMsg {
  type: 'reconnect'
  version: number
  room: string
  /** 服务端在 joined 消息里下发的令牌 */
  token: string
}

/** 离开房间 */
export interface LeaveMsg {
  type: 'leave'
}

export type ClientMessage =
  | CreateRoomMsg
  | JoinRoomMsg
  | MoveMsg
  | ResignMsg
  | DrawOfferMsg
  | DrawReplyMsg
  | UndoOfferMsg
  | UndoReplyMsg
  | ChatMsg
  | PingMsg
  | ReconnectMsg
  | LeaveMsg

// ==================== 服务端 → 客户端 ====================

/** 创建成功 */
export interface CreatedMsg {
  type: 'created'
  room: string
  /** 重连令牌 */
  token: string
  /** 自己执哪一方 */
  side: Side
  game: GameId
  forbidden: boolean
}

/** 加入成功 */
export interface JoinedMsg {
  type: 'joined'
  room: string
  token: string
  side: Side
  game: GameId
  forbidden: boolean
  /** 对手昵称 */
  opponent: string
  /** 对手是否已在线（加入时通常为 true） */
  opponentOnline: boolean
}

/** 对手加入（房主收到） */
export interface OpponentJoinedMsg {
  type: 'opponent-joined'
  name: string
}

/** 对手离开 */
export interface OpponentLeftMsg {
  type: 'opponent-left'
  /** 是否因断线暂时离开（可能重连） */
  temporary: boolean
}

/** 对手重连成功 */
export interface OpponentOnlineMsg {
  type: 'opponent-online'
}

/** 走子转发 */
export interface MoveAppliedMsg {
  type: 'move-applied'
  move: MovePayload
}

/** 对局结束 */
export interface GameOverMsg {
  type: 'game-over'
  /** 胜方阵营；null 表示和棋 */
  winner: Side | null
  /** 结束原因 */
  reason: 'resign' | 'draw-agreed' | 'disconnect'
}

/** 收到和棋提议 */
export interface DrawOfferedMsg {
  type: 'draw-offered'
}

/** 和棋提议被回应 */
export interface DrawResolvedMsg {
  type: 'draw-resolved'
  accepted: boolean
}

/** 收到悔棋提议 */
export interface UndoOfferedMsg {
  type: 'undo-offered'
}

/** 悔棋提议被回应 */
export interface UndoResolvedMsg {
  type: 'undo-resolved'
  accepted: boolean
}

/** 聊天转发 */
export interface ChatRelayMsg {
  type: 'chat'
  from: string
  text: string
  /** 是否为系统提示 */
  system?: boolean
}

/** 错误 */
export interface ErrorMsg {
  type: 'error'
  /** 错误码，便于客户端分支处理 */
  code:
    | 'room-not-found'
    | 'room-full'
    | 'version-mismatch'
    | 'not-your-turn'
    | 'bad-message'
    | 'bad-token'
    | 'game-over'
  /** 给用户看的说明 */
  message: string
}

/** 心跳回应 */
export interface PongMsg {
  type: 'pong'
}

export type ServerMessage =
  | CreatedMsg
  | JoinedMsg
  | OpponentJoinedMsg
  | OpponentLeftMsg
  | OpponentOnlineMsg
  | MoveAppliedMsg
  | GameOverMsg
  | DrawOfferedMsg
  | DrawResolvedMsg
  | UndoOfferedMsg
  | UndoResolvedMsg
  | ChatRelayMsg
  | ErrorMsg
  | PongMsg

/** 棋种 id 的中文名，服务端发系统消息时用 */
export const GAME_NAME: Record<GameId, string> = {
  chess: '国际象棋',
  xiangqi: '中国象棋',
  gomoku: '五子棋',
}

/** 判断是否为合法棋种 */
export function isGameId(v: unknown): v is GameId {
  return v === 'chess' || v === 'xiangqi' || v === 'gomoku'
}

/** 校验走子消息格式 */
export function isMovePayload(v: unknown): v is MovePayload {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (typeof o.from !== 'string' || typeof o.to !== 'string') return false
  if (!/^[a-o]\d{1,2}$/.test(o.from) || !/^[a-o]\d{1,2}$/.test(o.to)) return false
  if (o.promotion !== undefined && typeof o.promotion !== 'string') return false
  return true
}
