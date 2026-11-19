/**
 * Stockfish Worker 封装。
 *
 * 协议要点（UCI）：
 * - 先发 uci，等 uciok，再 isready 等 readyok，才算握手完成
 * - 每次走子前 setoption 调难度，再 position，再 go movetime
 * - 引擎回 bestmove，形如 "bestmove g1f3 ponder d7d5"
 *
 * 使用单线程版引擎（lite-single），不依赖 SharedArrayBuffer，
 * 因此不需要 COOP/COEP 头，静态托管即可运行。
 *
 * 并发要点：同一时刻只允许一个搜索在跑。若上一次搜索尚未返回就发起新的，
 * 必须先 stop 并等待其 bestmove，否则两个搜索的输出会互相污染。
 */
import type { Move } from '../core/types'
import type { AiEngine, ThinkOptions } from './types'
import { DIFFICULTY_PROFILES } from './types'

/** 引擎文件在 public 下的路径 */
const ENGINE_URL = '/engines/stockfish/stockfish-19-lite-single.js'

/** UCI 着法转内部 Move："e2e4" → { from:'e2', to:'e4' }，"e7e8q" 带升变 */
export function parseUciMove(uci: string): Move | null {
  const m = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(uci)
  if (!m) return null
  const move: Move = { from: m[1], to: m[2] }
  if (m[3]) move.promotion = m[3]
  return move
}

/** 内部 Move 转 UCI："e2e4"，升变拼上 q/r/b/n */
export function toUciMove(move: Move): string {
  return `${move.from}${move.to}${move.promotion ?? ''}`
}

type LineHandler = (line: string) => void

/**
 * 引擎单例管理器：一个 Worker 反复使用，避免每次走子重建。
 * 内部串行化所有搜索请求，保证同一时刻只有一个 go 在跑。
 */
export class StockfishEngine implements AiEngine {
  private worker: Worker | null = null
  private ready: Promise<void> | null = null
  private listeners = new Set<LineHandler>()
  /** 搜索队列：保证串行 */
  private queue: Promise<unknown> = Promise.resolve()
  /** 当前是否有搜索在进行 */
  private searching = false

  /** 确保 Worker 已创建并完成 uci 握手 */
  private async ensureReady(): Promise<Worker> {
    if (this.worker && this.ready) {
      await this.ready
      return this.worker
    }

    const worker = new Worker(ENGINE_URL)
    this.worker = worker

    worker.onmessage = (ev: MessageEvent) => {
      const line = typeof ev.data === 'string' ? ev.data : String(ev.data)
      // 复制一份再遍历，避免回调里修改集合导致迭代异常
      for (const fn of [...this.listeners]) fn(line)
    }

    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('引擎握手超时'))
      }, 30000)

      const onLine: LineHandler = (line) => {
        if (line.startsWith('uciok')) {
          worker.postMessage('isready')
        } else if (line.startsWith('readyok')) {
          clearTimeout(timer)
          this.listeners.delete(onLine)
          resolve()
        }
      }
      this.listeners.add(onLine)
      worker.postMessage('uci')
    })

    await this.ready
    return worker
  }

  /** 等待当前搜索结束（收到 bestmove） */
  private waitForIdle(worker: Worker, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        clearTimeout(timer)
        this.listeners.delete(onLine)
        this.searching = false
        resolve()
      }
      const timer = setTimeout(finish, timeoutMs)
      const onLine: LineHandler = (line) => {
        if (line.startsWith('bestmove')) finish()
      }
      this.listeners.add(onLine)
      worker.postMessage('stop')
    })
  }

  /** 实际执行一次搜索（调用方需保证已串行化） */
  private async runSearch(options: ThinkOptions): Promise<Move | null> {
    const { difficulty, position, signal } = options
    const profile = DIFFICULTY_PROFILES[difficulty]

    const worker = await this.ensureReady()
    if (signal?.aborted) return null

    // 若上一次搜索还在跑，先等它彻底结束，避免输出串台
    if (this.searching) {
      await this.waitForIdle(worker, 8000)
    }
    if (signal?.aborted) return null

    this.searching = true

    return new Promise<Move | null>((resolve) => {
      let settled = false

      const finish = (result: Move | null) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.listeners.delete(onLine)
        signal?.removeEventListener('abort', onAbort)
        this.searching = false
        resolve(result)
      }

      const timer = setTimeout(() => {
        worker.postMessage('stop')
        finish(null)
      }, profile.movetimeMs + 6000)

      const onAbort = () => {
        worker.postMessage('stop')
        finish(null)
      }
      signal?.addEventListener('abort', onAbort)

      const onLine: LineHandler = (line) => {
        if (!line.startsWith('bestmove')) return
        const parts = line.split(/\s+/)
        const best = parts[1]
        if (!best || best === '(none)') {
          finish(null)
          return
        }
        finish(parseUciMove(best))
      }
      this.listeners.add(onLine)

      worker.postMessage(`setoption name Skill Level value ${profile.skillLevel}`)
      worker.postMessage(`position fen ${position}`)
      worker.postMessage(`go movetime ${profile.movetimeMs}`)
    })
  }

  think(options: ThinkOptions): Promise<Move | null> {
    // 串行化：排队执行，避免并发污染
    const run = this.queue.then(
      () => this.runSearch(options),
      () => this.runSearch(options),
    )
    // 队列本身不应因单次失败而中断
    this.queue = run.catch(() => undefined)
    return run
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    this.ready = null
    this.listeners.clear()
    this.searching = false
    this.queue = Promise.resolve()
  }
}

/** 进程内共享一个引擎实例 */
let shared: StockfishEngine | null = null

export function getStockfish(): StockfishEngine {
  if (!shared) shared = new StockfishEngine()
  return shared
}
