/**
 * 棋种元信息：棋盘尺寸、坐标、渲染方式等，
 * 供界面在没有实例时也能布局棋盘。
 */

/** 棋盘坐标：横轴字母起点、纵轴数字起点与增长方向 */
export interface BoardCoordinates {
  /** 横轴起始字母，如 "a" */
  fileStart: string
  /** 横轴字母总数 */
  fileCount: number
  /** 纵轴起始数字，如 "1" */
  rankStart: number
}

/** 棋盘渲染方式 */
export type BoardRenderer =
  /** chessground（仅 8×8 国际象棋） */
  | 'chessground'
  /** 自绘 CSS Grid，任意尺寸 */
  | 'grid'

/** 交互方式 */
export type BoardInteraction =
  /** 拖拽 + 点选（chessground） */
  | 'drag'
  /** 仅点选两次 */
  | 'click'

/** 棋子绘制方式 */
export type PieceStyle =
  /** 汉字文字，如象棋的帥仕相 */
  | 'hanzi'
  /** 纯色圆点，如五子棋 */
  | 'dot'
  /** 图片素材，如国际象棋的 PNG */
  | 'image'

/** 双方阵营的显示名称 */
export interface SideLabels {
  /** 先行方 */
  first: string
  /** 后行方 */
  second: string
}

export interface GameMeta {
  /** 唯一标识，用于注册表索引与存档 */
  id: string
  /** 显示名称 */
  name: string
  /** 一句话说明 */
  description: string
  /** 棋盘列数 */
  width: number
  /** 棋盘行数 */
  height: number
  coordinates: BoardCoordinates
  /** 先手阵营标识 */
  firstTurn: string
  /** 初始局面（序列化形式），也是“重开”时恢复到的局面 */
  initialPosition: string
  /** 棋盘渲染方式，决定用 chessground 还是自绘网格 */
  renderer: BoardRenderer
  /** 交互方式 */
  interaction: BoardInteraction
  /** 棋子绘制方式 */
  pieceStyle: PieceStyle
  /** 双方阵营称呼，用于计时、积分、着法列表等 UI */
  sides: SideLabels
  /** 是否支持与电脑对下（只有接入引擎的棋种才为真） */
  supportsAi?: boolean
}

/** 创建尚未实现的引擎时的统一错误 */
export class UnsupportedGameError extends Error {
  constructor(public readonly gameId: string) {
    super(`未注册的棋种: ${gameId}`)
    this.name = 'UnsupportedGameError'
  }
}
