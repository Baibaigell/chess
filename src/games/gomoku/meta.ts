/**
 * 五子棋元信息。
 *
 * 15×15 标准棋盘，黑方先行。
 * 没有「棋子角色」概念，所有子都一样，因此棋子字样为空。
 */
import type { GameMeta } from '../../core/meta'

export const gomokuMeta: GameMeta = {
  id: 'gomoku',
  name: '五子棋',
  description: '15×15 棋盘，黑方先行，先连成五子者胜',
  width: 15,
  height: 15,
  coordinates: {
    fileStart: 'a',
    fileCount: 15,
    rankStart: 1,
  },
  firstTurn: 'b',
  initialPosition: '',
  /** 用自绘网格棋盘，不使用 chessground */
  renderer: 'grid',
  /** 点选落子，没有拖拽 */
  interaction: 'click',
  /** 棋子用纯色圆点绘制，不需要文字 */
  pieceStyle: 'dot',
  /** 双方阵营称呼 */
  sides: { first: '黑方', second: '白方' },
  /** 已接入内置 AI，可与电脑对下 */
  supportsAi: true,
}
