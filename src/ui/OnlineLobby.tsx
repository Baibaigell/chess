/**
 * 联机大厅：建房、进房、等待对手。
 *
 * 三个阶段复用同一个组件：
 * - lobby：填昵称、选棋种、建房或输入房间码
 * - waiting：显示房间码，等对手进来
 * - playing / finished：由 GameScreen 接管，本组件不渲染
 */
import { useEffect, useState } from 'react'
import { useOnlineStore } from '../store/onlineStore'
import type { GameId } from '../net/protocol'
import { GAME_NAME } from '../net/protocol'
import { getAll } from '../core/registry'
import {
  getServerUrl,
  setServerUrl,
  resetServerUrl,
  validateServerUrl,
  resolveServerUrl,
} from '../net/client'

/** 昵称存在 localStorage，下次自动填 */
const NAME_KEY = 'chess-app.online.name'

/** 取上次用过的昵称 */
function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

/** 记住昵称 */
function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name)
  } catch {
    /* 隐私模式 */
  }
}

export default function OnlineLobby({ onBack }: { onBack: () => void }) {
  const phase = useOnlineStore((s) => s.phase)
  const conn = useOnlineStore((s) => s.conn)
  const room = useOnlineStore((s) => s.room)
  const game = useOnlineStore((s) => s.game)
  const error = useOnlineStore((s) => s.error)
  const createRoom = useOnlineStore((s) => s.createRoom)
  const joinRoom = useOnlineStore((s) => s.joinRoom)
  const leave = useOnlineStore((s) => s.leave)
  const clearError = useOnlineStore((s) => s.clearError)

  const [name, setName] = useState(loadName)
  const [selectedGame, setSelectedGame] = useState<GameId>('gomoku')
  const [forbidden, setForbidden] = useState(false)
  const [joinCode, setJoinCode] = useState('')

  /** 服务器设置：输入框内容与已保存值的对比 */
  const [serverInput, setServerInput] = useState(() => getServerUrl() ?? '')
  const [serverMsg, setServerMsg] = useState<string | null>(null)
  /** 当前实际生效的地址，用于展示 */
  const [activeUrl, setActiveUrl] = useState(() => resolveServerUrl())

  useEffect(() => {
    saveName(name)
  }, [name])

  /**
   * 保存服务器地址并立刻重连。
   *
   * 地址变化后旧连接指向错误的服务端，必须重建：
   * leave() 会断开并清空房间状态，再 enterLobby() 用新地址连。
   */
  function applyServer(): void {
    const bad = validateServerUrl(serverInput)
    if (bad) {
      setServerMsg(bad)
      return
    }
    setServerUrl(serverInput)
    const next = resolveServerUrl()
    setActiveUrl(next)
    setServerInput(getServerUrl() ?? '')
    setServerMsg(`已保存，正在连接 ${next}`)
    // 重建连接：先清干净再连，避免旧 socket 干扰
    useOnlineStore.getState().leave()
    useOnlineStore.getState().enterLobby()
  }

  /** 清除自定义地址，回到同源 */
  function restoreServer(): void {
    resetServerUrl()
    setServerInput('')
    const next = resolveServerUrl()
    setActiveUrl(next)
    setServerMsg(`已恢复默认，正在连接 ${next}`)
    useOnlineStore.getState().leave()
    useOnlineStore.getState().enterLobby()
  }

  /** 连接状态的文字说明 */
  const connText =
    conn === 'open'
      ? '已连接'
      : conn === 'connecting'
        ? '连接中…'
        : conn === 'reconnecting'
          ? '重连中…'
          : conn === 'closed'
            ? '未连接'
            : '待连接'

  const connClass =
    conn === 'open' ? 'is-on' : conn === 'reconnecting' || conn === 'connecting' ? 'is-warn' : ''

  // ---------- 等待对手 ----------
  if (phase === 'waiting') {
    return (
      <div className="online">
        <header className="game-header">
          <button className="btn-ghost" onClick={leave}>
            取消
          </button>
          <h1 className="game-title">等待对手</h1>
          <span className={`online-conn ${connClass}`}>{connText}</span>
        </header>

        <div className="online-wait">
          <p className="online-wait-hint">把下面的房间码告诉朋友</p>
          <div className="room-code">{room}</div>
          <p className="online-wait-meta">
            {game ? GAME_NAME[game] : ''}
            {game === 'gomoku' ? (forbidden ? ' · 禁手' : ' · 无禁手') : ''}
          </p>
          <p className="online-wait-tip">
            朋友在「加入房间」里输入这 4 位码即可开始对局。
          </p>
        </div>
      </div>
    )
  }

  // ---------- 建房 / 进房 ----------
  const games = getAll()
  const trimmedName = name.trim() || '玩家'

  return (
    <div className="online">
      <header className="game-header">
        <button className="btn-ghost" onClick={onBack}>
          返回
        </button>
        <h1 className="game-title">联机对局</h1>
        <span className={`online-conn ${connClass}`}>{connText}</span>
      </header>

      {error && (
        <div className="online-error" onClick={clearError} role="button" tabIndex={0}>
          {error}
          <span className="online-error-close">×</span>
        </div>
      )}

      <div className="online-body">
        <section className="online-card">
          <h2 className="online-card-title">服务器</h2>
          <p className="online-server-hint">
            联机服务端的地址。浏览器同域部署可留空；APK 里必须填写，否则连不上。
          </p>
          <input
            className="online-input online-server-input"
            value={serverInput}
            onChange={(e) => {
              setServerInput(e.target.value)
              setServerMsg(null)
            }}
            placeholder="wss://your-server.onrender.com"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
          <p className="online-server-current">
            当前：<code>{activeUrl}</code>
          </p>
          {serverMsg && <p className="online-server-msg">{serverMsg}</p>}
          <div className="online-server-actions">
            <button className="btn btn-primary btn-small" onClick={applyServer}>
              保存并重连
            </button>
            <button className="btn btn-small" onClick={restoreServer}>
              恢复默认
            </button>
          </div>
        </section>

        <section className="online-card">
          <h2 className="online-card-title">你的昵称</h2>
          <input
            className="online-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="玩家"
            maxLength={16}
          />
        </section>

        <section className="online-card">
          <h2 className="online-card-title">创建房间</h2>

          <div className="online-games">
            {games.map((g) => (
              <button
                key={g.meta.id}
                className={`online-game ${selectedGame === g.meta.id ? 'is-on' : ''}`}
                onClick={() => setSelectedGame(g.meta.id as GameId)}
              >
                <span className="online-game-name">{g.meta.name}</span>
                <span className="online-game-desc">{g.meta.width} × {g.meta.height}</span>
              </button>
            ))}
          </div>

          {selectedGame === 'gomoku' && (
            <label className="online-check">
              <input
                type="checkbox"
                checked={forbidden}
                onChange={(e) => setForbidden(e.target.checked)}
              />
              <span>启用黑棋禁手（三三、四四、长连）</span>
            </label>
          )}

          <button
            className="btn btn-primary online-submit"
            disabled={conn !== 'open'}
            onClick={() => createRoom(selectedGame, trimmedName, forbidden)}
          >
            {conn === 'open' ? '创建房间' : '连接中…'}
          </button>
        </section>

        <section className="online-card">
          <h2 className="online-card-title">加入房间</h2>
          <input
            className="online-input online-input--code"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 4))}
            placeholder="4 位房间码"
            maxLength={4}
            autoCapitalize="characters"
          />
          <button
            className="btn online-submit"
            disabled={conn !== 'open' || joinCode.length !== 4}
            onClick={() => joinRoom(joinCode, trimmedName)}
          >
            加入
          </button>
        </section>

        <p className="lobby-hint">
          两人各用一台设备，同一房间码即可对弈。断线后刷新页面会自动重连回原对局。
        </p>
      </div>
    </div>
  )
}
