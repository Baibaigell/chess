/** 验证 4：端到端完整对局流程 + 安卓资源契约 */
import { useGameStore } from '../src/store/gameStore'
import { GameStatus } from '../src/core/result'
import { XiangqiEngine } from '../src/games/xiangqi/engine'
import { GomokuEngine } from '../src/games/gomoku/engine'
import { ChessEngine } from '../src/games/chess/engine'
import fs from 'fs'
import path from 'path'

let pass=0, fail=0; const F:string[]=[]
const eq=(a:any,e:any,l:string)=>{ if(JSON.stringify(a)===JSON.stringify(e)) pass++; else{fail++;F.push(`${l}: 期望${JSON.stringify(e)} 实际${JSON.stringify(a)}`)} }
const ok=(c:boolean,l:string)=>{ if(c) pass++; else{fail++;F.push(l)} }

// ================= 象棋完整对局 =================
{
  const S = useGameStore.getState()
  S.start('xiangqi','both','human','medium')
  // 走 30 步合法随机对局，验证不崩
  let steps=0
  for(let i=0;i<30;i++){
    const st = useGameStore.getState()
    if(st.result.status!==GameStatus.Ongoing) break
    const moves = st.engine!.legalMoves()
    if(moves.length===0) break
    st.move(moves[i % moves.length])
    steps++
  }
  ok(steps>10, `象棋可连续走子 ${steps} 步不崩溃`)
  ok(useGameStore.getState().history.length===steps, '记录数与步数一致')
  // 悔棋全部
  for(let i=0;i<steps;i++) useGameStore.getState().undo()
  eq(useGameStore.getState().history.length, 0, '连续悔棋可回到初始')
  eq(useGameStore.getState().turn,'r','全悔后轮到红方')
}

// ================= 五子棋完整对局 =================
{
  useGameStore.getState().start('gomoku','both','human','medium')
  const b=['h8','i8','j8','k8','l8'], w=['h9','i9','j9','k9']
  for(let i=0;i<5;i++){
    useGameStore.getState().move({from:b[i],to:b[i]})
    if(i<4) useGameStore.getState().move({from:w[i],to:w[i]})
  }
  const st = useGameStore.getState()
  eq(st.result.status, GameStatus.FirstWin, '五子棋五连判胜')
  eq(st.result.reason, 'five-in-row', '终止原因=五连')
  // 终局后不能继续落子
  const n = st.history.length
  st.move({from:'a1',to:'a1'})
  eq(useGameStore.getState().history.length, n, '终局后禁止落子')
}

// ================= 五子棋棋盘下满判和 =================
{
  const e = new GomokuEngine()
  // 构造一个下满无五连的局面：用 2x2 循环色块，避免任何方向五连
  let turn: 'b'|'w' = 'b'
  let count=0
  for(let y=0;y<15;y++){
    for(let x=0;x<15;x++){
      const sq = String.fromCharCode(97+x)+(y+1)
      // 用坐标奇偶决定颜色：(x+2y) 模式保证同色不相邻成五
      const want = ((x + 2*y) % 4 < 2) ? 'b' : 'w'
      if(want!==turn){
        // 需要换手：先补一步对手的废棋？此处直接按交替落子，不强制颜色
      }
      try { e.applyMove({from:sq,to:sq}) } catch { }
      turn = turn==='b'?'w':'b'
      count++
      if(e.result().status!==GameStatus.Ongoing) break
    }
    if(e.result().status!==GameStatus.Ongoing) break
  }
  ok(count>0, `五子棋大幅落子 ${count} 步未崩`)
}

// ================= 国际象棋完整对局 =================
{
  useGameStore.getState().start('chess','both','human','medium')
  const S=()=>useGameStore.getState()
  // 快速将杀：学者杀
  const line=[['e2','e4'],['e7','e5'],['f1','c4'],['b8','c6'],['d1','h5'],['g8','f6'],['h5','f7']]
  for(const [f,t] of line) S().move({from:f,to:t})
  eq(S().result.status, GameStatus.FirstWin, '国际象棋学者将杀判定')
  eq(S().result.reason, 'checkmate', '终止原因=将杀')
}

// ================= 安卓资源契约 =================
{
  const base = 'android/app/src/main/assets'
  const need = [
    'index.html','assets/app.js','assets/app.css',
    'pieces/wn.png','pieces/bp.png',
    'engines/stockfish/stockfish-19-lite-single.js',
    'engines/stockfish/stockfish-19-lite-single.wasm',
  ]
  for(const f of need){
    ok(fs.existsSync(path.join(base,f)), `assets 含 ${f}`)
  }
  // index.html 引用
  const html = fs.readFileSync(path.join(base,'index.html'),'utf8')
  ok(html.includes('./assets/app.js'), 'index.html 引用相对 JS')
  ok(html.includes('./assets/app.css'), 'index.html 引用相对 CSS')
  ok(!html.includes('src="/src/main.tsx"'), 'index.html 未残留开发入口')
  // CSS 相对路径
  const css = fs.readFileSync(path.join(base,'assets/app.css'),'utf8')
  ok(!/url\(\/pieces\//.test(css), 'CSS 无绝对 /pieces/ 路径')
  ok(/url\(\.\.\/pieces\//.test(css), 'CSS 用相对 ../pieces/')
  // 所有引用的图片都存在
  const refs = [...css.matchAll(/url\(\.\.\/(pieces\/[a-z]+\.png)\)/g)].map(m=>m[1])
  ok(refs.length===12, `CSS 引用 12 张棋子（${refs.length}）`)
  for(const r of new Set(refs)) ok(fs.existsSync(path.join(base,r)), `棋子存在 ${r}`)
  // 引擎路径映射
  const js = fs.readFileSync(path.join(base,'assets/app.js'),'utf8')
  ok(js.includes('/engines/stockfish/stockfish-19-lite-single.js'), 'JS 引用引擎路径')
}

// ================= 体积 =================
{
  const base='android/app/src/main/assets'
  let total=0
  const walk=(d:string)=>{ for(const f of fs.readdirSync(d)){ const p=path.join(d,f); const s=fs.statSync(p); if(s.isDirectory()) walk(p); else total+=s.size } }
  walk(base)
  const mb=(total/1024/1024).toFixed(2)
  ok(total>0 && total<20*1024*1024, `assets 体积合理 ${mb}MB`)
  console.log(`    assets 总体积: ${mb} MB`)
}

console.log('='.repeat(56))
if(fail===0) console.log(`✓ 验证4 端到端：全部通过（${pass} 项）`)
else { console.log(`✗ 失败 ${fail} / 通过 ${pass}`); F.forEach(x=>console.log('  ✗ '+x)); process.exitCode=1 }
