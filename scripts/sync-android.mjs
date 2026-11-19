/**
 * 把 dist/ 同步进 Android 工程的 assets/。
 *
 * APK 里前端从 assets 读取（WebViewAssetLoader 映射成
 * https://appassets.androidplatform.net/），因此每次改前端都要同步一次，
 * 否则打出来的 APK 还是旧代码。
 *
 * 用法：node scripts/sync-android.mjs
 *
 * 同步策略：先清空目标里「由 dist 管理」的条目，再全量复制。
 * 不能整个目录删掉——assets/selftest.html 是手写的独立自测页，
 * 不在 dist 里，必须保留。
 */
import { readdir, rm, mkdir, copyFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const ASSETS = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets')

/** 这些名字由 dist 管理，同步前清掉（其余如 selftest.html 保留） */
const MANAGED = ['assets', 'engines', 'icons', 'pieces', 'index.html', 'manifest.webmanifest', 'sw.js']

/** 递归复制目录 */
async function copyDir(from, to) {
  await mkdir(to, { recursive: true })
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name)
    const dst = path.join(to, entry.name)
    if (entry.isDirectory()) await copyDir(src, dst)
    else await copyFile(src, dst)
  }
}

/** 统计目录里的文件数与总字节 */
async function dirStats(dir) {
  let files = 0
  let bytes = 0
  async function walk(d) {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name)
      if (entry.isDirectory()) await walk(p)
      else {
        files++
        bytes += (await stat(p)).size
      }
    }
  }
  await walk(dir)
  return { files, bytes }
}

function human(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

// ==================== 主流程 ====================

if (!existsSync(DIST)) {
  console.error('[sync] 找不到 dist/，请先执行 npm run build')
  process.exit(1)
}

await mkdir(ASSETS, { recursive: true })

// 1. 清掉 dist 管理的旧条目
console.log('[sync] 清理旧资源')
for (const name of MANAGED) {
  const p = path.join(ASSETS, name)
  if (existsSync(p)) {
    await rm(p, { recursive: true, force: true })
    console.log(`[sync]   删除 ${name}`)
  }
}

// 2. 全量复制
console.log('[sync] 复制 dist/ → assets/')
await copyDir(DIST, ASSETS)

// 3. 报告
const d = await dirStats(DIST)
const a = await dirStats(ASSETS)
const keep = (await readdir(ASSETS)).filter((n) => !MANAGED.includes(n))

console.log('')
console.log('='.repeat(52))
console.log('  Android assets 同步完成')
console.log('='.repeat(52))
console.log(`  来源      ${DIST}`)
console.log(`  目标      ${ASSETS}`)
console.log(`  dist      ${d.files} 文件 / ${human(d.bytes)}`)
console.log(`  assets    ${a.files} 文件 / ${human(a.bytes)}`)
if (keep.length) console.log(`  额外保留  ${keep.join(', ')}`)
console.log('='.repeat(52))
