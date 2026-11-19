import { useGameStore } from '../store/gameStore'
import { computeScore, formatAdvantage, hasScoring } from '../core/score'
import { get } from '../core/registry'

/**
 * 积分面板：显示双方吃子得分与净分差。
 * 分值由着法历史实时推导，不单独存状态，避免与历史不同步。
 *
 * 五子棋没有吃子，该面板不显示。
 */
export default function ScorePanel() {
  const history = useGameStore((s) => s.history)
  const gameId = useGameStore((s) => s.gameId)

  // 无吃子的棋种不显示本面板
  if (!hasScoring(gameId)) return null

  const score = computeScore(history, gameId)
  const meta = gameId ? get(gameId).meta : null
  const firstLabel = meta?.sides.first ?? '先行方'
  const secondLabel = meta?.sides.second ?? '后行方'

  return (
    <div className="score-panel">
      <h2 className="panel-title">吃子积分</h2>
      <div className="score-rows">
        <div className="score-row">
          <span className="score-side">{firstLabel}</span>
          <span className="score-value">{score.first}</span>
        </div>
        <div className="score-row">
          <span className="score-side">{secondLabel}</span>
          <span className="score-value">{score.second}</span>
        </div>
      </div>
      <div
        className={`score-advantage ${
          score.advantage > 0 ? 'is-first' : score.advantage < 0 ? 'is-second' : ''
        }`}
      >
        {score.advantage === 0
          ? '子力均势'
          : score.advantage > 0
            ? `${firstLabel}领先 ${formatAdvantage(score.advantage)}`
            : `${secondLabel}领先 ${formatAdvantage(-score.advantage)}`}
      </div>
    </div>
  )
}
