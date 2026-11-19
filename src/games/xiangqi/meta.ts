/**
 * 中国象棋元信息。
 *
 * 9 列 × 10 行，红方先行。棋盘是「9 条竖线、10 条横线」，
 * 与五子棋一样使用自绘网格渲染，不用 chessground（后者写死 8×8）。
 * 棋子用汉字文字绘制，无需图片素材。
 */
import type { GameMeta } from '../../core/meta'

export const xiangqiMeta: GameMeta = {
  id: 'xiangqi',
  name: '中国象棋',
  description: '9×10 棋盘，红方先行，目标将死对方将帅',
  width: 9,
  height: 10,
  coordinates: {
    fileStart: 'a',
    fileCount: 9,
    rankStart: 1,
  },
  firstTurn: 'r',
  initialPosition: '',
  renderer: 'grid',
  interaction: 'click',
  pieceStyle: 'hanzi',
  sides: { first: '红方', second: '黑方' },
  /** 已接入内置 AI，可与电脑对下 */
  supportsAi: true,
}
