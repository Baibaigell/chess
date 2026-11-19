/**
 * 构建后处理：复制静态资源、生成 index.html、打印报告。
 *
 * 单独成文件是为了在两种环境下都能用：
 * - 正常机器：scripts/build.mjs 调 esbuild API 打包，再调本文件收尾
 * - 受限环境（无法创建子进程）：先用 esbuild 命令行二进制打包，
 *   再单独运行本文件
 *
 * 用法：node scripts/postbuild.mjs
 */
import { readFile, writeFile, mkdir, rm, cp, stat, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const DIST = path.join(ROOT, 'dist')
export const PUBLIC = path.join(ROOT, 'public')
export const ASSETS = path.join(DIST, 'assets')

/** 递归统计目录大小与文件数 */
export async function dirStats(dir) {
  let bytes = 0
  let files = 0
  async function walk(d) {
    const entries = await readdir(d, { withFileTypes: true })
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) await walk(p)
      else {
        const s = await stat(p)
        bytes += s.size
        files++
      }
    }
  }
  if (existsSync(dir)) await walk(dir)
  return { bytes, files }
}

/** 人类可读的体积 */
export function human(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/** 复制 public/ 到 dist/ */
export async function copyPublic() {
  if (!existsSync(PUBLIC)) return
  console.log('[build] 复制 public/')
  await cp(PUBLIC, DIST, { recursive: true })
}

/** 由 index.html 模板生成 dist/index.html */
export async function emitHtml() {
  console.log('[build] 生成 index.html')
  const templatePath = path.join(ROOT, 'index.html')
  let html = await readFile(templatePath, 'utf8')

  // 去掉开发入口，换成构建产物。
  // 注意用 [ \t]* 而不是 \s*：\s 会把下一行的缩进也吃掉，
  // 导致后面的 '  </body>' 匹配不上。
  html = html
    .replace(/[ \t]*<script[^>]*src="\/src\/main\.tsx"[^>]*><\/script>[ \t]*\r?\n?/, '')
    .replace('  </head>', '    <link rel="stylesheet" href="/assets/app.css" />\n  </head>')
    .replace('  </body>', '    <script type="module" src="/assets/app.js"></script>\n  </body>')

  await writeFile(path.join(DIST, 'index.html'), html, 'utf8')
}

/** 打印构建报告 */
export async function report() {
  const jsPath = path.join(ASSETS, 'app.js')
  const cssPath = path.join(ASSETS, 'app.css')
  const jsSize = existsSync(jsPath) ? (await stat(jsPath)).size : 0
  const cssSize = existsSync(cssPath) ? (await stat(cssPath)).size : 0
  const total = await dirStats(DIST)

  console.log('')
  console.log('='.repeat(52))
  console.log('  构建完成')
  console.log('='.repeat(52))
  console.log(`  JS        ${human(jsSize)}  assets/app.js`)
  console.log(`  CSS       ${human(cssSize)}  assets/app.css`)
  console.log(`  总文件数  ${total.files}`)
  console.log(`  总体积    ${human(total.bytes)}`)
  console.log(`  输出目录  ${DIST}`)
  console.log('='.repeat(52))
}

// 直接运行时执行全部后处理步骤
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  if (!existsSync(ASSETS)) await mkdir(ASSETS, { recursive: true })
  await copyPublic()
  await emitHtml()
  await report()
}
