/**
 * 自绘网格棋盘：给象棋（9×10）与五子棋（15×15）用。
 *
 * 为什么不用 chessground：它把棋盘尺寸写死为 8×8，
 * key2pos 只认 a-h / 1-8，棋子 Role 也只有 7 种国际象棋角色，
 * 无法表示象棋的将、士、象、炮或五子棋的单子。
 *
 * 本组件只负责「画」和「点」，规则判断全部来自引擎传入的合法着法。
 */
import { useMemo } from 'react'
import type { Move } from '../core/types'

export interface GridBoardProps {
  /** 列数 */
  cols: number
  /** 行数 */
  rows: number
  /** 每格内容：null 空；否则为 { text, side }，side 用于配色 */
  cells: Array<Array<{ text: string; side: string } | null>>
  /** 当前可落子的格子集合（"a1" 形式） */
  dests: Set<string>
  /** 已选中格 */
  selected: string | null
  /** 最后一步的起止格，用于高亮 */
  lastMove: [string, string] | null
  /** 点击某格 */
  onSquareClick: (square: string) => void
  /** 棋子绘制方式：汉字文字 / 纯色圆点 */
  pieceStyle: 'hanzi' | 'dot'
  /** 是否显示坐标 */
  coordinates?: boolean
  /** 棋盘底色主题 */
  theme: 'xiangqi' | 'gomoku'
}

/** (x,y) → "a1" */
function toSquare(x: number, y: number): string {
  return `${String.fromCharCode(97 + x)}${y + 1}`
}

export default function GridBoard({
  cols,
  rows,
  cells,
  dests,
  selected,
  lastMove,
  onSquareClick,
  pieceStyle,
  coordinates = true,
  theme,
}: GridBoardProps) {
  // 格子列表只在尺寸变化时重建
  const squares = useMemo(() => {
    const out: Array<{ key: string; x: number; y: number }> = []
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        out.push({ key: toSquare(x, y), x, y })
      }
    }
    return out
  }, [cols, rows])

  return (
    <div className={`grid-board grid-board--${theme}`}>
      <div
        className="grid-board-inner"
        style={{
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridTemplateRows: `repeat(${rows}, 1fr)`,
          // 象棋棋盘是竖长方形，五子棋是正方形
          aspectRatio: `${cols} / ${rows}`,
        }}
      >
        {squares.map(({ key, x, y }) => {
          const cell = cells[y]?.[x] ?? null
          const isSelected = selected === key
          const isDest = dests.has(key)
          const isLast =
            lastMove !== null && (lastMove[0] === key || lastMove[1] === key)

          return (
            <button
              key={key}
              type="button"
              className={[
                'grid-square',
                isSelected ? 'is-selected' : '',
                isDest ? 'is-dest' : '',
                isLast ? 'is-last' : '',
                // 五子棋棋盘线与坐标
                theme === 'gomoku' ? 'has-line' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onSquareClick(key)}
              aria-label={key}
            >
              {cell && (
                <span
                  className={[
                    'grid-piece',
                    pieceStyle === 'hanzi' ? 'grid-piece--hanzi' : 'grid-piece--dot',
                    `grid-piece--${cell.side}`,
                  ].join(' ')}
                >
                  {pieceStyle === 'hanzi' ? cell.text : ''}
                </span>
              )}
              {isDest && !cell && <span className="grid-dest-dot" />}
              {coordinates && x === 0 && (
                <span className="grid-coord grid-coord--rank">{y + 1}</span>
              )}
              {coordinates && y === rows - 1 && (
                <span className="grid-coord grid-coord--file">
                  {String.fromCharCode(97 + x)}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** 供外部把引擎的 Move[] 转成 dests 集合 */
export function movesToDestSet(moves: Move[]): Set<string> {
  const s = new Set<string>()
  for (const m of moves) s.add(m.to)
  return s
}
