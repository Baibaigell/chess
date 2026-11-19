/**
 * 生成 PWA 图标：纯 Node，不依赖任何图像库。
 *
 * 自己写 PNG 编码：PNG = 签名 + IHDR + IDAT(zlib deflate) + IEND。
 * 像素用 4 倍超采样再缩采样，得到平滑边缘（不需要 canvas）。
 *
 * 图案：深色底 + 细棋盘网格 + 一黑一白两枚棋子，
 * 小尺寸下也能看出是「棋」。
 *
 * 用法：node scripts/gen-icons.mjs
 */
import { deflateSync } from 'node:zlib'
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'public', 'icons')

/** CRC32 查表 */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** 组装一个 PNG chunk */
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBuf, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

/** 把 RGBA 像素数组编码成 PNG */
function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // 位深
  ihdr[9] = 6 // 颜色类型 RGBA
  ihdr[10] = 0 // 压缩
  ihdr[11] = 0 // 过滤
  ihdr[12] = 0 // 隔行

  // 每行前加一个 filter 字节（0 = None）
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ==================== 绘制 ====================

/** 画布：用超采样提高边缘质量 */
const SS = 4

/**
 * 在浮点画布上绘制图标。
 *
 * 坐标系：0..1 归一化，便于任意尺寸复用。
 * 返回 [r,g,b,a] 0..255。
 */
function renderAt(size) {
  const S = size * SS
  // 累积缓冲
  const buf = new Float64Array(S * S * 4)

  /** 往缓冲写一个像素（alpha 混合，source-over） */
  function blend(x, y, r, g, b, a) {
    if (x < 0 || y < 0 || x >= S || y >= S || a <= 0) return
    const i = (y * S + x) * 4
    const sa = Math.min(1, a)
    const da = buf[i + 3]
    const oa = sa + da * (1 - sa)
    if (oa <= 0) return
    buf[i] = (r * sa + buf[i] * da * (1 - sa)) / oa
    buf[i + 1] = (g * sa + buf[i + 1] * da * (1 - sa)) / oa
    buf[i + 2] = (b * sa + buf[i + 2] * da * (1 - sa)) / oa
    buf[i + 3] = oa
  }

  /** 圆角矩形覆盖判定 */
  function inRoundRect(x, y, x0, y0, x1, y1, rad) {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false
    const cx = Math.min(Math.max(x, x0 + rad), x1 - rad)
    const cy = Math.min(Math.max(y, y0 + rad), y1 - rad)
    const dx = x - cx
    const dy = y - cy
    return dx * dx + dy * dy <= rad * rad + 0.0001 || (x >= x0 + rad && x <= x1 - rad) || (y >= y0 + rad && y <= y1 - rad)
  }

  // ---- 1. 底色：深蓝渐变 + 圆角 ----
  const pad = S * 0.055
  const rad = S * 0.22
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!inRoundRect(x + 0.5, y + 0.5, pad, pad, S - pad, S - pad, rad)) continue
      const t = y / S
      // 深蓝到更深蓝的竖向渐变
      const r = 26 + (16 - 26) * t
      const g = 40 + (26 - 40) * t
      const b = 62 + (44 - 62) * t
      blend(x, y, r, g, b, 1)
    }
  }

  // ---- 2. 棋盘网格 ----
  const gridInset = S * 0.16
  const gridSize = S - gridInset * 2
  const cells = 8
  const step = gridSize / cells
  const lineW = Math.max(1, S * 0.004)

  // 竖向线
  for (let i = 0; i <= cells; i++) {
    const gx = gridInset + i * step
    for (let y = Math.floor(gridInset); y < gridInset + gridSize; y++) {
      for (let d = 0; d < lineW; d++) {
        const x = Math.floor(gx + d)
        if (inRoundRect(x + 0.5, y + 0.5, pad, pad, S - pad, S - pad, rad)) {
          blend(x, y, 130, 165, 220, 0.30)
        }
      }
    }
  }
  // 横向线
  for (let i = 0; i <= cells; i++) {
    const gy = gridInset + i * step
    for (let x = Math.floor(gridInset); x < gridInset + gridSize; x++) {
      for (let d = 0; d < lineW; d++) {
        const y = Math.floor(gy + d)
        if (inRoundRect(x + 0.5, y + 0.5, pad, pad, S - pad, S - pad, rad)) {
          blend(x, y, 130, 165, 220, 0.30)
        }
      }
    }
  }

  // ---- 3. 两枚棋子（黑子在左上，白子在右下，略有重叠） ----
  const stoneR = S * 0.19

  /** 画一枚棋子：径向渐变 + 高光 + 投影 */
  function stone(cx, cy, radius, isWhite) {
    for (let y = Math.floor(cy - radius * 1.4); y <= cy + radius * 1.4; y++) {
      for (let x = Math.floor(cx - radius * 1.4); x <= cx + radius * 1.4; x++) {
        const dx = x + 0.5 - cx
        const dy = y + 0.5 - cy
        const dist = Math.hypot(dx, dy)

        // 投影
        const shadowDist = Math.hypot(dx - radius * 0.06, dy - radius * 0.14)
        if (shadowDist < radius * 1.02) {
          const a = 0.3 * (1 - shadowDist / (radius * 1.02))
          blend(x, y, 0, 0, 0, a)
        }

        if (dist > radius) continue

        // 归一化位置，-1..1
        const nx = dx / radius
        const ny = dy / radius
        // 光从左上
        const light = Math.max(0, 1 - Math.hypot(nx + 0.42, ny + 0.42) / 1.5)
        const edge = 1 - Math.pow(dist / radius, 6)

        let r, g, b
        if (isWhite) {
          const base = 236 + 19 * light
          r = base
          g = base
          b = Math.min(255, base + 2)
        } else {
          const base = 14 + 46 * light
          r = base
          g = base + 4
          b = base + 10
        }

        // 边缘轻微压暗，增强立体
        const rim = 0.86 + 0.14 * edge
        blend(x, y, r * rim, g * rim, b * rim, 1)
      }
    }
  }

  stone(S * 0.40, S * 0.41, stoneR, false)
  stone(S * 0.61, S * 0.60, stoneR, true)

  // ---- 4. 降采样 ----
  const out = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * S + (x * SS + sx)) * 4
          const sa = buf[i + 3]
          r += buf[i] * sa
          g += buf[i + 1] * sa
          b += buf[i + 2] * sa
          a += sa
        }
      }
      const n = SS * SS
      const o = (y * size + x) * 4
      if (a > 0) {
        out[o] = Math.round(Math.min(255, r / a))
        out[o + 1] = Math.round(Math.min(255, g / a))
        out[o + 2] = Math.round(Math.min(255, b / a))
        out[o + 3] = Math.round((a / n) * 255)
      }
    }
  }
  return out
}

// ==================== 输出 ====================

await mkdir(OUT, { recursive: true })

const sizes = [192, 512]
for (const size of sizes) {
  console.log(`[icons] 生成 ${size}×${size}`)
  const rgba = renderAt(size)
  const png = encodePng(size, size, rgba)
  const file = path.join(OUT, `icon-${size}.png`)
  await writeFile(file, png)
  console.log(`         ${file}  ${(png.length / 1024).toFixed(1)} KB`)
}

// maskable 版本：内容缩到安全区内（80%），避免被裁成圆形时切掉棋子
console.log('[icons] 生成 maskable 512×512')
{
  const size = 512
  const inner = Math.round(size * 0.8)
  const src = renderAt(inner)
  const full = Buffer.alloc(size * size * 4)
  const off = Math.round((size - inner) / 2)
  // 先用底色填满整张
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4
      full[o] = 20
      full[o + 1] = 32
      full[o + 2] = 52
      full[o + 3] = 255
    }
  }
  // 再叠加缩放后的内容
  for (let y = 0; y < inner; y++) {
    for (let x = 0; x < inner; x++) {
      const s = (y * inner + x) * 4
      const a = src[s + 3] / 255
      if (a <= 0) continue
      const o = ((y + off) * size + (x + off)) * 4
      full[o] = Math.round(src[s] * a + full[o] * (1 - a))
      full[o + 1] = Math.round(src[s + 1] * a + full[o + 1] * (1 - a))
      full[o + 2] = Math.round(src[s + 2] * a + full[o + 2] * (1 - a))
      full[o + 3] = 255
    }
  }
  const png = encodePng(size, size, full)
  const file = path.join(OUT, 'icon-maskable-512.png')
  await writeFile(file, png)
  console.log(`         ${file}  ${(png.length / 1024).toFixed(1)} KB`)
}

console.log('[icons] 完成')
