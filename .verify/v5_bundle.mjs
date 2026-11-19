/** 验证 5：打包产物静态分析（正确处理 esbuild 的 unicode 转义） */
import fs from 'fs'
import path from 'path'

let pass=0, fail=0; const F=[]
const ok=(c,l)=>{ if(c) pass++; else{fail++;F.push(l)} }

const base='android/app/src/main/assets'
const js = fs.readFileSync(path.join(base,'assets/app.js'),'utf8')
const css = fs.readFileSync(path.join(base,'assets/app.css'),'utf8')
const html = fs.readFileSync(path.join(base,'index.html'),'utf8')

// esbuild 会把非 ASCII 转义成 \uXXXX，比较时需转义
const esc = (s) => [...s].map(c=>'\\u'+c.charCodeAt(0).toString(16).toUpperCase().padStart(4,'0')).join('')
const has = (hay, needle) => hay.includes(needle) || hay.includes(esc(needle))

// ---- JS ----
ok(js.length>100000, `JS 体积 ${(js.length/1024).toFixed(0)}KB`)
ok(!js.includes('process.env.NODE_ENV'), '生产常量已替换')
for(const n of ['国际象棋','中国象棋','五子棋']) ok(has(js,n), `JS 含文案「${n}」`)
for(const n of ['帥','將','砲']) ok(has(js,n), `JS 含象棋棋子「${n}」`)
ok(js.includes('grid-board'), 'JS 含网格棋盘类名')
ok(has(js,'红方') && has(js,'黑方'), 'JS 含阵营称呼')
ok(js.includes('/engines/stockfish/'), 'JS 含引擎路径')
ok(!js.includes('localhost'), '无 localhost 残留')
ok(!js.includes('import.meta.env'), '无 import.meta.env')

// ---- CSS ----
ok(css.length>10000, `CSS 体积 ${(css.length/1024).toFixed(0)}KB`)
for(const sel of ['.grid-board','.grid-square','.grid-piece--hanzi','.grid-piece--dot',
                  '.grid-board--xiangqi','.grid-board--gomoku','.grid-dest-dot']){
  ok(css.includes(sel), `CSS 含 ${sel}`)
}
// is-selected / is-dest / is-last 是 JS 动态加的类，CSS 里应有点号选择器
for(const cls of ['is-selected','is-last']){
  ok(css.includes(cls), `CSS 覆盖 .${cls}`)
}
// grid-dest-dot 是渲染出的元素，样式必须存在
ok(css.includes('grid-dest-dot'), 'CSS 覆盖可落点圆点')

// ---- HTML ----
ok(html.includes('viewport-fit=cover'), '支持刘海屏')
ok(html.includes('lang="zh-CN"'), '语言中文')
ok(html.includes('chess-app'), '标题')

// ---- 无外部网络依赖（w3.org 是 SVG 命名空间，不是请求）----
{
  const urls = [...css.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map(m=>m[1])
  const external = urls.filter(u=>!u.startsWith('www.w3.org'))
  ok(external.length===0, `CSS 无外部域名请求（发现 ${JSON.stringify(external)}）`)
}
ok(!js.includes('fetch("http'), 'JS 无外部 fetch')

// ---- 引擎 ----
const eng = path.join(base,'engines/stockfish')
ok(fs.statSync(path.join(eng,'stockfish-19-lite-single.js')).size>20000, '引擎 JS 存在')
ok(fs.statSync(path.join(eng,'stockfish-19-lite-single.wasm')).size>1000000, '引擎 wasm 存在')
ok(fs.existsSync(path.join(eng,'COPYING.txt')), 'GPL 许可证副本存在')

// ---- 棋子 ----
ok(fs.readdirSync(path.join(base,'pieces')).filter(f=>f.endsWith('.png')).length===12, '棋子 12 张')

console.log('='.repeat(56))
if(fail===0) console.log(`✓ 验证5 产物分析：全部通过（${pass} 项）`)
else { console.log(`✗ 失败 ${fail} / 通过 ${pass}`); F.forEach(x=>console.log('  ✗ '+x)); process.exitCode=1 }
