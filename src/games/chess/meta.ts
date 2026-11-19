/**
 * 国际象棋元信息。
 */
import type { GameMeta } from '../../core/meta'

export const chessMeta: GameMeta = {
  id: 'chess',
  name: '国际象棋',
  description: '8×8 棋盘，白方先行，目标将杀对方王',
  width: 8,
  height: 8,
  coordinates: {
    fileStart: 'a',
    fileCount: 8,
    rankStart: 1,
  },
  firstTurn: 'w',
  initialPosition: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  /** 国际象棋用 chessground 渲染，支持拖拽与动画 */
  renderer: 'chessground',
  interaction: 'drag',
  /** 棋子用 PNG 图片素材 */
  pieceStyle: 'image',
  sides: { first: '白方', second: '黑方' },
  /** 已接入 Stockfish，可与电脑对下 */
  supportsAi: true,
}
