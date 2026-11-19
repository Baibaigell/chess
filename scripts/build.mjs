/**
 * 构建脚本：产出可直接部署的 dist/。
 *
 * 优先走 esbuild 的 JS API（正常机器都能用）。
 * 若环境禁止创建子进程（esbuild 的 JS API 需要一个常驻服务进程，
 * 某些沙箱会返回 spawn EPERM），自动回退到直接调用 esbuild 二进制：
 * 二进制以一次性进程运行，不依赖子进程通信。
 *
 * 两条路径产物完全一致：打包 main.tsx → 复制 public/ → 生成 index.html。
 *
 * 用法：node scripts/build.mjs
 */
import { spawnSync } from 'node:child_process'
import { readFile, writeFile, mkdir, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyPublic, emitHtml, report, ASSETS, DIST } from './postbuild.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')

/** 打包参数：两条路径共用 */
const ENTRY = path.join(SRC, 'main.tsx')
const OUT_JS = path.join(ASSETS, 'app.js')

const COMMON = {
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  jsx: 'automatic',
  minify: true,
  // 中文原样输出，不转成 \uXXXX：体积更小，产物可直接核对文案
  charset: 'utf8',
  sourcemap: false,
  loader: { '.tsx': 'tsx', '.ts': 'ts', '.css': 'css', '.png': 'file', '.svg': 'file' },
  // 引擎与图标走 public/，运行时按绝对路径请求，不进 bundle
  external: ['/engines/*', '/icons/*'],
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none',
  logLevel: 'warning',
}

/** 找出 esbuild 原生二进制 */
function findEsbuildBin() {
  const candidates = [
    path.join(ROOT, 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe'),
    path.join(ROOT, 'node_modules', '@esbuild', 'linux-x64', 'bin', 'esbuild'),
    path.join(ROOT, 'node_modules', '@esbuild', 'darwin-x64', 'bin', 'esbuild'),
    path.join(ROOT, 'node_modules', '@esbuild', 'darwin-arm64', 'bin', 'esbuild'),
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

/** 路径 A：esbuild JS API */
async function buildWithApi() {
  const { build } = await import('esbuild')
  await build({ ...COMMON, entryPoints: [ENTRY], outfile: OUT_JS })
  return true
}

/** 路径 B：直接调 esbuild 二进制 */
function buildWithBinary(bin) {
  const args = [
    ENTRY,
    '--bundle',
    '--format=esm',
    '--platform=browser',
    '--target=es2020',
    '--jsx=automatic',
    '--minify',
    '--charset=utf8',
    `--outfile=${OUT_JS}`,
    '--loader:.tsx=tsx',
    '--loader:.ts=ts',
    '--loader:.css=css',
    '--loader:.png=file',
    '--loader:.svg=file',
    '--external:/engines/*',
    '--external:/icons/*',
    '--define:process.env.NODE_ENV="production"',
    '--legal-comments=none',
    '--log-level=warning',
  ]
  const r = spawnSync(bin, args, { cwd: ROOT, encoding: 'utf8' })
  if (r.stdout) process.stdout.write(r.stdout)
  if (r.stderr) process.stderr.write(r.stderr)
  if (r.status !== 0) throw new Error(`esbuild 二进制退出码 ${r.status}`)
  return true
}

// ==================== 主流程 ====================

console.log('[build] 清理 dist/')
await rm(DIST, { recursive: true, force: true })
await mkdir(ASSETS, { recursive: true })

console.log('[build] 打包 src/main.tsx')
let built = false
try {
  await buildWithApi()
  built = true
  console.log('[build] 使用 esbuild JS API')
} catch (e) {
  const msg = String(e)
  if (!msg.includes('EPERM') && !msg.includes('spawn')) throw e
  // 沙箱禁止子进程：回退到二进制
  const bin = findEsbuildBin()
  if (!bin) {
    console.error('[build] esbuild JS API 不可用，且未找到原生二进制')
    throw e
  }
  console.log('[build] JS API 不可用（沙箱禁止子进程），回退到 esbuild 二进制')
  buildWithBinary(bin)
  built = true
}

if (!built) throw new Error('构建失败')

// esbuild 把 CSS 输出到与 outfile 同名的 .css
const cssOut = path.join(ASSETS, 'app.css')
if (!existsSync(cssOut)) {
  // 某些配置下 CSS 被内联进 JS，补一个空文件避免 404
  await writeFile(cssOut, '')
}

await copyPublic()
await emitHtml()
await report()
