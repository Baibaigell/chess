import { useGameStore } from '../store/gameStore'
import { get } from '../core/registry'

/**
 * 着法列表。
 *
 * 国际象棋与象棋是「走子」，按先行方/后行方成对显示两列；
 * 五子棋是「落子」，每步只有落点，因此单列按步数显示。
 */
export default function MoveList() {
  const history = useGameStore((s) => s.history)
  const gameId = useGameStore((s) => s.gameId)

  const meta = gameId ? get(gameId).meta : null
  // 五子棋（落子类）用单列
  const singleColumn = meta?.interaction === 'click' && meta?.pieceStyle === 'dot'

  const pairs: Array<{ no: number; first?: string; second?: string }> = []
  history.forEach((rec, i) => {
    const no = Math.floor(i / 2) + 1
    if (i % 2 === 0) {
      pairs.push({ no, first: rec.san })
    } else {
      pairs[pairs.length - 1].second = rec.san
    }
  })

  return (
    <div className="movelist">
      <h2 className="panel-title">着法</h2>
      {history.length === 0 ? (
        <p className="movelist-empty">尚未走子</p>
      ) : singleColumn ? (
        <ol className="movelist-rows movelist-rows--single">
          {history.map((rec, i) => (
            <li key={i} className="movelist-row movelist-row--single">
              <span className="movelist-no">{i + 1}.</span>
              <span className="movelist-first">{rec.san}</span>
            </li>
          ))}
        </ol>
      ) : (
        <ol className="movelist-rows">
          {pairs.map((p) => (
            <li key={p.no} className="movelist-row">
              <span className="movelist-no">{p.no}.</span>
              <span className="movelist-first">{p.first ?? ''}</span>
              <span className="movelist-second">{p.second ?? ''}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
