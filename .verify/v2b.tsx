/** 验证 2（替代方案）：不经过 zustand hook，直接验证渲染分支逻辑
 *
 * Board 的分发依赖 meta.renderer；GridBoard 的渲染依赖 props。
 * 这两层可以脱离 store 直接验证，覆盖真正有风险的新代码。
 */
import { renderToStaticMarkup } from 'react-dom/server'
import GridBoard from '../src/ui/GridBoard'
import { getAll, get } from '../src/core/registry'
import { XiangqiEngine } from '../src/games/xiangqi/engine'
import { GomokuEngine } from '../src/games/gomoku/engine'

let pass=0, fail=0; const F:string[]=[]
const ok=(c:boolean,l:string)=>{ if(c) pass++; else{fail++;F.push(l)} }
const has=(h:string,s:string,l:string)=>ok(h.includes(s), `${l}（未找到 "${s}"）`)
const nOf=(h:string,re:RegExp)=>(h.match(re)||[]).length

// ---- meta 分发契约 ----
{
  const chess = get('chess').meta, xq = get('xiangqi').meta, gk = get('gomoku').meta
  ok(chess.renderer==='chessground','国际象棋渲染器=chessground')
  ok(xq.renderer==='grid','象棋渲染器=grid')
  ok(gk.renderer==='grid','五子棋渲染器=grid')
  ok(chess.pieceStyle==='image','国际象棋棋子=图片')
  ok(xq.pieceStyle==='hanzi','象棋棋子=汉字')
  ok(gk.pieceStyle==='dot','五子棋棋子=圆点')
  ok(chess.supportsAi===true,'国际象棋支持AI')
  ok(!xq.supportsAi,'象棋不支持AI')
  ok(!gk.supportsAi,'五子棋不支持AI')
}

// ---- GridBoard 渲染象棋 ----
{
  const e:any = new XiangqiEngine()
  const cells = e.cellsView()
  const h = renderToStaticMarkup(
    <GridBoard cols={9} rows={10} cells={cells} dests={new Set()} selected={null}
      lastMove={null} onSquareClick={()=>{}} pieceStyle="hanzi"
      coordinates={true} theme="xiangqi" />
  )
  ok(nOf(h,/grid-square/g)===90, `象棋渲染90格（实际${nOf(h,/grid-square/g)}）`)
  ok(h.includes('grid-board--xiangqi'),'象棋主题类名')
  has(h,'帥','含红帅')
  has(h,'將','含黑将')
  has(h,'砲','含黑砲')
  has(h,'俥','含红俥')
  ok(nOf(h,/grid-piece--hanzi/g)===32, `象棋32枚棋子（实际${nOf(h,/grid-piece--hanzi/g)}）`)
}

// ---- GridBoard 渲染五子棋 ----
{
  const e:any = new GomokuEngine()
  const cells = e.cellsView()
  const h = renderToStaticMarkup(
    <GridBoard cols={15} rows={15} cells={cells} dests={new Set()} selected={null}
      lastMove={null} onSquareClick={()=>{}} pieceStyle="dot"
      coordinates={false} theme="gomoku" />
  )
  ok(nOf(h,/grid-square/g)===225, `五子棋渲染225格（实际${nOf(h,/grid-square/g)}）`)
  ok(h.includes('grid-board--gomoku'),'五子棋主题类名')
  ok(nOf(h,/grid-piece--dot/g)===0, '五子棋初始无棋子')
}

// ---- GridBoard 落子后显示棋子 ----
{
  const e:any = new GomokuEngine()
  e.applyMove({from:'h8',to:'h8'})
  e.applyMove({from:'i9',to:'i9'})
  const h = renderToStaticMarkup(
    <GridBoard cols={15} rows={15} cells={e.cellsView()} dests={new Set(['a1'])}
      selected={null} lastMove={['i9','i9']} onSquareClick={()=>{}}
      pieceStyle="dot" coordinates={false} theme="gomoku" />
  )
  ok(nOf(h,/grid-piece--dot/g)===2, `五子棋落2子（实际${nOf(h,/grid-piece--dot/g)}）`)
  ok(nOf(h,/grid-piece--b/g)>=1, '有黑子')
  ok(nOf(h,/grid-piece--w/g)>=1, '有白子')
  ok(nOf(h,/is-last/g)===1, '最后一步高亮1格')
  ok(nOf(h,/grid-dest-dot/g)===1, '可落点提示1个')
}

// ---- 选中状态 ----
{
  const e:any = new XiangqiEngine()
  const h = renderToStaticMarkup(
    <GridBoard cols={9} rows={10} cells={e.cellsView()} dests={new Set(['a8','a9'])}
      selected="a10" lastMove={null} onSquareClick={()=>{}}
      pieceStyle="hanzi" coordinates={true} theme="xiangqi" />
  )
  ok(h.includes('is-selected'),'选中格有高亮类')
  ok(nOf(h,/is-dest/g)===2, `可落点2个（实际${nOf(h,/is-dest/g)}）`)
}

console.log('='.repeat(56))
if(fail===0) console.log(`✓ 验证2b 棋盘渲染：全部通过（${pass} 项）`)
else { console.log(`✗ 失败 ${fail} / 通过 ${pass}`); F.forEach(x=>console.log('  ✗ '+x)); process.exitCode=1 }
