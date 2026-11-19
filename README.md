# chess-app

三种棋，一个应用。**国际象棋、中国象棋、五子棋**，支持本地双人、人机对战、房间码联机。
纯前端 PWA，可安装到手机主屏幕，本地对局离线可玩。

---

## 功能

| 能力 | 说明 |
|---|---|
| 国际象棋 | 8×8，chessground 棋盘，支持拖拽、升变、将杀判定 |
| 中国象棋 | 9×10，完整走法（含马腿、炮架、飞将、九宫限制） |
| 五子棋 | 15×15，支持**禁手**（三三 / 四四 / 长连）与无禁手两种规则 |
| 本地双人 | 同一设备轮流走子 |
| 人机对战 | 三种棋都有内置 AI，三档难度 |
| 联机对弈 | 4 位房间码，公网可用，支持断线重连、悔棋/和棋协商、房间内聊天 |
| PWA | 可添加到主屏幕，离线可玩本地对局 |

### 规则严格程度

- 所有合法性判定都在引擎里，UI 只负责渲染和点击
- 五子棋禁手只约束黑棋；白棋无禁手，六连以上仍算胜
- 象棋判负条件：吃将、困毙（无合法着法）

---

## 快速开始

### 环境

需要 Node.js 18+。

```bash
npm install
```

### 开发

```bash
npm run dev          # Vite 开发服务器，默认 http://localhost:5173
npm run typecheck    # 只做类型检查
```

### 构建

```bash
npm run build        # 类型检查 + 打包到 dist/
npm run build:fast   # 跳过类型检查，直接打包
```

### 本地跑起来（含联机）

```bash
npm run build
npm start            # 服务端 + 前端一起，默认 http://localhost:8080
```

两台设备联机：把 `localhost` 换成局域网 IP，例如 `http://192.168.1.10:8080`。

---

## 部署

详见 **[DEPLOY.md](./DEPLOY.md)**。一句话版本：

- **最省事**：`server/` 一个服务端同时托管前端和 WebSocket，部署到 Render / Railway 免费额度即可
- **分开部署**：前端放 Vercel / Netlify，服务端放 Render，前端用 `localStorage` 指定服务端地址
- **不想买服务器**：本机跑服务端 + Cloudflare Tunnel / ngrok 内网穿透

仓库里已备好 `render.yaml` 与 `railway.json`。

---

## 目录结构

```
chess-app/
├─ src/
│  ├─ core/        GameEngine 接口、结果模型、积分、棋种注册表
│  ├─ games/       三种棋的规则引擎
│  │  ├─ chess/    国际象棋（封装 chess.js）
│  │  ├─ xiangqi/  中国象棋（自实现 9×10 引擎）
│  │  └─ gomoku/   五子棋（自实现 15×15 引擎 + 禁手判定）
│  ├─ ai/          AI 层
│  │  ├─ stockfish.ts   国际象棋（Stockfish WASM Worker）
│  │  ├─ xiangqi-ai.ts  中国象棋（alpha-beta + 置换表）
│  │  ├─ gomoku-ai.ts   五子棋（形状评估 + 负极大值搜索）
│  │  └─ index.ts       按棋种分发
│  ├─ net/         联机协议与客户端
│  ├─ store/       Zustand 状态（本地对局 / 联机）
│  ├─ ui/          界面组件
│  └─ styles/      全局样式
├─ server/         零依赖联机服务端（原生 http + 手写 WebSocket）
├─ public/         静态资源：棋子图、Stockfish 引擎、PWA 图标、sw.js
├─ scripts/        构建与图标生成脚本
├─ dist/           构建产物（可直接部署）
└─ android/        APK 方案说明（当前阶段不构建）
```

---

## 架构要点

### 一套接口，三种棋

`GameEngine` 接口（`src/core/types.ts`）规定：`turn()` / `legalMoves()` / `applyMove()` /
`undoMove()` / `result()` / `isCheck()` / `history()` / `encode()` / `decode()` / `position()`。
棋种通过 `src/core/registry.ts` 注册，UI 完全不知道具体是哪种棋。

结果模型用**先行方 / 后行方**而不是白 / 黑——因为三种棋的首手方不同
（国际象棋白先、象棋红先、五子棋黑先）。

### 两套棋盘渲染

- 国际象棋用 chessground（拖拽、动画、升变开箱即用）
- 象棋和五子棋用自绘 CSS 网格（chessground 把尺寸写死为 8×8，无法承载 9×10 和 15×15）

两套共用同一份「合法着法 → 可点击格子」的推导逻辑，规则永远来自引擎。

### 联机：服务端不跑规则

服务端只做三件事：**房间管理、回合校验、消息转发**。胜负由客户端引擎判定后
通过 `game-over` 告知对端。这样服务端可以保持极简（零依赖、单文件），
规则改动不需要重新部署后端。

断线重连：服务端在进房时下发 token，客户端存 `sessionStorage`，
刷新页面后自动用 token 恢复身份，房间保留 30 分钟。

---

## 已知限制

- 联机房间存在内存里，**服务端重启后房间全部丢失**
- 没有观战、没有全局聊天室、没有排行榜（当前版本刻意不做）
- 联机悔棋需要对方同意
- 没有走子计时器，只统计每方总用时和步数

---

## 许可

GPL-3.0-or-later。国际象棋棋子素材来自 chessground 的 cburnett 主题，
Stockfish 引擎按其自身许可（GPL-3.0）分发，见 `public/engines/stockfish/COPYING.txt`。
