import { useEffect, useRef } from 'react'
import Board from './Board'
import MoveList from './MoveList'
import Clock from './Clock'
import ScorePanel from './ScorePanel'
import OnlinePanel from './OnlinePanel'
import { useGameStore } from '../store/gameStore'
import { useOnlineStore } from '../store/onlineStore'
import { TERMINATION_TEXT, GameStatus } from '../core/result'
import { get } from '../core/registry'
import { think as thinkAi, hasAi } from '../ai'
import { DIFFICULTY_PROFILES } from '../ai/types'
import { FORBIDDEN_TEXT } from '../games/gomoku/forbidden'

/**
 * 结果文案，如“白方胜 · 将杀”。
 * 阵营称呼来自棋种 meta，不能写死「白方/黑方」。
 */
function resultText(
  status: string,
  reason: string | null,
  firstLabel: string,
  secondLabel: string,
): string {
  const byReason = reason
    ? TERMINATION_TEXT[reason as keyof typeof TERMINATION_TEXT]
    : ''
  if (status === GameStatus.FirstWin) return `${firstLabel}胜 · ${byReason}`
  if (status === GameStatus.SecondWin) return `${secondLabel}胜 · ${byReason}`
  if (status === GameStatus.Draw) return `和棋 · ${byReason}`
  return ''
}

/**
 * 对局页：左侧棋盘，右侧信息栏（结果、计时、着法、操作按钮）。
 *
 * 三种对局共用本组件：
 * - 本地双人
 * - 本地人机（三种棋都有 AI）
 * - 联机（额外渲染 OnlinePanel，AI 不参与）
 *
 * online 为 true 时，界面切换为联机语义：不驱动 AI、
 * 悔棋与和棋需要对方同意、返回按钮离开房间。
 */
export default function GameScreen({ online = false }: { online?: boolean }) {
  const gameId = useGameStore((s) => s.gameId)
  const turn = useGameStore((s) => s.turn)
  const result = useGameStore((s) => s.result)
  const history = useGameStore((s) => s.history)
  const position = useGameStore((s) => s.position)
  const opponent = useGameStore((s) => s.opponent)
  const difficulty = useGameStore((s) => s.difficulty)
  const thinking = useGameStore((s) => s.thinking)
  const forbidden = useGameStore((s) => s.forbidden)
  const undo = useGameStore((s) => s.undo)
  const restart = useGameStore((s) => s.restart)
  const resign = useGameStore((s) => s.resign)
  const leave = useGameStore((s) => s.leave)
  const move = useGameStore((s) => s.move)
  const setThinking = useGameStore((s) => s.setThinking)
  const engine = useGameStore((s) => s.engine)

  const onlinePhase = useOnlineStore((s) => s.phase)
  const onlineOpponent = useOnlineStore((s) => s.opponent)
  const onlineSide = useOnlineStore((s) => s.side)
  const onlineConn = useOnlineStore((s) => s.conn)
  const onlineLeave = useOnlineStore((s) => s.leave)
  const onlineResign = useOnlineStore((s) => s.resign)

  const finished = result.status !== 'ongoing'
  const meta = gameId ? get(gameId).meta : null
  const firstLabel = meta?.sides.first ?? '先行方'
  const secondLabel = meta?.sides.second ?? '后行方'
  const firstTurn = meta?.firstTurn ?? 'w'
  const inCheck = !finished && engine ? engine.isCheck() : false

  // AI 执后行方：该棋种有 AI 时才驱动引擎；联机时永远不驱动
  /**
   * 人机对战：玩家执先行方，AI 执后行方。
   *
   * 两个条件必须分开：
   * - aiEnabled：这局有没有 AI（联机时永远没有）
   * - isAiTurn：现在是不是该 AI 走
   *
   * 混成一个变量会出事：若用 aiSide === firstTurn 判断，
   * 「轮到 AI」这个条件就退化成「轮到先行方」，
   * 而先行方恰恰是玩家，于是 AI 永远不走子、玩家也被锁住。
   */
  const aiEnabled = !online && opponent === 'ai' && !!meta && hasAi(meta.id)
  const isAiTurn = aiEnabled && turn !== firstTurn
  const abortRef = useRef<AbortController | null>(null)
  /** 记录已为哪个局面发起过思考，避免 StrictMode 重复挂载造成重复触发 */
  const askedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!isAiTurn || finished || !position || !meta) return

    // 同一局面只发起一次，重复挂载直接跳过
    const key = `${position}|${difficulty}|${forbidden}`
    if (askedRef.current === key) return
    askedRef.current = key

    const controller = new AbortController()
    abortRef.current = controller
    setThinking(true)

    thinkAi(meta.id, { difficulty, position, turn, signal: controller.signal, forbidden })
      .then((best) => {
        if (!best) return
        // 不因 abort 丢弃结果：StrictMode 的清理会误伤，
        // 只要局面仍是该 walk 状态，落子就是正确的
        move(best)
      })
      .catch(() => {
        // 引擎不可用时静默失败：AI 不走子，但界面不能崩
      })
      .finally(() => {
        setThinking(false)
      })

    return () => {
      // 只在局面真正变化时才打断；组件卸载时也清理
      controller.abort()
      abortRef.current = null
    }
    // position 变化即触发新一轮；turn 用于判断是否轮到 AI
  }, [isAiTurn, finished, turn, position, difficulty, move, setThinking, firstTurn, meta, forbidden])

  // 当前走子方的称呼
  const turnLabel = turn === firstTurn ? firstLabel : secondLabel

  /** 顶部状态文字 */
  const statusText = finished
    ? '对局结束'
    : online
      ? onlineConn !== 'open'
        ? '连接中断…'
        : `${turnLabel}走子`
      : thinking
        ? '电脑思考中…'
        : inCheck
          ? `${turnLabel}走子 · 被将军`
          : `${turnLabel}走子`

  /** 返回：联机时离开房间，本地时回大厅 */
  function handleBack(): void {
    if (online) onlineLeave()
    else leave()
  }

  /** 认输：联机时告知服务端，本地时直接写入结果 */
  function handleResign(): void {
    if (online) onlineResign()
    else resign()
  }

  return (
    <div className={`game ${online ? 'is-online' : ''}`}>
      <header className="game-header">
        <button className="btn-ghost" onClick={handleBack}>
          {online ? '离开房间' : '返回大厅'}
        </button>
        <h1 className="game-title">
          {meta?.name ?? '对局'}
          {online && onlineSide && (
            <span className="game-title-sub">
              你执{onlineSide === 'first' ? firstLabel : secondLabel}
            </span>
          )}
        </h1>
        <span className="game-turn">{statusText}</span>
      </header>

      <div className="game-body">
        <div className="game-board">
          <Board />
        </div>

        <aside className="game-side">
          {finished && (
            <div className="result-banner">
              {resultText(result.status, result.reason, firstLabel, secondLabel)}
            </div>
          )}

          {inCheck && <div className="check-banner">{turnLabel}被将军</div>}

          {forbidden && gameId === 'gomoku' && (
            <div className="rule-banner">黑棋禁手：{Object.values(FORBIDDEN_TEXT).join('、')}</div>
          )}

          {!online && opponent === 'ai' && meta?.supportsAi && (
            <div className="ai-info">
              对手：电脑 · {DIFFICULTY_PROFILES[difficulty].label}
            </div>
          )}

          {!online && opponent === 'ai' && !meta?.supportsAi && (
            <div className="ai-info ai-info--warn">
              该棋种暂无电脑对手，已按双人对下进行
            </div>
          )}

          {online && <OnlinePanel />}

          {!online && <Clock />}

          <ScorePanel />

          <MoveList />

          <div className="game-actions">
            {online ? (
              <>
                <button
                  className="btn"
                  onClick={handleResign}
                  disabled={finished || onlinePhase !== 'playing'}
                >
                  认输
                </button>
                <button className="btn btn-primary" onClick={onlineLeave}>
                  离开房间
                </button>
              </>
            ) : (
              <>
                <button
                  className="btn"
                  onClick={undo}
                  disabled={history.length === 0 || finished || thinking}
                >
                  悔棋
                </button>
                <button className="btn" onClick={handleResign} disabled={finished}>
                  认输
                </button>
                <button className="btn btn-primary" onClick={restart}>
                  重开
                </button>
              </>
            )}
          </div>
        </aside>
      </div>

      {online && onlineOpponent && (
        <footer className="game-footer">
          对手：{onlineOpponent}
          {onlinePhase === 'finished' ? ' · 对局已结束' : ''}
        </footer>
      )}
    </div>
  )
}
