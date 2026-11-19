import { useGameStore } from '../store/gameStore'
import { getAll } from '../core/registry'
import { DIFFICULTY_PROFILES } from '../ai/types'
import type { Difficulty } from '../ai/types'
import { useState } from 'react'

/**
 * 棋种选择页。
 * 卡片由注册表自动生成，当前有国际象棋、中国象棋、五子棋三种。
 * 可选对手类型（双人 / 电脑）与 AI 难度。
 *
 * 「与电脑对下」对所有棋种都可用（三种棋都已接入 AI）。
 * 五子棋额外提供禁手开关。
 */
export default function Lobby({ onOnline }: { onOnline: () => void }) {
  const start = useGameStore((s) => s.start)
  const opponent = useGameStore((s) => s.opponent)
  const difficulty = useGameStore((s) => s.difficulty)
  const setOpponent = useGameStore((s) => s.setOpponent)
  const setDifficulty = useGameStore((s) => s.setDifficulty)
  const games = getAll()

  /** 五子棋禁手开关，仅本页使用，开局时传给 start */
  const [forbidden, setForbidden] = useState(false)

  // 只要有一个棋种支持 AI，就允许选择「与电脑对下」
  const anySupportsAi = games.some((g) => g.meta.supportsAi)

  return (
    <div className="lobby">
      <h1 className="lobby-title">选择棋种</h1>

      <div className="lobby-options">
        <div className="option-row">
          <span className="option-label">对手</span>
          <button
            className={`chip ${opponent === 'human' ? 'is-on' : ''}`}
            onClick={() => setOpponent('human')}
          >
            双人对下
          </button>
          <button
            className={`chip ${opponent === 'ai' ? 'is-on' : ''}`}
            onClick={() => setOpponent('ai')}
            disabled={!anySupportsAi}
            title={anySupportsAi ? undefined : '暂无可用的电脑对手'}
          >
            与电脑对下
          </button>
        </div>

        {opponent === 'ai' && (
          <div className="option-row">
            <span className="option-label">难度</span>
            {(Object.keys(DIFFICULTY_PROFILES) as Difficulty[]).map((d) => (
              <button
                key={d}
                className={`chip ${difficulty === d ? 'is-on' : ''}`}
                onClick={() => setDifficulty(d)}
                title={`约 ${DIFFICULTY_PROFILES[d].approxElo} 分`}
              >
                {DIFFICULTY_PROFILES[d].label}
              </button>
            ))}
          </div>
        )}

        <div className="option-row">
          <span className="option-label">五子棋</span>
          <button
            className={`chip ${forbidden ? 'is-on' : ''}`}
            onClick={() => setForbidden((v) => !v)}
            title="黑棋三三、四四、长连禁手"
          >
            {forbidden ? '禁手已开' : '禁手关闭'}
          </button>
        </div>
      </div>

      <div className="lobby-grid">
        {games.map((g) => (
          <button
            key={g.meta.id}
            className="game-card"
            onClick={() =>
              start(
                g.meta.id,
                // 人机对战：玩家执先行方，AI 执后行方。
                // 必须与 GameScreen 的 isAiTurn 判定一致，否则双方会被派到同一阵营，
                // 导致玩家点不动、AI 也不走子。
                opponent === 'ai' && g.meta.supportsAi ? 'first' : 'both',
                opponent,
                difficulty,
                forbidden,
              )
            }
          >
            <span className="game-card-name">{g.meta.name}</span>
            <span className="game-card-desc">{g.meta.description}</span>
            <span className="game-card-meta">
              {g.meta.width} × {g.meta.height}
              {g.meta.supportsAi ? ' · 可对电脑' : ' · 双人'}
            </span>
          </button>
        ))}
      </div>

      <button className="online-entry" onClick={onOnline}>
        <span className="online-entry-title">联机对局</span>
        <span className="online-entry-desc">和远方的朋友下一局 · 房间码进房</span>
      </button>

      <p className="lobby-hint">
        三种棋都支持与电脑对下。联机需要双方各自打开本页，用房间码进房。
      </p>
    </div>
  )
}
