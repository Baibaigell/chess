/**
 * 计时器（加秒制）。
 *
 * 本批先做加秒制：每方基础时间 + 每次走子后增加秒数。
 * 包干制（无加秒）后续再补，逻辑上等同 increment = 0。
 *
 * 阵营不写死为白/黑：用 meta.firstTurn 判断先行方，
 * 否则象棋（红先行）与五子棋（黑先行）会扣错一方的时间。
 */
import { useEffect, useRef, useState } from 'react'
import { useGameStore } from '../store/gameStore'
import { get } from '../core/registry'

export interface ClockProps {
  /** 每方基础时间（秒） */
  baseSeconds?: number
  /** 每次走子增加的秒数 */
  incrementSeconds?: number
}

function format(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}

/**
 * 一个计时器同时管双方。只有当前走子方的时间在减少。
 * 对局结束时停止。
 */
export default function Clock({
  baseSeconds = 300,
  incrementSeconds = 3,
}: ClockProps) {
  const turn = useGameStore((s) => s.turn)
  const history = useGameStore((s) => s.history)
  const result = useGameStore((s) => s.result)
  const gameId = useGameStore((s) => s.gameId)
  const finished = result.status !== 'ongoing'

  const meta = gameId ? get(gameId).meta : null
  const firstTurn = meta?.firstTurn ?? 'w'
  const firstLabel = meta?.sides.first ?? '先行'
  const secondLabel = meta?.sides.second ?? '后行'

  const [firstTime, setFirstTime] = useState(baseSeconds)
  const [secondTime, setSecondTime] = useState(baseSeconds)
  const prevHistoryLenRef = useRef(history.length)

  /** 当前是否轮到先行方 */
  const isFirstTurn = turn === firstTurn

  // 有人走子后，给刚走完的一方加秒
  useEffect(() => {
    if (history.length > prevHistoryLenRef.current) {
      // 刚走子的一方现在是「对方」，因此谁不是当前走子方谁得加秒
      if (isFirstTurn) setSecondTime((t) => t + incrementSeconds)
      else setFirstTime((t) => t + incrementSeconds)
    }
    prevHistoryLenRef.current = history.length
  }, [history.length, isFirstTurn, incrementSeconds])

  // 每秒扣当前走子方 1 秒
  useEffect(() => {
    if (finished) return
    const id = window.setInterval(() => {
      if (isFirstTurn) setFirstTime((t) => Math.max(0, t - 1))
      else setSecondTime((t) => Math.max(0, t - 1))
    }, 1000)
    return () => window.clearInterval(id)
  }, [isFirstTurn, finished])

  // 重开或换局时重置
  useEffect(() => {
    if (history.length === 0) {
      setFirstTime(baseSeconds)
      setSecondTime(baseSeconds)
    }
  }, [history.length, baseSeconds])

  return (
    <div className="clock">
      <div className={`clock-side ${!isFirstTurn && !finished ? 'is-active' : ''}`}>
        <span className="clock-color">{secondLabel}</span>
        <span className="clock-time">{format(secondTime)}</span>
      </div>
      <div className={`clock-side ${isFirstTurn && !finished ? 'is-active' : ''}`}>
        <span className="clock-color">{firstLabel}</span>
        <span className="clock-time">{format(firstTime)}</span>
      </div>
      <p className="clock-hint">
        加秒制：{Math.round(baseSeconds / 60)} 分钟 + 每步 {incrementSeconds} 秒
      </p>
    </div>
  )
}
