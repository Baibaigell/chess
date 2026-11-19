import { useEffect, useState } from 'react'
import Lobby from './ui/Lobby'
import GameScreen from './ui/GameScreen'
import OnlineLobby from './ui/OnlineLobby'
import { useGameStore } from './store/gameStore'
import { useOnlineStore } from './store/onlineStore'
import { OnlineClient } from './net/client'

/**
 * 顶层页面切换。
 *
 * 三种页面：
 * - 大厅：选棋种、选对手、进联机
 * - 联机大厅：建房 / 进房 / 等待对手
 * - 对局页：本地对局与联机对局共用同一个组件
 *
 * 不引入路由库：页面状态由 store 驱动，浏览器前进后退不参与
 * （棋类应用的页面层级只有两层，用 URL 路由反而增加复杂度）。
 */
export default function App() {
  const gameId = useGameStore((s) => s.gameId)
  const onlinePhase = useOnlineStore((s) => s.phase)

  /** 是否停留在联机页面（建房/等待阶段） */
  const [showOnline, setShowOnline] = useState(false)

  /**
   * 进联机页时初始化连接。
   *
   * enterLobby() 是唯一注册事件回调并发起 WebSocket 连接的地方。
   * 少了它，conn 永远是 'idle'，建房/进房按钮一直 disabled。
   */
  useEffect(() => {
    if (!showOnline) return
    useOnlineStore.getState().enterLobby()
  }, [showOnline])

  /**
   * 刷新页面后自动回到原房间。
   *
   * 凭据存在 sessionStorage（OnlineClient 负责读写），
   * 有凭据说明上次在房间里，直接进联机页让客户端自动重连。
   */
  useEffect(() => {
    if (OnlineClient.loadCredential()) setShowOnline(true)
  }, [])

  // 联机阶段推进到「对局中」时，交回 GameScreen 渲染
  const inOnlineGame = showOnline && (onlinePhase === 'playing' || onlinePhase === 'finished')

  /**
   * 退出联机页，回到主大厅。
   *
   * 必须显式 leave()：它会断开连接并清空房间状态。
   * 早期版本靠一个「phase === 'lobby' && !gameId 就自动收起」的 effect
   * 来做这件事，但 phase 的初始值本来就是 'lobby'，
   * 于是刚点进联机页就立刻被弹回主大厅（一闪而过）。
   * 「已离开房间」和「还没进过房间」在状态上无法区分，只能由动作显式触发。
   */
  function exitOnline(): void {
    useOnlineStore.getState().leave()
    setShowOnline(false)
  }

  /**
   * 页面优先级：联机页 > 对局页 > 大厅。
   *
   * 联机必须排在前面：建房成功后 store 里已经 start() 了一局棋
   * （gameId 有值），但此时对手还没进来，应该停在「等待对手」页
   * 让房主看到房间码，而不是直接跳进对局页自己下棋。
   */
  if (showOnline && !inOnlineGame) {
    return <OnlineLobby onBack={exitOnline} />
  }

  if (gameId) {
    return <GameScreen online={inOnlineGame} />
  }

  return <Lobby onOnline={() => setShowOnline(true)} />
}
