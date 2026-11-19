/**
 * 联机客户端：封装 WebSocket 连接、自动重连、消息收发。
 *
 * 设计要点：
 * - 不直接操作 UI 状态：收到消息后回调给上层（onlineStore），由 store 决定怎么用
 * - 自动重连：断线后按指数退避重试，重连成功后用 token 恢复身份
 * - 心跳：定期发 ping，服务端回 pong；连续无响应判定为死连接
 *
 * 服务端地址的解析顺序：
 * 1. localStorage 里用户手动填的地址（设置页）
 * 2. 当前页面同源（部署到同一个服务端时的默认行为）
 * 3. 开发环境回退到 localhost:8080
 */
import type { ClientMessage, ServerMessage, GameId } from './protocol'
import { PROTOCOL_VERSION } from './protocol'

/** 连接状态 */
export type ConnState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'

/** 客户端事件回调 */
export interface ClientHandlers {
  onState?: (state: ConnState) => void
  onMessage?: (msg: ServerMessage) => void
  /** 连接级错误（非服务端业务错误） */
  onError?: (message: string) => void
}

/** 重连退避序列（毫秒） */
const BACKOFF = [1000, 2000, 4000, 8000, 15000]

/** 心跳间隔 */
const PING_MS = 20000

/** 多久收不到任何消息视为连接已死 */
const PONG_TIMEOUT_MS = 45000

/** 本地的重连凭据，存 sessionStorage 避免多标签页互相覆盖 */
const CRED_KEY = 'chess-app.online.cred'
/** 服务端地址覆盖（导出给设置界面用） */
export const URL_KEY = 'chess-app.online.url'

/** 重连凭据 */
interface Credential {
  room: string
  token: string
}

/**
 * 读取用户手动配置的服务端地址。
 *
 * 返回 null 表示未配置，此时走同源逻辑。
 * APK 里页面来自 https://appassets.androidplatform.net，
 * 同源地址连不到真实服务端，必须由用户在设置里填写。
 */
export function getServerUrl(): string | null {
  try {
    const v = localStorage.getItem(URL_KEY)
    return v && v.trim() ? v.trim() : null
  } catch {
    return null
  }
}

/**
 * 保存服务端地址。
 *
 * 传空字符串等价于清除配置。地址只接受 ws:// 或 wss://，
 * 也接受 http:// / https:// 并自动转成对应的 WebSocket 协议。
 */
export function setServerUrl(raw: string): void {
  const v = raw.trim()
  try {
    if (!v) {
      localStorage.removeItem(URL_KEY)
      return
    }
    localStorage.setItem(URL_KEY, normalizeServerUrl(v))
  } catch {
    /* 隐私模式下可能不可用 */
  }
}

/** 清除手动配置，回到同源逻辑 */
export function resetServerUrl(): void {
  try {
    localStorage.removeItem(URL_KEY)
  } catch {
    /* 忽略 */
  }
}

/**
 * 规范化地址：补协议、去掉尾部斜杠。
 *
 * 用户常直接粘贴 https://xxx.onrender.com，
 * 这里转成 wss://xxx.onrender.com，省得他还要理解协议差别。
 */
export function normalizeServerUrl(raw: string): string {
  let v = raw.trim().replace(/\/+$/, '')
  if (!v) return ''
  if (v.startsWith('https://')) v = 'wss://' + v.slice(8)
  else if (v.startsWith('http://')) v = 'ws://' + v.slice(7)
  else if (!v.startsWith('ws://') && !v.startsWith('wss://')) {
    // 没写协议：本地地址用 ws，其余默认 wss
    const isLocal = /^(localhost|127\.0\.0\.1|192\.168\.|10\.|\[::1\])/.test(v)
    v = (isLocal ? 'ws://' : 'wss://') + v
  }
  return v
}

/** 校验地址是否可用，返回错误提示；合法时返回 null */
export function validateServerUrl(raw: string): string | null {
  const v = raw.trim()
  if (!v) return null // 空值合法，表示用同源
  // 明确拒绝非 ws/http 协议，避免用户填 ftp:// 之类
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v) && !/^wss?:\/\//i.test(v) && !/^https?:\/\//i.test(v)) {
    return '只支持 ws:// 或 wss://（http/https 会自动转换）'
  }
  const normalized = normalizeServerUrl(v)
  // 主机名只允许 ASCII 字母数字、点、短横线、冒号（端口）、方括号（IPv6）
  if (!/^wss?:\/\/[A-Za-z0-9.\-:[\]]+(?:\/[^\s]*)?$/.test(normalized)) {
    return '地址格式不对，应形如 wss://example.com'
  }
  return null
}

/**
 * 解析服务端 WebSocket 地址。
 *
 * 默认与页面同源：部署到同一个服务端时，前端从 https://x/ 打开，
 * WebSocket 就是 wss://x/。开发时页面在 5173，服务端在 8080，
 * 因此开发环境下回退到 8080。
 */
export function resolveServerUrl(): string {
  // 用户手动配置优先
  const custom = getServerUrl()
  if (custom) return custom

  const { protocol, hostname, port } = window.location
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:'

  // 开发服务器（vite 默认 5173）：连本地 8080
  if (port === '5173' || port === '4173') {
    return `${wsProtocol}//${hostname}:8080`
  }

  return `${wsProtocol}//${hostname}${port ? ':' + port : ''}`
}

/** 把 ws:// 地址转成 http:// 以便探测健康状态 */
export function toHttpUrl(wsUrl: string): string {
  return wsUrl.replace(/^ws/, 'http')
}

export class OnlineClient {
  private ws: WebSocket | null = null
  private handlers: ClientHandlers = {}
  private state: ConnState = 'idle'
  /** 重连尝试计数，成功后归零 */
  private attempt = 0
  /** 是否由用户主动关闭：主动关闭不触发重连 */
  private manualClose = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private lastMessageAt = 0
  /** 当前房间与令牌，用于自动重连 */
  private cred: Credential | null = null
  /** 待连接成功后才发送的消息队列 */
  private pending: ClientMessage[] = []

  /** 绑定事件回调 */
  setHandlers(handlers: ClientHandlers): void {
    this.handlers = handlers
  }

  getState(): ConnState {
    return this.state
  }

  private setState(s: ConnState): void {
    if (this.state === s) return
    this.state = s
    this.handlers.onState?.(s)
  }

  /** 读取本地保存的重连凭据 */
  static loadCredential(): Credential | null {
    try {
      const raw = sessionStorage.getItem(CRED_KEY)
      if (!raw) return null
      const obj = JSON.parse(raw) as Credential
      if (typeof obj.room === 'string' && typeof obj.token === 'string') return obj
    } catch {
      /* 忽略损坏数据 */
    }
    return null
  }

  private saveCredential(cred: Credential | null): void {
    this.cred = cred
    try {
      if (cred) sessionStorage.setItem(CRED_KEY, JSON.stringify(cred))
      else sessionStorage.removeItem(CRED_KEY)
    } catch {
      /* 隐私模式下可能不可用 */
    }
  }

  /**
   * 建立连接。
   *
   * 若本地有未过期的凭据，连接成功后自动发送 reconnect 恢复身份，
   * 这样刷新页面也能回到原对局。
   */
  connect(): void {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return

    this.manualClose = false
    this.setState(this.attempt > 0 ? 'reconnecting' : 'connecting')

    const url = resolveServerUrl()
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch (e) {
      this.handlers.onError?.(`无法创建连接：${String(e)}`)
      this.setState('closed')
      return
    }
    this.ws = ws

    ws.onopen = () => {
      this.attempt = 0
      this.lastMessageAt = Date.now()
      this.setState('open')

      // 刷新页面后自动恢复原房间
      const saved = this.cred ?? OnlineClient.loadCredential()
      if (saved) {
        this.cred = saved
        ws.send(
          JSON.stringify({
            type: 'reconnect',
            version: PROTOCOL_VERSION,
            room: saved.room,
            token: saved.token,
          }),
        )
      }

      // 发送排队的消息
      for (const msg of this.pending.splice(0)) ws.send(JSON.stringify(msg))

      this.startPing()
    }

    ws.onmessage = (ev) => {
      this.lastMessageAt = Date.now()
      let msg: ServerMessage
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage
      } catch {
        return
      }

      // 自动维护凭据：created / joined 都带 token
      if (msg.type === 'created' || msg.type === 'joined') {
        this.saveCredential({ room: msg.room, token: msg.token })
      }

      // 房间不存在时清掉凭据，避免反复用失效 token 重连
      if (msg.type === 'error' && (msg.code === 'bad-token' || msg.code === 'room-not-found')) {
        this.saveCredential(null)
      }

      this.handlers.onMessage?.(msg)
    }

    ws.onerror = () => {
      // onerror 之后一定会有 onclose，重连逻辑统一放在那里
    }

    ws.onclose = () => {
      this.stopPing()
      this.ws = null
      if (this.manualClose) {
        this.setState('closed')
        return
      }
      // 自动重连
      this.scheduleReconnect()
    }
  }

  /** 按指数退避安排重连 */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    this.setState('reconnecting')

    const delay = BACKOFF[Math.min(this.attempt, BACKOFF.length - 1)]
    this.attempt++

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  /** 心跳：定期 ping，同时检查是否长时间无消息 */
  private startPing(): void {
    this.stopPing()
    this.pingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== 1) return
      // 长时间没有任何消息：认为连接已死，主动断开触发重连
      if (Date.now() - this.lastMessageAt > PONG_TIMEOUT_MS) {
        try {
          this.ws.close()
        } catch {
          /* 已断开 */
        }
        return
      }
      try {
        this.ws.send(JSON.stringify({ type: 'ping' }))
      } catch {
        /* 写失败由 onclose 处理 */
      }
    }, PING_MS)
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  /** 发消息；未连接时排队，连上后自动补发 */
  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(msg))
    } else {
      this.pending.push(msg)
      // 没连上就发起连接
      if (!this.ws) this.connect()
    }
  }

  /** 建房 */
  createRoom(game: GameId, name: string, forbidden?: boolean): void {
    this.send({
      type: 'create',
      version: PROTOCOL_VERSION,
      game,
      name,
      ...(forbidden ? { forbidden: true } : {}),
    })
  }

  /** 进房 */
  joinRoom(room: string, name: string): void {
    this.send({ type: 'join', version: PROTOCOL_VERSION, room: room.toUpperCase(), name })
  }

  /** 走子 */
  sendMove(from: string, to: string, promotion?: string): void {
    this.send({
      type: 'move',
      move: { from, to, ...(promotion ? { promotion } : {}) },
    })
  }

  sendResign(): void {
    this.send({ type: 'resign' })
  }

  sendDrawOffer(): void {
    this.send({ type: 'draw-offer' })
  }

  sendDrawReply(accept: boolean): void {
    this.send({ type: 'draw-reply', accept })
  }

  sendUndoOffer(): void {
    this.send({ type: 'undo-offer' })
  }

  sendUndoReply(accept: boolean): void {
    this.send({ type: 'undo-reply', accept })
  }

  sendChat(text: string): void {
    this.send({ type: 'chat', text })
  }

  /** 主动离开房间并断开连接 */
  leave(): void {
    this.manualClose = true
    this.saveCredential(null)
    try {
      if (this.ws && this.ws.readyState === 1) {
        this.ws.send(JSON.stringify({ type: 'leave' }))
      }
    } catch {
      /* 已断开 */
    }
    this.stopPing()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.pending = []
    this.attempt = 0
    try {
      this.ws?.close()
    } catch {
      /* 已断开 */
    }
    this.ws = null
    this.setState('closed')
  }

  /** 彻底销毁：清掉定时器，不再重连 */
  destroy(): void {
    this.leave()
    this.handlers = {}
  }
}

/** 进程内共享一个客户端实例 */
let shared: OnlineClient | null = null

export function getOnlineClient(): OnlineClient {
  if (!shared) shared = new OnlineClient()
  return shared
}
