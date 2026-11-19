/**
 * 对局结果与终止原因。
 *
 * 结果分三类：未结束、某一方胜、和棋。
 *
 * 阵营不再固定为「白/黑」：国际象棋是白/黑，象棋是红/黑，五子棋是黑/白。
 * 因此胜方用 FirstWin / SecondWin 表示「先行方胜」「后行方胜」，
 * 由界面按棋种的 sides 文案翻译成具体称呼。
 */

export const GameStatus = {
  /** 对局仍在进行 */
  Ongoing: 'ongoing',
  /** 先行方胜（国际象棋白、象棋红、五子棋黑） */
  FirstWin: 'first-win',
  /** 后行方胜（国际象棋黑、五子棋白；象棋后行方为黑） */
  SecondWin: 'second-win',
  /** 和棋 */
  Draw: 'draw',
} as const

export type GameStatus = (typeof GameStatus)[keyof typeof GameStatus]

/** 对局终止原因 */
export const TerminationReason = {
  Checkmate: 'checkmate',
  Stalemate: 'stalemate',
  InsufficientMaterial: 'insufficient-material',
  ThreefoldRepetition: 'threefold-repetition',
  FiftyMoveRule: 'fifty-move-rule',
  Resignation: 'resignation',
  Timeout: 'timeout',
  Agreement: 'agreement',
  /** 五子棋连成五子 */
  FiveInRow: 'five-in-row',
  /** 棋盘下满仍无胜负 */
  BoardFull: 'board-full',
} as const

export type TerminationReason =
  (typeof TerminationReason)[keyof typeof TerminationReason]

export interface GameResult {
  status: GameStatus
  /** 对局未结束时为 null */
  reason: TerminationReason | null
}

/** 进行中的对局结果常量，避免每次调用都新建对象 */
export const ONGOING: GameResult = {
  status: GameStatus.Ongoing,
  reason: null,
}

/** 终止原因的中文说明，供界面直接显示 */
export const TERMINATION_TEXT: Record<TerminationReason, string> = {
  [TerminationReason.Checkmate]: '将杀',
  [TerminationReason.Stalemate]: '困毙',
  [TerminationReason.InsufficientMaterial]: '子力不足',
  [TerminationReason.ThreefoldRepetition]: '三次重复局面',
  [TerminationReason.FiftyMoveRule]: '五十回合规则',
  [TerminationReason.Resignation]: '认输',
  [TerminationReason.Timeout]: '超时',
  [TerminationReason.Agreement]: '双方同意和棋',
  [TerminationReason.FiveInRow]: '五子连珠',
  [TerminationReason.BoardFull]: '棋盘已满',
}

export function isOver(result: GameResult): boolean {
  return result.status !== GameStatus.Ongoing
}

/** 判断某个结果是否由先行方获胜 */
export function isFirstWin(status: GameStatus): boolean {
  return status === GameStatus.FirstWin
}
