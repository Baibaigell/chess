/** 检查 dist 产物里是否包含预期的界面文案与功能标记 */
import { readFileSync } from 'node:fs'

const js = readFileSync('dist/assets/app.js', 'utf8')
const css = readFileSync('dist/assets/app.css', 'utf8')
const html = readFileSync('dist/index.html', 'utf8')

const jsNeed = [
  '联机对局',
  '创建房间',
  '加入房间',
  '提议悔棋',
  '提议和棋',
  '三三禁手',
  '长连禁手',
  '可对电脑',
  '五子棋',
  '中国象棋',
  '国际象棋',
  '房间码',
  '重连',
  'online-panel',
  'room-code',
  'sw.js',
]

const cssNeed = [
  'online-panel',
  'room-code',
  'online-entry',
  'online-conn',
  'rule-banner',
  'btn-small',
]

let bad = 0
console.log('--- JS 产物 ---')
for (const s of jsNeed) {
  const hit = js.includes(s)
  if (!hit) bad++
  console.log(`${hit ? '✓' : '✗'} ${s}`)
}

console.log('--- CSS 产物 ---')
for (const s of cssNeed) {
  const hit = css.includes(s)
  if (!hit) bad++
  console.log(`${hit ? '✓' : '✗'} ${s}`)
}

console.log('--- index.html ---')
for (const s of ['/assets/app.js', '/assets/app.css', 'manifest.webmanifest', 'apple-touch-icon']) {
  const hit = html.includes(s)
  if (!hit) bad++
  console.log(`${hit ? '✓' : '✗'} ${s}`)
}

console.log('')
console.log(`JS ${(js.length / 1024).toFixed(1)} KB / CSS ${(css.length / 1024).toFixed(1)} KB`)
console.log(bad === 0 ? '✓ 产物内容核对通过' : `✗ 缺失 ${bad} 项`)
process.exit(bad === 0 ? 0 : 1)
