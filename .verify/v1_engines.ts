/** 验证 1：三个棋种引擎的实际行为 */
import { ChessEngine } from '../src/games/chess/engine'
import { XiangqiEngine } from '../src/games/xiangqi/engine'
import { GomokuEngine } from '../src/games/gomoku/engine'
import { getAll } from '../src/core/registry'
import { GameStatus } from '../src/core/result'

let pass=0, fail=0; const F:string[]=[]
const eq=(a:any,e:any,l:string)=>{ if(JSON.stringify(a)===JSON.stringify(e)) pass++; else{fail++;F.push(`${l}\n    期望 ${JSON.stringify(e)}\n    实际 ${JSON.stringify(a)}`)} }
const ok=(c:boolean,l:string)=>{ if(c) pass++; else{fail++;F.push(l)} }

// --- 注册表 ---
{
  const all = getAll()
  eq(all.map(g=>g.meta.id), ['chess','xiangqi','gomoku'], '注册表含三棋种')
  eq(all.map(g=>g.meta.width+'x'+g.meta.height), ['8x8','9x10','15x15'], '三棋种棋盘尺寸')
  ok(all[0].meta.supportsAi===true, '国际象棋标记支持AI')
  ok(!all[1].meta.supportsAi, '象棋未标记AI')
  ok(!all[2].meta.supportsAi, '五子棋未标记AI')
}
// --- 每个棋种都能创建、能走子 ---
{
  const c = getAll()[0].create()
  eq(c.legalMoves().length, 20, '国际象棋开局20着')
  c.applyMove({from:'e2',to:'e4'})
  eq(c.turn(),'b','国际象棋走子后轮次')
}
{
  const x = getAll()[1].create()
  eq(x.legalMoves().length, 44, '象棋开局44着')
  x.applyMove({from:'b8',to:'e8'})
  eq(x.turn(),'b','象棋走子后轮到黑')
}
{
  const g = getAll()[2].create()
  eq(g.legalMoves().length, 225, '五子棋开局225空点')
  g.applyMove({from:'h8',to:'h8'})
  eq(g.turn(),'w','五子棋走子后轮到白')
}
// --- 五子棋五连判定 ---
{
  const g = new GomokuEngine()
  const b=['h8','i8','j8','k8','l8'], w=['a1','a2','a3','a4']
  for(let i=0;i<5;i++){ g.applyMove({from:b[i],to:b[i]}); if(i<4) g.applyMove({from:w[i],to:w[i]}) }
  eq(g.result().status, GameStatus.FirstWin, '五子横五连判黑胜')
}
// --- cellsView 契约（GridBoard 依赖） ---
{
  const x:any = new XiangqiEngine()
  const cells = x.cellsView()
  eq(cells.length, 10, '象棋 cellsView 10 行')
  eq(cells[0].length, 9, '象棋 cellsView 9 列')
  eq(cells[9][4].text, '帥', '象棋红帅在底部中宫')
  eq(cells[0][4].text, '將', '象棋黑将在顶部中宫')

  const g:any = new GomokuEngine()
  const gc = g.cellsView()
  eq(gc.length, 15, '五子棋 cellsView 15 行')
  eq(gc[0].length, 15, '五子棋 cellsView 15 列')
  ok(gc.every((r:any[])=>r.every((c:any)=>c===null)), '五子棋初始全空')
}
// --- 棋子文字正确性 ---
{
  const x:any = new XiangqiEngine()
  const cells = x.cellsView()
  const red = cells[9].map((c:any)=>c?.text).join('')
  const black = cells[0].map((c:any)=>c?.text).join('')
  eq(red, '俥傌相仕帥仕相傌俥', '红方底线棋子文字')
  eq(black, '車馬象士將士象馬車', '黑方底线棋子文字')
}

console.log('='.repeat(56))
if(fail===0) console.log(`✓ 验证1 引擎层：全部通过（${pass} 项）`)
else { console.log(`✗ 验证1 失败 ${fail} / 通过 ${pass}`); F.forEach(x=>console.log('  ✗ '+x)); process.exitCode=1 }
