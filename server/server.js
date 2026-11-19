/**
 * 联机服务端：零依赖，只用 Node 内置模块。
 *
 * 职责（按 S1 的约定）：
 * - 房间管理：建房、进房、断线重连、销毁
 * - 回合校验：只接受轮到的一方走子
 * - 消息转发：把走子、聊天、认输、和棋/悔棋提议转给对手
 * - 静态文件：顺便把 dist/ 的构建产物托管出去，单进程即可部署
 *
 * 不做的事：不跑规则引擎、不判胜负。胜负由客户端引擎判定后
 * 通过 game-over 消息告知对端（S1）。
 *
 * WebSocket 是手写的：Node 内置模块没有 ws，为了零依赖，
 * 这里按 RFC 6455 实现握手、掩码解码、帧组装与分片。
 * 只支持服务端必需的部分：文本帧、ping/pong、close、分片消息。
 */
'use strict'

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

// ==================== 配置 ====================

/** 端口：优先取环境变量，云平台会注入 PORT */
const PORT = Number(process.env.PORT) || 8080
const HOST = process.env.HOST || '0.0.0.0'

/** 静态文件根目录：默认取仓库的 dist */
const STATIC_ROOT = process.env.STATIC_ROOT
  ? path.resolve(process.env.STATIC_ROOT)
  : path.resolve(__dirname, '..', 'dist')

/** 房间空闲多久后销毁（毫秒）；双方都断线后开始计时 */
const ROOM_TTL_MS = 30 * 60 * 1000

/** 单个房间最多连接数 */
const MAX_CONN_PER_ROOM = 2

/** 心跳间隔：服务端主动 ping，客户端回 pong */
const HEARTBEAT_MS = 25 * 1000

/** 多久没收到任何帧视为死连接 */
const DEAD_AFTER_MS = 60 * 1000

/** 协议版本，必须与 src/net/protocol.ts 的 PROTOCOL_VERSION 一致 */
const PROTOCOL_VERSION = 1

// ==================== WebSocket 实现 ====================

/** RFC 6455 的魔术字符串 */
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

/**
 * 一个 WebSocket 连接的封装。
 *
 * 帧解析状态机：把收到的 TCP 字节流按帧切开，
 * 处理分片（opcode 0）、掩码、控制帧。
 */
class WsConnection {
  /**
   * @param {import('node:net').Socket} socket
   * @param {import('node:http').IncomingMessage} req
   */
  constructor(socket, req) {
    this.socket = socket
    this.req = req
    /** 缓冲区：存放尚未解析完的字节 */
    this.buffer = Buffer.alloc(0)
    /** 分片消息的累积 */
    this.fragments = []
    this.fragmentOpcode = 0
    this.closed = false
    /** 最后收到帧的时间，用于判定死连接 */
    this.lastSeen = Date.now()
    /** 业务层挂载的回调 */
    this.onMessage = null
    this.onClose = null

    socket.setNoDelay(true)
    socket.on('data', (chunk) => this.onData(chunk))
    socket.on('close', () => this.handleClose())
    socket.on('error', () => this.handleClose())
  }

  /** 收到原始字节 */
  onData(chunk) {
    if (this.closed) return
    this.lastSeen = Date.now()
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk])
    this.parseFrames()
  }

  /** 循环解析缓冲区里的完整帧 */
  parseFrames() {
    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0]
      const b1 = this.buffer[1]

      const fin = (b0 & 0x80) !== 0
      const opcode = b0 & 0x0f
      const masked = (b1 & 0x80) !== 0
      let payloadLen = b1 & 0x7f

      let offset = 2

      // 扩展长度
      if (payloadLen === 126) {
        if (this.buffer.length < offset + 2) return
        payloadLen = this.buffer.readUInt16BE(offset)
        offset += 2
      } else if (payloadLen === 127) {
        if (this.buffer.length < offset + 8) return
        // 64 位长度；JS 安全整数范围内直接用
        const hi = this.buffer.readUInt32BE(offset)
        const lo = this.buffer.readUInt32BE(offset + 4)
        payloadLen = hi * 0x100000000 + lo
        offset += 8
      }

      // 客户端发来的帧必须带掩码
      let maskKey = null
      if (masked) {
        if (this.buffer.length < offset + 4) return
        maskKey = this.buffer.subarray(offset, offset + 4)
        offset += 4
      }

      if (this.buffer.length < offset + payloadLen) return

      let payload = this.buffer.subarray(offset, offset + payloadLen)
      // 解掩码
      if (maskKey) {
        const out = Buffer.allocUnsafe(payloadLen)
        for (let i = 0; i < payloadLen; i++) {
          out[i] = payload[i] ^ maskKey[i & 3]
        }
        payload = out
      } else {
        payload = Buffer.from(payload)
      }

      this.buffer = this.buffer.subarray(offset + payloadLen)

      this.handleFrame(fin, opcode, payload)
    }
  }

  /** 处理单个帧 */
  handleFrame(fin, opcode, payload) {
    // 控制帧：0x8 close、0x9 ping、0xA pong
    if (opcode === 0x8) {
      this.close(1000)
      return
    }
    if (opcode === 0x9) {
      this.sendFrame(0xa, payload)
      return
    }
    if (opcode === 0xa) {
      return
    }

    // 数据帧
    if (opcode === 0x0) {
      // 续帧：拼到当前分片
      this.fragments.push(payload)
      if (fin) {
        const full = Buffer.concat(this.fragments)
        const op = this.fragmentOpcode
        this.fragments = []
        this.fragmentOpcode = 0
        this.deliver(op, full)
      }
      return
    }

    if (!fin) {
      // 分片消息的第一帧
      this.fragments = [payload]
      this.fragmentOpcode = opcode
      return
    }

    this.deliver(opcode, payload)
  }

  /** 把完整消息交给业务层 */
  deliver(opcode, payload) {
    // 只处理文本帧（0x1）
    if (opcode !== 0x1) return
    const text = payload.toString('utf8')
    if (this.onMessage) this.onMessage(text)
  }

  /** 发送一帧 */
  sendFrame(opcode, payload) {
    if (this.closed || !this.socket.writable) return

    const len = payload.length
    let header

    if (len < 126) {
      header = Buffer.allocUnsafe(2)
      header[0] = 0x80 | opcode
      header[1] = len
    } else if (len < 65536) {
      header = Buffer.allocUnsafe(4)
      header[0] = 0x80 | opcode
      header[1] = 126
      header.writeUInt16BE(len, 2)
    } else {
      header = Buffer.allocUnsafe(10)
      header[0] = 0x80 | opcode
      header[1] = 127
      header.writeUInt32BE(Math.floor(len / 0x100000000), 2)
      header.writeUInt32BE(len % 0x100000000, 6)
    }

    try {
      this.socket.write(Buffer.concat([header, payload]))
    } catch {
      this.handleClose()
    }
  }

  /** 发送 JSON 文本消息 */
  send(obj) {
    this.sendFrame(0x1, Buffer.from(JSON.stringify(obj), 'utf8'))
  }

  /** 主动关闭 */
  close(code = 1000) {
    if (this.closed) return
    const payload = Buffer.allocUnsafe(2)
    payload.writeUInt16BE(code, 0)
    this.sendFrame(0x8, payload)
    this.closed = true
    try {
      this.socket.end()
    } catch {
      /* 已断开 */
    }
    this.handleClose()
  }

  /** 连接关闭的清理，保证只触发一次 */
  handleClose() {
    if (this.closed && this.notified) return
    this.notified = true
    this.closed = true
    if (this.onClose) this.onClose()
  }

  /** 发送心跳 ping */
  ping() {
    this.sendFrame(0x9, Buffer.alloc(0))
  }
}

// ==================== 房间管理 ====================

/**
 * 房间对象。
 *
 * 一个房间最多两名玩家。房主执先行方（first），加入者执后行方（second）。
 * 走子顺序由服务端按「轮到谁」校验：初始轮 first，每走一步翻转。
 */
class Room {
  constructor(code, game, forbidden, hostName) {
    this.code = code
    this.game = game
    this.forbidden = forbidden === true
    /** first / second → 玩家对象 */
    this.players = { first: null, second: null }
    /** 当前轮到哪一方走子 */
    this.turn = 'first'
    /** 对局是否已结束 */
    this.over = false
    /** 最后活跃时间，用于 TTL 回收 */
    this.lastActive = Date.now()
    /** 待回应的提议：'draw' | 'undo' | null */
    this.pendingOffer = null
    /** 提议由谁发起 */
    this.offerBy = null
    /** 双方都断线后开始计时的销毁时间戳 */
    this.destroyAt = 0
  }

  /** 对手的阵营 */
  static other(side) {
    return side === 'first' ? 'second' : 'first'
  }

  /** 取某方玩家 */
  get(side) {
    return this.players[side]
  }

  /** 房间里是否有某个连接 */
  hasConn(conn) {
    return this.players.first?.conn === conn || this.players.second?.conn === conn
  }

  /** 当前连接数 */
  connCount() {
    let n = 0
    if (this.players.first?.conn) n++
    if (this.players.second?.conn) n++
    return n
  }

  /** 双方都在线？ */
  bothOnline() {
    return !!(this.players.first?.conn && this.players.second?.conn)
  }

  /** 给某方发消息；不在线则跳过 */
  sendTo(side, obj) {
    const p = this.players[side]
    if (p?.conn) p.conn.send(obj)
  }

  /** 给房间里所有人发 */
  broadcast(obj) {
    this.sendTo('first', obj)
    this.sendTo('second', obj)
  }

  /** 给对手发 */
  sendToOpponent(side, obj) {
    this.sendTo(Room.other(side), obj)
  }

  /** 标记活跃，重置销毁计时 */
  touch() {
    this.lastActive = Date.now()
    this.destroyAt = 0
  }

  /** 双方都离线时开始计时销毁 */
  checkDestroyTimer() {
    if (this.connCount() === 0 && this.destroyAt === 0) {
      this.destroyAt = Date.now() + ROOM_TTL_MS
    }
  }
}

/** 房间码 → Room */
const rooms = new Map()

/** 连接 → { room, side }，便于断线时快速定位 */
const connIndex = new Map()

/** 生成 4 位房间码：数字+大写字母，去掉易混淆的 0/O/1/I */
function makeRoomCode() {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = ''
    for (let i = 0; i < 4; i++) {
      code += alphabet[crypto.randomInt(alphabet.length)]
    }
    if (!rooms.has(code)) return code
  }
  throw new Error('房间码空间已满')
}

/** 生成重连令牌 */
function makeToken() {
  return crypto.randomBytes(16).toString('hex')
}

// ==================== 业务处理 ====================

/** 给客户端回错误 */
function sendError(conn, code, message) {
  conn.send({ type: 'error', code, message })
}

/** 系统提示：以聊天消息形式发给房间里的人 */
function systemSay(room, text) {
  room.broadcast({ type: 'chat', from: '系统', text, system: true })
}

/** 处理「创建房间」 */
function handleCreate(conn, msg) {
  if (conn.room) {
    sendError(conn, 'bad-message', '你已在房间中')
    return
  }
  const game = msg.game
  if (game !== 'chess' && game !== 'xiangqi' && game !== 'gomoku') {
    sendError(conn, 'bad-message', '不支持的棋种')
    return
  }
  const name = String(msg.name || '玩家').slice(0, 16)
  const code = makeRoomCode()
  const room = new Room(code, game, msg.forbidden, name)
  const token = makeToken()

  const player = { name, conn, token, side: 'first' }
  room.players.first = player
  rooms.set(code, room)

  conn.room = room
  conn.side = 'first'
  connIndex.set(conn, { room, side: 'first' })

  conn.send({
    type: 'created',
    room: code,
    token,
    side: 'first',
    game,
    forbidden: room.forbidden,
  })
}

/** 处理「加入房间」 */
function handleJoin(conn, msg) {
  if (conn.room) {
    sendError(conn, 'bad-message', '你已在房间中')
    return
  }
  const code = String(msg.room || '').toUpperCase().trim()
  const room = rooms.get(code)
  if (!room) {
    sendError(conn, 'room-not-found', '房间不存在或已关闭')
    return
  }
  if (room.over) {
    sendError(conn, 'game-over', '该房间的对局已结束')
    return
  }
  if (room.connCount() >= MAX_CONN_PER_ROOM) {
    sendError(conn, 'room-full', '房间已满')
    return
  }
  if (room.players.second) {
    sendError(conn, 'room-full', '房间已满')
    return
  }

  const name = String(msg.name || '玩家').slice(0, 16)
  const token = makeToken()
  const player = { name, conn, token, side: 'second' }
  room.players.second = player
  room.touch()

  conn.room = room
  conn.side = 'second'
  connIndex.set(conn, { room, side: 'second' })

  conn.send({
    type: 'joined',
    room: code,
    token,
    side: 'second',
    game: room.game,
    forbidden: room.forbidden,
    opponent: room.players.first?.name ?? '对手',
    opponentOnline: !!room.players.first?.conn,
  })

  // 通知房主
  room.sendTo('first', { type: 'opponent-joined', name })
  systemSay(room, `${name} 加入了房间`)
}

/** 处理「走子」 */
function handleMove(conn, msg) {
  const room = conn.room
  if (!room) return
  if (room.over) {
    sendError(conn, 'game-over', '对局已结束')
    return
  }
  const side = conn.side
  if (room.turn !== side) {
    sendError(conn, 'not-your-turn', '还没轮到你走子')
    return
  }
  const move = msg.move
  if (
    !move ||
    typeof move.from !== 'string' ||
    typeof move.to !== 'string' ||
    !/^[a-o]\d{1,2}$/.test(move.from) ||
    !/^[a-o]\d{1,2}$/.test(move.to)
  ) {
    sendError(conn, 'bad-message', '走子格式不正确')
    return
  }

  room.touch()
  // 转发给对手（含发起方，便于双方用同一份权威数据同步）
  room.broadcast({
    type: 'move-applied',
    move: { from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) },
  })

  // 回合翻转
  room.turn = Room.other(side)
  // 任何走子都清掉未决提议
  room.pendingOffer = null
  room.offerBy = null
}

/** 处理认输 */
function handleResign(conn) {
  const room = conn.room
  if (!room || room.over) return
  room.over = true
  room.touch()
  room.broadcast({
    type: 'game-over',
    winner: Room.other(conn.side),
    reason: 'resign',
  })
}

/** 处理和棋提议 */
function handleDrawOffer(conn) {
  const room = conn.room
  if (!room || room.over) return
  if (room.pendingOffer) {
    sendError(conn, 'bad-message', '已有待回应的提议')
    return
  }
  room.pendingOffer = 'draw'
  room.offerBy = conn.side
  room.touch()
  room.sendToOpponent(conn.side, { type: 'draw-offered' })
}

/** 处理悔棋提议 */
function handleUndoOffer(conn) {
  const room = conn.room
  if (!room || room.over) return
  if (room.pendingOffer) {
    sendError(conn, 'bad-message', '已有待回应的提议')
    return
  }
  room.pendingOffer = 'undo'
  room.offerBy = conn.side
  room.touch()
  room.sendToOpponent(conn.side, { type: 'undo-offered' })
}

/** 处理和棋回应 */
function handleDrawReply(conn, msg) {
  const room = conn.room
  if (!room || room.over) return
  if (room.pendingOffer !== 'draw' || room.offerBy === conn.side) return

  const accepted = msg.accept === true
  room.pendingOffer = null
  room.offerBy = null
  room.touch()

  if (accepted) {
    room.over = true
    room.broadcast({ type: 'draw-resolved', accepted: true })
    room.broadcast({ type: 'game-over', winner: null, reason: 'draw-agreed' })
  } else {
    room.broadcast({ type: 'draw-resolved', accepted: false })
  }
}

/** 处理悔棋回应 */
function handleUndoReply(conn, msg) {
  const room = conn.room
  if (!room || room.over) return
  if (room.pendingOffer !== 'undo' || room.offerBy === conn.side) return

  const accepted = msg.accept === true
  // 先记下提议方，再清空 pendingOffer/offerBy——
  // 顺序反了会把「悔棋后轮到谁」弄丢
  const offerBy = room.offerBy
  room.pendingOffer = null
  room.offerBy = null
  room.touch()

  if (accepted) {
    // 悔棋一步：把轮次还给提议方（他撤销了自己的走子，应该重新轮到他）
    if (offerBy) room.turn = offerBy
    room.broadcast({ type: 'undo-resolved', accepted: true })
    systemSay(room, '对手同意悔棋')
  } else {
    room.broadcast({ type: 'undo-resolved', accepted: false })
  }
}

/** 处理聊天 */
function handleChat(conn, msg) {
  const room = conn.room
  if (!room) return
  const text = String(msg.text || '').slice(0, 200).trim()
  if (!text) return
  room.touch()
  const name = conn.side ? room.players[conn.side]?.name ?? '玩家' : '玩家'
  room.broadcast({ type: 'chat', from: name, text })
}

/** 处理重连 */
function handleReconnect(conn, msg) {
  const code = String(msg.room || '').toUpperCase().trim()
  const room = rooms.get(code)
  if (!room) {
    sendError(conn, 'room-not-found', '房间不存在或已关闭')
    return
  }

  // 用 token 找回身份
  let side = null
  if (room.players.first?.token === msg.token) side = 'first'
  else if (room.players.second?.token === msg.token) side = 'second'

  if (!side) {
    sendError(conn, 'bad-token', '重连凭据无效')
    return
  }

  const player = room.players[side]
  // 旧连接若还在，先关掉（同一身份的重复连接）
  if (player.conn && player.conn !== conn) {
    player.conn.closed = true
    try {
      player.conn.socket.destroy()
    } catch {
      /* 已断开 */
    }
  }

  player.conn = conn
  conn.room = room
  conn.side = side
  connIndex.set(conn, { room, side })
  room.touch()

  const opponent = room.players[Room.other(side)]

  conn.send({
    type: 'joined',
    room: code,
    token: msg.token,
    side,
    game: room.game,
    forbidden: room.forbidden,
    opponent: opponent?.name ?? '对手',
    opponentOnline: !!opponent?.conn,
  })

  // 通知对手回来了
  room.sendToOpponent(side, { type: 'opponent-online' })
  systemSay(room, `${player.name} 重新连接`)
}

/** 处理离开 */
function handleLeave(conn) {
  const room = conn.room
  if (!room) return
  const side = conn.side
  const player = side ? room.players[side] : null

  if (player) player.conn = null
  connIndex.delete(conn)
  conn.room = null
  conn.side = null

  room.touch()

  if (room.connCount() === 0) {
    room.checkDestroyTimer()
    return
  }

  // 对手还在：告知对方
  if (side) {
    room.sendToOpponent(side, { type: 'opponent-left', temporary: false })
    if (!room.over) {
      room.over = true
      room.broadcast({ type: 'game-over', winner: Room.other(side), reason: 'disconnect' })
    }
  }
}

/** 断线处理（非主动离开） */
function handleDisconnect(conn) {
  const entry = connIndex.get(conn)
  if (!entry) return
  const { room, side } = entry
  connIndex.delete(conn)

  const player = room.players[side]
  if (player && player.conn === conn) player.conn = null

  room.touch()
  room.sendToOpponent(side, { type: 'opponent-left', temporary: true })
  systemSay(room, `${player?.name ?? '对手'} 断线了`)

  if (room.connCount() === 0) room.checkDestroyTimer()
}

/** 分发一条客户端消息 */
function dispatch(conn, raw) {
  let msg
  try {
    msg = JSON.parse(raw)
  } catch {
    sendError(conn, 'bad-message', '消息不是合法 JSON')
    return
  }
  if (typeof msg !== 'object' || msg === null || typeof msg.type !== 'string') {
    sendError(conn, 'bad-message', '消息缺少 type 字段')
    return
  }

  // 版本校验：只对带 version 的消息检查
  if ('version' in msg && msg.version !== PROTOCOL_VERSION) {
    sendError(conn, 'version-mismatch', '客户端版本不匹配，请刷新页面')
    return
  }

  switch (msg.type) {
    case 'create':
      handleCreate(conn, msg)
      break
    case 'join':
      handleJoin(conn, msg)
      break
    case 'move':
      handleMove(conn, msg)
      break
    case 'resign':
      handleResign(conn)
      break
    case 'draw-offer':
      handleDrawOffer(conn)
      break
    case 'draw-reply':
      handleDrawReply(conn, msg)
      break
    case 'undo-offer':
      handleUndoOffer(conn)
      break
    case 'undo-reply':
      handleUndoReply(conn, msg)
      break
    case 'chat':
      handleChat(conn, msg)
      break
    case 'reconnect':
      handleReconnect(conn, msg)
      break
    case 'leave':
      handleLeave(conn)
      break
    case 'ping':
      conn.send({ type: 'pong' })
      break
    default:
      sendError(conn, 'bad-message', `未知消息类型: ${msg.type}`)
  }
}

// ==================== HTTP 与静态文件 ====================

/** 扩展名 → Content-Type */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
}

/** 健康检查与房间统计 */
function handleApi(req, res, url) {
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, uptime: process.uptime() }))
    return true
  }
  if (url.pathname === '/api/stats') {
    let players = 0
    for (const room of rooms.values()) players += room.connCount()
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ rooms: rooms.size, players }))
    return true
  }
  return false
}

/** 静态文件服务，带 SPA 回退 */
function serveStatic(req, res, url) {
  let pathname
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    res.writeHead(400)
    res.end('Bad Request')
    return
  }
  if (pathname === '/') pathname = '/index.html'

  // 防目录穿越：解析后必须仍在 STATIC_ROOT 内
  const target = path.resolve(STATIC_ROOT, '.' + pathname)
  if (!target.startsWith(STATIC_ROOT)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  fs.stat(target, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA 回退：非文件请求一律给 index.html
      const indexPath = path.join(STATIC_ROOT, 'index.html')
      fs.readFile(indexPath, (e2, data) => {
        if (e2) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('未找到 dist/index.html，请先构建前端')
          return
        }
        res.writeHead(200, { 'Content-Type': MIME['.html'] })
        res.end(data)
      })
      return
    }

    const ext = path.extname(target).toLowerCase()
    const type = MIME[ext] ?? 'application/octet-stream'
    // 静态资源缓存：HTML 不缓存，其余长缓存（文件名带内容哈希时更安全，
    // 这里产物文件名固定，因此给较短缓存并允许重验证）
    const cache = ext === '.html' ? 'no-cache' : 'public, max-age=3600'

    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': cache,
      // Service Worker 需要正确的作用域，无需额外头
      'X-Content-Type-Options': 'nosniff',
    })
    fs.createReadStream(target).pipe(res)
  })
}

// ==================== 服务器 ====================

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

  // CORS：允许本地开发时前端从 5173 访问
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (handleApi(req, res, url)) return
  serveStatic(req, res, url)
})

/** WebSocket 升级 */
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key']
  const version = req.headers['sec-websocket-version']

  if (!key || version !== '13') {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
    socket.destroy()
    return
  }

  const accept = crypto
    .createHash('sha1')
    .update(key + WS_GUID)
    .digest('base64')

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      '\r\n',
  )

  const conn = new WsConnection(socket, req)
  conn.onMessage = (text) => dispatch(conn, text)
  conn.onClose = () => handleDisconnect(conn)

  // 心跳：定期 ping，超时未响应则断开
  const heartbeat = setInterval(() => {
    if (conn.closed) {
      clearInterval(heartbeat)
      return
    }
    if (Date.now() - conn.lastSeen > DEAD_AFTER_MS) {
      clearInterval(heartbeat)
      conn.close(1001)
      return
    }
    conn.ping()
  }, HEARTBEAT_MS)

  socket.on('close', () => clearInterval(heartbeat))
})

/** 定期清理过期房间 */
setInterval(() => {
  const now = Date.now()
  for (const [code, room] of rooms) {
    if (room.destroyAt && now > room.destroyAt) {
      rooms.delete(code)
      continue
    }
    // 双方都在线但长时间无操作，不销毁（对局可能很长）
    // 只有全员离线的房间才走 destroyAt 计时
  }
}, 60 * 1000)

server.listen(PORT, HOST, () => {
  console.log(`[chess-app] 服务已启动`)
  console.log(`  监听:   http://${HOST}:${PORT}`)
  console.log(`  静态:   ${STATIC_ROOT}`)
  console.log(`  健康:   http://localhost:${PORT}/api/health`)
})

/** 优雅退出：关闭所有连接后退出 */
function shutdown(signal) {
  console.log(`\n[chess-app] 收到 ${signal}，正在关闭…`)
  for (const conn of connIndex.keys()) {
    try {
      conn.close(1001)
    } catch {
      /* 已断开 */
    }
  }
  server.close(() => process.exit(0))
  // 兜底：5 秒后强制退出
  setTimeout(() => process.exit(0), 5000)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

module.exports = { server }
