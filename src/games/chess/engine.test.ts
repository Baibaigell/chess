import { describe, it, expect } from 'vitest'
import { ChessEngine } from './engine'
import { chessMeta } from './meta'
import { GameStatus, TerminationReason, isOver } from '../../core/result'

describe('国际象棋引擎：初始局面', () => {
  it('初始局面有 20 个合法着法，白方先行', () => {
    const e = new ChessEngine()
    expect(e.turn()).toBe('w')
    expect(e.legalMoves()).toHaveLength(20)
  })

  it('初始局面与元信息声明的初始局面一致', () => {
    const e = new ChessEngine()
    expect(e.position()).toBe(chessMeta.initialPosition)
  })

  it('初始局面未结束', () => {
    const e = new ChessEngine()
    expect(isOver(e.result())).toBe(false)
  })
})

describe('国际象棋引擎：perft 节点数', () => {
  // perft 是国际象棋走法生成的黄金标准，公开参考值：
  // perft(1)=20, perft(2)=400, perft(3)=8902, perft(4)=197281
  const cases: Array<[number, number]> = [
    [1, 20],
    [2, 400],
    [3, 8902],
  ]

  for (const [depth, expected] of cases) {
    it(`perft(${depth}) = ${expected}`, () => {
      const e = new ChessEngine()
      expect(e.raw.perft(depth)).toBe(expected)
    })
  }
})

describe('国际象棋引擎：落子与撤销', () => {
  it('落子后轮次切换、着法记录追加', () => {
    const e = new ChessEngine()
    const rec = e.applyMove({ from: 'e2', to: 'e4' })
    expect(rec.san).toBe('e4')
    expect(e.turn()).toBe('b')
    expect(e.history()).toHaveLength(1)
  })

  it('撤销后回到落子前局面', () => {
    const e = new ChessEngine()
    const before = e.position()
    const rec = e.applyMove({ from: 'e2', to: 'e4' })
    const undone = e.undoMove()
    expect(undone?.san).toBe(rec.san)
    expect(e.position()).toBe(before)
    expect(e.turn()).toBe('w')
    expect(e.history()).toHaveLength(0)
  })

  it('没有可撤销的着法时返回 null', () => {
    const e = new ChessEngine()
    expect(e.undoMove()).toBeNull()
  })

  it('非法着法必须抛错，不得静默失败', () => {
    const e = new ChessEngine()
    expect(() => e.applyMove({ from: 'e2', to: 'e5' })).toThrow()
    // 抛错后局面不应改变
    expect(e.turn()).toBe('w')
    expect(e.history()).toHaveLength(0)
  })
})

describe('国际象棋引擎：序列化', () => {
  it('encode/decode 往返后局面一致', () => {
    const e = new ChessEngine()
    e.applyMove({ from: 'e2', to: 'e4' })
    e.applyMove({ from: 'e7', to: 'e5' })
    const saved = e.encode()

    const restored = new ChessEngine()
    restored.decode(saved)
    expect(restored.position()).toBe(saved)
    expect(restored.turn()).toBe('w')
  })

  it('从初始局面构造与 decode 结果一致', () => {
    const a = new ChessEngine(chessMeta.initialPosition)
    const b = new ChessEngine()
    b.decode(chessMeta.initialPosition)
    expect(a.position()).toBe(b.position())
  })
})

describe('国际象棋引擎：升变', () => {
  it('兵走到对方底线需要给出升变棋子', () => {
    const e = new ChessEngine('8/P7/8/8/8/8/8/K6k w - - 0 1')
    const rec = e.applyMove({ from: 'a7', to: 'a8', promotion: 'q' })
    expect(rec.san).toContain('=Q')
    expect(rec.position.startsWith('Q7/')).toBe(true)
  })
})

describe('国际象棋引擎：终止原因判定', () => {
  it('学者将杀（Scholar\'s mate）判定为白胜将杀', () => {
    const e = new ChessEngine()
    e.applyMove({ from: 'e2', to: 'e4' })
    e.applyMove({ from: 'e7', to: 'e5' })
    e.applyMove({ from: 'f1', to: 'c4' })
    e.applyMove({ from: 'b8', to: 'c6' })
    e.applyMove({ from: 'd1', to: 'h5' })
    e.applyMove({ from: 'g8', to: 'f6' })
    e.applyMove({ from: 'h5', to: 'f7' })

    const r = e.result()
    expect(r.status).toBe(GameStatus.FirstWin)
    expect(r.reason).toBe(TerminationReason.Checkmate)
  })

  it('经典逼和局面判定为和棋逼和', () => {
    // 白王 a1，黑后 c2、黑王 c3，轮到白方：白王无子可动且未被将军
    const e = new ChessEngine('8/8/8/8/8/2k5/2q5/K7 w - - 0 1')
    const r = e.result()
    expect(r.status).toBe(GameStatus.Draw)
    expect(r.reason).toBe(TerminationReason.Stalemate)
  })
})
