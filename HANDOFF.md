# chess-app 交接文档

> 供新的对话继续开发使用。最后更新：2026-11-19
> 写完本文档时的状态：类型检查通过，6 批功能全部完成并已验证。

---

## 一、项目一句话

离线可用的国际象棋对局应用，React + TypeScript + Vite，支持与 Stockfish 引擎对弈、吃子积分、将军提醒。第一批只做国际象棋，架构预留多棋种扩展位。

## 二、绝对路径

| 用途 | 路径 |
|---|---|
| 项目根目录 | `D:\DeepSeek Harness Work\chess-app\` |
| 源码 | `D:\DeepSeek Harness Work\chess-app\src\` |
| 静态资源 | `D:\DeepSeek Harness Work\chess-app\public\` |
| 依赖 | `D:\DeepSeek Harness Work\chess-app\node_modules\` |
| pnpm store（项目内） | `D:\DeepSeek Harness Work\chess-app\.pnpm-store\` |
| **工作区根目录遗留 store** | `D:\DeepSeek Harness Work\.pnpm-store\`（271M，未清理，见第八节） |

## 三、运行方式（重要：本机特殊）

**本机没有全局 Node.js 和 npm**，shell 里执行 `node` / `npm` 都是 `command not found`。必须用 DeepSeek Harness 内置运行时的绝对路径。

### 可用的绝对路径

```
Node:  C:\Users\jiale\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe
pnpm:  C:\Users\jiale\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs
```

### 启动开发服务器（用户在自己终端执行）

```bat
cd /d "D:\DeepSeek Harness Work\chess-app"
"C:\Users\jiale\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" node_modules\vite\bin\vite.js
```

浏览器打开 `http://localhost:5173/`。改端口加 `--port 5174`。

### 类型检查

```bat
cd /d "D:\DeepSeek Harness Work\chess-app"
"C:\Users\jiale\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" node_modules\typescript\bin\tsc --noEmit
```

### 安装依赖（需要时）

```bat
cd /d "D:\DeepSeek Harness Work\chess-app"
set CI=true
"C:\Users\jiale\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" "C:\Users\jiale\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs" install --node-linker=hoisted
```

**必须带 `--node-linker=hoisted`**，否则 Windows 下符号链接会导致 esbuild 解析失败（见第七节坑 2）。

---

## 四、完整文件清单

### 根目录

| 文件 | 职责 |
|---|---|
| `package.json` | 依赖与 3 个脚本（dev / build / test）|
| `tsconfig.json` | TS 配置，strict 模式，`types` 含 vite/client 与 vitest/globals |
| `vite.config.ts` | Vite + React 插件 + COOP/COEP 头（当前单线程引擎用不到，预留）|
| `vitest.config.ts` | Vitest 配置，`globals: true` 配合 tsconfig |
| `index.html` | 入口，挂载 `/src/main.tsx` |
| `.npmrc` | 3 行：`store-dir=.pnpm-store`、`verify-deps-before-run=false`、`node-linker=hoisted` |
| `.gitignore` | 忽略 node_modules / dist |
| `LICENSE` | GPL-3.0 全文（231 行）|
| `README.md` | 项目说明（其中的 pnpm 命令在本机不可用，以本文档为准）|
| `pnpm-lock.yaml` | 锁定版本 |

### src 源码（20 个文件，2076 行）

| 文件 | 行数 | 职责 |
|---|---|---|
| `src/main.tsx` | 20 | 挂载 React；**引入 3 个 chessground 样式 + global.css** |
| `src/App.tsx` | 12 | 顶层路由：有 gameId 显示对局页，否则显示大厅 |
| `src/core/types.ts` | 62 | `GameEngine` 接口、`Move`、`MoveRecord`（含 `captured?`）|
| `src/core/result.ts` | 63 | `GameStatus` / `TerminationReason` 枚举 + 中文文案 |
| `src/core/meta.ts` | 40 | `GameMeta` 棋种元信息类型、`UnsupportedGameError` |
| `src/core/registry.ts` | 51 | 棋种注册表，第一批只注册国际象棋 |
| `src/core/score.ts` | 62 | 棋子价值表（兵1/马3/象3/车5/后9）、`computeScore()` |
| `src/games/chess/engine.ts` | 143 | chess.js 适配层，实现 `GameEngine` |
| `src/games/chess/meta.ts` | 19 | 国际象棋元信息（8×8、坐标、初始 FEN）|
| `src/games/chess/engine.test.ts` | 128 | 13 个 Vitest 用例（含 perft 前三层）|
| `src/ai/types.ts` | 53 | `AiEngine` 接口、三档难度配置 |
| `src/ai/stockfish.ts` | 195 | Worker 封装、UCI 握手、搜索队列串行化 |
| `src/store/gameStore.ts` | 153 | Zustand 状态：局面、历史、结果、AI 状态 |
| `src/ui/Lobby.tsx` | 82 | 大厅：对手选择（双人/电脑）+ 难度选择 + 棋种卡片 |
| `src/ui/GameScreen.tsx` | 159 | 对局页：AI 回合驱动、将军提示、按钮 |
| `src/ui/Board.tsx` | 89 | chessground 容器，dests 计算、升变处理 |
| `src/ui/MoveList.tsx` | 37 | 着法列表（SAN 成对显示）|
| `src/ui/Clock.tsx` | 86 | 加秒制计时器 |
| `src/ui/ScorePanel.tsx` | 34 | 吃子积分面板 |
| `src/styles/global.css` | 588 | 棋盘配色、棋子图片、深色模式、三级响应式 |

### public 静态资源

| 路径 | 内容 |
|---|---|
| `public/engines/stockfish/stockfish-19-lite-single.js` | 引擎 JS，28KB |
| `public/engines/stockfish/stockfish-19-lite-single.wasm` | 引擎 wasm，1.8MB |
| `public/engines/stockfish/COPYING.txt` | GPL 许可证副本（合规要求，勿删）|
| `public/pieces/{w,b}{p,n,b,r,q,k}.png` | 12 个棋子图片，256×256 透明 PNG |
| `public/icons/` | **空目录**，原始规划用，当前未使用 |

---

## 五、依赖与版本陷阱

### 运行时

| 包 | 版本 | 用途 | 许可 |
|---|---|---|---|
| `react` / `react-dom` | 18.3.1 | UI | MIT |
| `chess.js` | 1.4.0 | 国际象棋规则 | BSD-2 |
| `chessground` | **8.3.5** | 棋盘 UI | GPL-3.0 |
| `@react-chess/chessground` | 1.3.4 | React 封装 | GPL-3.0 |
| `zustand` | 5.1.0 | 状态管理 | MIT |
| `stockfish` | 19.0.1 | 引擎 | GPL-3.0 |

### 开发

`vite` 5.4.21、`@vitejs/plugin-react` 4.7.0、`typescript` 5.9.3、`vitest` 2.1.9、`@types/react` 18.3.31、`@types/react-dom` 18.3.7

### 版本陷阱（都是实测踩出来的）

| 陷阱 | 说明 |
|---|---|
| **chessground 必须是 8.x** | `@react-chess/chessground@1.3.4` 内置依赖是 chessground **8.3.5**。装 9.x 会导致两套实例并存，DOM 结构与 CSS 选择器不兼容，棋盘显示错乱。 |
| **`@react-chess/chessground` 版本是 1.x** | 原始方案写 `^4`，实际 npm 上最新只有 1.3.4。 |
| **棋子图片不在 chessground 里** | chessground 只带棋盘配色（`brown.css`）。棋子图形在 `chessground.cburnett.css` 里以内嵌 SVG 提供，本项目已用自定义图片覆盖。 |
| **stockfish 必须用 lite-single** | `stockfish-19.wasm` 约 99MB 且需 SharedArrayBuffer。`lite-single` 仅 1.8MB、不需要 COOP/COEP，官方推荐。 |
| **`type: "module"` 影响引擎文件** | `package.json` 的 `"type": "module"` 会让引擎 js 在 Node 下按 ESM 解析而报错。浏览器里作为 Worker 加载不受影响。 |

---

## 六、已完成的功能（6 批）

| 批次 | 内容 | 验收状态 |
|---|---|---|
| 1 | 项目骨架、依赖安装、LICENSE | ✓ |
| 2 | 核心抽象（GameEngine）、国际象棋规则、perft 测试 | ✓ perft 20/400/8902 全对 |
| 3 | 棋盘与对局界面（Lobby / GameScreen / Board / MoveList / Clock）| ✓ 类型 + 逻辑验证 |
| 4 | 离线 AI（Stockfish Worker、三档难度）| ✓ 引擎实测出招 |
| 5 | 响应式布局重构 + 视觉精修 | ✓ 9 种视口核算通过 |
| 6 | 吃子积分（兵1/马3/象3/车5/后9）+ 将军提醒 | ✓ 11 条断言 + 12 项回归 |

### 难度映射

| 档位 | Skill Level | movetime | 标注 Elo |
|---|---|---|---|
| 简单 | 3 | 300ms | ~800 |
| 中等 | 10 | 600ms | ~1400 |
| 困难 | 20 | 1200ms | ~2000 |

---

## 七、已知问题与踩坑记录

### 已知问题（未修复，需用户决定）

| # | 问题 | 说明 |
|---|---|---|
| 1 | 白马图片有极淡矩形边 | 白棋填充色 `(218,229,235)` 与白格 `(255,255,255)` 差值仅约 20，接近 JPEG 噪声。已试 5 种抠图方案，这是物理极限。改用深色棋盘可解决。 |
| 2 | `public/icons/` 是空目录 | 原始规划要用，实际改用 `public/pieces/`。可删可留。 |
| 3 | 工作区根目录 `.pnpm-store/` 271M | 首次安装时 pnpm 自动创建，后续已改到项目内。用户当时说「先留」，未清理。 |
| 4 | README 里的命令本机不可用 | README 写的是 `pnpm dev`，本机没有全局 pnpm。以本文档第三节为准。 |

### 踩过的坑（同一处不要再踩）

| # | 坑 | 正确做法 |
|---|---|---|
| 1 | pnpm 默认软链结构在 Windows 下 esbuild 解析失败 | `.npmrc` 配 `node-linker=hoisted`，安装时也带 `--node-linker=hoisted` |
| 2 | pnpm 在无 TTY 环境中止依赖重建 | 设环境变量 `CI=true` |
| 3 | `movable.color` 必须是 `'white'/'black'/'both'` | chessground 用颜色词，不是 `'w'/'b'`。传错则棋子拖不动。 |
| 4 | `Lobby` 传 `playerSide='w'` 导致黑方卡死 | 单机对局传 `'both'` |
| 5 | 升变时不传 `promotion` 会抛 `Invalid move` | 从 `legalMoves()` 里匹配同 from/to 的候选，带上升变字段 |
| 6 | AI 第二步不动 | 根因是 StrictMode 重复挂载 + 单例 Worker + `abort()` 三者叠加。已用「搜索队列串行化」+「同一局面只发起一次」修复 |
| 7 | zustand 5 的 SSR 读 `getInitialState()` | 服务端渲染拿不到最新状态。只影响 SSR，浏览器端正常。若要做预渲染需改 `createStore` 手动传 `getServerSnapshot` |
| 8 | `--config.frozen-lockfile` 在 pnpm 11 无效 | 用 `--config.frozen-lockfile=false` 或 `--no-frozen-lockfile`（install 时）|

---

## 八、沙箱限制（影响验证方式）

当前会话的沙箱**禁止创建任何子进程**（`spawn EPERM`）。实测 `node`、`cmd.exe`、`esbuild` 全部失败。因此：

| 受阻的验证 | 影响 |
|---|---|
| `vite` 启动 dev server | 模块全部返回 500，无法在浏览器实操 |
| `vitest run` | 无法启动 worker |
| `vite build` | esbuild 需要 spawn |
| Web Worker 加载引擎 | 无法验证 AI 实际走子 |

**替代验证手段**（已验证有效，可继续用）：

```bat
:: 1. 类型检查（不受影响）
node_modules\typescript\bin\tsc --noEmit

:: 2. 用 esbuild 二进制脱离 spawn 打包源码，再用 node 跑断言
node_modules\@esbuild\win32-x64\esbuild.exe src/games/chess/engine.ts ^
  --bundle --format=esm --platform=node --external:chess.js --outfile=.verify/engine.mjs
node .verify/engine.mjs
```

注意：打包后模块间的相对导入会保留 `./xxx` 无扩展名形式，需要手动加 `.js` 或用 `--outbase=src --outdir`。

---

## 九、扩展下一个棋种的方法

架构已预留，加一个棋种只需 3 步：

1. 在 `src/games/<棋种>/` 下新建 `engine.ts`（实现 `GameEngine`）和 `meta.ts`（`GameMeta`）
2. 在 `src/core/registry.ts` 末尾加一行 `register({ meta: xxxMeta, create: () => new XxxEngine() })`
3. 完成。`Lobby` 会自动列出新棋种，无需改 UI 代码

---

## 十、给下一个对话的建议起点

如果用户说「继续做」，先问清楚要做什么方向。以下是当时留下的候选：

| 方向 | 说明 |
|---|---|
| 修白马图片残留 | 换深色棋盘最省事，或重做素材 |
| 加 PGN 导出 | chess.js 已有 `pgn()`，只需加按钮 |
| 加存档 | `engine.encode()` 已经是 FEN，配 localStorage 即可 |
| 加其他棋种 | 按第九节 3 步走 |
| 移动端触控优化 | chessground 在 Safari 上拖拽偶有偏移，可切「点选两次」模式 |
| 清理遗留 store | 根目录 `.pnpm-store/` 271M，需用户授权删除 |
