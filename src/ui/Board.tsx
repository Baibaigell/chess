/**
 * 棋盘容器：按棋种的 meta.renderer 分发到两套渲染。
 *
 * - 国际象棋（8×8）用 chessground：支持拖拽、动画、升变
 * - 象棋（9×10）与五子棋（15×15）用自绘网格 GridBoard：
 *   chessground 把尺寸写死为 8×8，无法承载这两种棋盘
 *
 * 两套渲染共用同一个「合法着法 → 可点击格子」的推导逻辑：
 * 规则永远来自引擎，渲染层只负责画和响应点击。
 */
import { useCallback, useMemo, useState } from 'react'
import Chessground from '@react-chess/chessground'
import type { Config } from 'chessground/config'
import type { Key } from 'chessground/types'
import { useGameStore } from '../store/gameStore'
import { useOnlineStore } from '../store/onlineStore'
import { getOnlineClient } from '../net/client'
import { get } from '../core/registry'
import GridBoard from './GridBoard'
import type { Move } from '../core/types'

export default function Board() {
  const engine = useGameStore((s) => s.engine)
  const position = useGameStore((s) => s.position)
  const turn = useGameStore((s) => s.turn)
  const history = useGameStore((s) => s.history)
  const playerSide = useGameStore((s) => s.playerSide)
  const rawMove = useGameStore((s) => s.move)
  const result = useGameStore((s) => s.result)
  const opponent = useGameStore((s) => s.opponent)
  const thinking = useGameStore((s) => s.thinking)
  const gameId = useGameStore((s) => s.gameId)
  const onlinePhase = useOnlineStore((s) => s.phase)
  const finished = result.status !== 'ongoing'

  const meta = gameId ? get(gameId).meta : null
  const firstTurn = meta?.firstTurn ?? 'w'

  /** 当前是否处于联机对局中 */
  const online = onlinePhase === 'playing' || onlinePhase === 'finished'

  /**
   * 走子入口：本地应用 + 联机时同步给对手。
   *
   * 所有走子路径（网格棋盘点击、chessground 拖拽、AI 落子）都经过这里，
   * 因此「是否要发给服务端」只判断一次，各调用点不需要关心联机与否。
   *
   * AI 的落子也会经过这里：联机模式下不会开 AI（对手是人），
   * 所以这条路径只在本地对局触发。
   */
  const move = useCallback(
    (m: Move) => {
      rawMove(m)
      if (online) {
        getOnlineClient().sendMove(m.from, m.to, m.promotion)
      }
    },
    [rawMove, online],
  )

  // 当前玩家可否操作：双人模式两边都能动；与电脑对下时只有玩家一方能动
  const canPlay =
    !finished &&
    !thinking &&
    (playerSide === 'both' ||
      (playerSide === 'first' && turn === firstTurn) ||
      (playerSide === 'second' && turn !== firstTurn))

  /** 当前全部合法着法，两套渲染共用 */
  const legalMoves = useMemo<Move[]>(() => {
    if (!engine || finished) return []
    return engine.legalMoves()
  }, [engine, position, finished])

  // ---------- 网格棋盘（象棋 / 五子棋）的选中与落子状态 ----------
  const [selected, setSelected] = useState<string | null>(null)

  const gridDests = useMemo(() => {
    const s = new Set<string>()
    if (!canPlay) return s
    for (const m of legalMoves) {
      // 只有从选中格出发的着法才显示为可落点；
      // 五子棋没有「起点」，其合法着法 from === to，因此直接全量显示
      if (selected === null || m.from === selected || m.from === m.to) s.add(m.to)
    }
    return s
  }, [legalMoves, selected, canPlay])

  const lastMove = history.length
    ? ([history[history.length - 1].move.from, history[history.length - 1].move.to] as [string, string])
    : null

  function handleGridClick(square: string) {
    if (!canPlay || !engine) return

    // 已选中且点到合法目标 → 落子
    if (selected !== null) {
      const target = legalMoves.find((m) => m.from === selected && m.to === square)
      if (target) {
        move({ from: target.from, to: target.to })
        setSelected(null)
        return
      }
    }

    // 五子棋：点到空点直接落子（没有「选中棋子」的概念）
    const placing = legalMoves.find((m) => m.from === m.to && m.to === square)
    if (placing) {
      move({ from: placing.from, to: placing.to })
      setSelected(null)
      return
    }

    // 点到自己的棋子 → 选中；否则取消选中
    const ownsSquare = legalMoves.some((m) => m.from === square && m.from !== m.to)
    setSelected(ownsSquare ? square : null)
  }

  // ---------- 国际象棋（chessground）配置 ----------
  const cgConfig = useMemo<Config>(() => {
    const dests = new Map<Key, Key[]>()
    if (canPlay) {
      for (const m of legalMoves) {
        const list = dests.get(m.from as Key) ?? []
        list.push(m.to as Key)
        dests.set(m.from as Key, list)
      }
    }

    const last = history[history.length - 1]
    const inCheck = engine && !finished ? engine.isCheck() : false

    // chessground 用 'white' / 'black' / 'both'，不是 'w' / 'b'
    const canMoveColor =
      canPlay && playerSide === 'both'
        ? 'both'
        : canPlay
          ? turn === 'w'
            ? 'white'
            : 'black'
          : undefined

    return {
      fen: position,
      orientation: playerSide === 'second' ? 'black' : 'white',
      turnColor: turn === 'w' ? 'white' : 'black',
      check: inCheck ? (turn === 'w' ? 'white' : 'black') : false,
      coordinates: true,
      animation: { enabled: true, duration: 200 },
      highlight: { lastMove: true, check: true },
      movable: {
        free: false,
        color: canMoveColor as 'white' | 'black' | 'both' | undefined,
        dests: canMoveColor ? dests : new Map(),
        showDests: true,
        events: {
          after: (orig, dest) => {
            // 升变场景：同一个 from/to 可能对应 4 种升变，chess.js 必须显式指定
            // 否则会抛 Invalid move。这里从合法着法里找出匹配项，默认选后。
            const candidates = legalMoves.filter(
              (m) => m.from === orig && m.to === dest,
            )
            if (candidates.length === 0) return
            const chosen =
              candidates.find((m) => m.promotion === 'q') ?? candidates[0]
            move({
              from: chosen.from,
              to: chosen.to,
              ...(chosen.promotion ? { promotion: chosen.promotion } : {}),
            })
          },
        },
      },
      lastMove: last ? [last.move.from as Key, last.move.to as Key] : undefined,
      viewOnly: finished || !canPlay,
    }
  }, [position, turn, history, playerSide, move, finished, thinking, opponent, canPlay, legalMoves, engine, canPlay])

  if (!meta) return <div className="board-wrap" />

  // ---------- 分发 ----------
  if (meta.renderer === 'grid') {
    // 把引擎局面转成二维「显示单元」。
    // 各引擎的 position() 编码不同，这里统一走 engine 暴露的 cells 视图。
    const cells = buildCells(engine, meta.width, meta.height)

    return (
      <GridBoard
        cols={meta.width}
        rows={meta.height}
        cells={cells}
        dests={gridDests}
        selected={selected}
        lastMove={lastMove}
        onSquareClick={handleGridClick}
        pieceStyle={meta.pieceStyle === 'hanzi' ? 'hanzi' : 'dot'}
        coordinates={meta.id !== 'gomoku'}
        theme={meta.id === 'gomoku' ? 'gomoku' : 'xiangqi'}
      />
    )
  }

  return (
    <div className="board-wrap">
      <Chessground contained config={cgConfig} />
    </div>
  )
}

/**
 * 从引擎取得二维显示单元。
 *
 * 引擎不对外暴露 board 数组，因此这里用「逐格试探」的方式重建：
 * 对每个坐标查 encode() 结果。这会很慢，所以改为各引擎提供可选方法。
 */
function buildCells(
  engine: ReturnType<typeof useGameStore.getState>['engine'],
  cols: number,
  rows: number,
): Array<Array<{ text: string; side: string } | null>> {
  const out: Array<Array<{ text: string; side: string } | null>> = []
  for (let y = 0; y < rows; y++) {
    const row: Array<{ text: string; side: string } | null> = []
    for (let x = 0; x < cols; x++) row.push(null)
    out.push(row)
  }
  if (!engine) return out

  // 引擎实现了 cellsView 时直接取
  const maybe = engine as unknown as {
    cellsView?: () => Array<Array<{ text: string; side: string } | null>>
  }
  if (typeof maybe.cellsView === 'function') {
    return maybe.cellsView()
  }
  return out
}
