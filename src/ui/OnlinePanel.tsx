/**
 * 联机信息面板：对手、连接状态、提议、聊天。
 *
 * 只在联机对局中渲染。本地对局完全不加载本组件。
 */
import { useEffect, useRef, useState } from 'react'
import { useOnlineStore } from '../store/onlineStore'
import { GAME_NAME } from '../net/protocol'

export default function OnlinePanel() {
  const room = useOnlineStore((s) => s.room)
  const side = useOnlineStore((s) => s.side)
  const game = useOnlineStore((s) => s.game)
  const opponent = useOnlineStore((s) => s.opponent)
  const opponentOnline = useOnlineStore((s) => s.opponentOnline)
  const conn = useOnlineStore((s) => s.conn)
  const chat = useOnlineStore((s) => s.chat)
  const pendingOffer = useOnlineStore((s) => s.pendingOffer)
  const offerSent = useOnlineStore((s) => s.offerSent)
  const phase = useOnlineStore((s) => s.phase)
  const say = useOnlineStore((s) => s.say)
  const offerDraw = useOnlineStore((s) => s.offerDraw)
  const offerUndo = useOnlineStore((s) => s.offerUndo)
  const replyDraw = useOnlineStore((s) => s.replyDraw)
  const replyUndo = useOnlineStore((s) => s.replyUndo)

  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement | null>(null)

  // 新消息滚动到底部
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat.length])

  const finished = phase === 'finished'

  function submit(): void {
    const text = draft.trim()
    if (!text) return
    say(text)
    setDraft('')
  }

  return (
    <div className="online-panel">
      <div className="online-panel-head">
        <span className="online-panel-room">房间 {room}</span>
        <span className={`online-conn ${conn === 'open' ? 'is-on' : 'is-warn'}`}>
          {conn === 'open' ? '在线' : conn === 'reconnecting' ? '重连中' : '离线'}
        </span>
      </div>

      <div className="online-panel-rows">
        <div className="online-panel-row">
          <span className="online-panel-key">棋种</span>
          <span className="online-panel-val">{game ? GAME_NAME[game] : '—'}</span>
        </div>
        <div className="online-panel-row">
          <span className="online-panel-key">你</span>
          <span className="online-panel-val">
            {side === 'first' ? '先行方' : '后行方'}
          </span>
        </div>
        <div className="online-panel-row">
          <span className="online-panel-key">对手</span>
          <span className="online-panel-val">
            {opponent || '等待加入'}
            <span className={`online-dot ${opponentOnline ? 'is-on' : ''}`} />
          </span>
        </div>
      </div>

      {pendingOffer && (
        <div className="online-offer">
          <span>对手提议{pendingOffer === 'draw' ? '和棋' : '悔棋'}</span>
          <div className="online-offer-actions">
            <button
              className="btn btn-small btn-primary"
              onClick={() => (pendingOffer === 'draw' ? replyDraw(true) : replyUndo(true))}
            >
              同意
            </button>
            <button
              className="btn btn-small"
              onClick={() => (pendingOffer === 'draw' ? replyDraw(false) : replyUndo(false))}
            >
              拒绝
            </button>
          </div>
        </div>
      )}

      {offerSent && <div className="online-waiting-reply">已提议{offerSent === 'draw' ? '和棋' : '悔棋'}，等待对手回应…</div>}

      <div className="online-chat" ref={listRef}>
        {chat.length === 0 && <div className="online-chat-empty">还没有消息</div>}
        {chat.map((c, i) => (
          <div key={i} className={`online-chat-line ${c.system ? 'is-system' : ''}`}>
            <span className="online-chat-from">{c.from}</span>
            <span className="online-chat-text">{c.text}</span>
          </div>
        ))}
      </div>

      <div className="online-chat-input">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          placeholder="说点什么…"
          maxLength={200}
        />
        <button className="btn btn-small" onClick={submit} disabled={!draft.trim()}>
          发送
        </button>
      </div>

      {!finished && (
        <div className="online-panel-actions">
          <button className="btn btn-small" onClick={offerUndo} disabled={!!offerSent || !!pendingOffer}>
            提议悔棋
          </button>
          <button className="btn btn-small" onClick={offerDraw} disabled={!!offerSent || !!pendingOffer}>
            提议和棋
          </button>
        </div>
      )}
    </div>
  )
}
