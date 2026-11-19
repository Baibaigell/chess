# 跨网络联机 · 交接文档

> 交接日期：2026-11-19
> 交接范围：把「棋」从局域网联机做成公网联机
> 前置状态：本地联机已跑通并验证，跨网络尚未开始

---

## 一、任务目标

让**两个处于不同网络**的玩家能联机对弈（国际象棋 / 中国象棋 / 五子棋）。

现状：只能在同一个 Wi-Fi 内联机。对方在另一个网络时访问不到 `192.168.91.119:8080`，因为那是私有地址。

---

## 二、已经做好的部分（不要重做）

| 项目 | 状态 | 位置 |
|---|---|---|
| 联机服务端 | 完成 | `server/server.js`（956 行，零依赖） |
| WebSocket 协议 | 完成 | `src/net/protocol.ts` |
| 联机客户端 | 完成 | `src/net/client.ts` |
| 联机界面 | 完成 | `src/ui/OnlineLobby.tsx`、`src/ui/OnlinePanel.tsx` |
| 联机状态管理 | 完成 | `src/store/onlineStore.ts` |
| 部署文档 | 完成 | `DEPLOY.md` |
| Render 配置 | 完成 | `render.yaml` |
| Railway 配置 | 完成 | `railway.json` |
| 本地联机验证 | 通过 | 三棋种建房/进房/走子/断线重连全测过 |

**核心结论：代码层面不需要任何改动就能跨网络联机。** 剩下的只是「怎么把服务端放到公网上」。

---

## 三、服务端的关键事实

```
PORT        环境变量，默认 8080（云平台会自动注入）
HOST        环境变量，默认 0.0.0.0（已经监听所有网卡，无需改）
STATIC_ROOT 环境变量，默认 ../dist（静态文件目录）
```

| 接口 | 用途 |
|---|---|
| `GET /api/health` | 健康检查，返回 `{"ok":true,"rooms":N,"uptime":秒}` |
| `GET /api/stats` | 房间数等统计 |
| `WS /` | WebSocket 升级（**不校验路径**，任何路径都能升级） |

启动命令：`node server/server.js`

房间规则：
- 4 位房间码（字母表 `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`，去掉了易混淆的 0/O/1/I）
- 无密码
- 房主执先行方
- 每房最多 2 个连接
- 房间状态存内存，**服务端重启即清空**
- 双方都断线后 30 分钟销毁房间

---

## 四、客户端的关键事实

客户端连哪个地址由 `resolveServerUrl()` 决定（`src/net/client.ts:55`）：

```js
// 1. 用户在 localStorage 里手动配过就用它
const custom = localStorage.getItem('chess-app.online.url')
if (custom) return custom.replace(/\/$/, '')

// 2. 开发服务器（5173/4173）连本地 8080
if (port === '5173' || port === '4173') return `${wsProtocol}//${hostname}:8080`

// 3. 其他情况：连当前页面的同源地址
return `${wsProtocol}//${hostname}${port ? ':' + port : ''}`
```

**关键点：**

- 全包部署（前端和服务端同一个域名）→ **什么都不用配**，自动同源
- 分开部署（前端在 Vercel，服务端在 Render）→ 需要在浏览器控制台执行一次：
  ```js
  localStorage.setItem('chess-app.online.url', 'wss://你的服务端域名')
  ```
- `https:` 页面自动用 `wss:`，`http:` 页面自动用 `ws:` —— 这行代码已经有了

其他存储键：
- `chess-app.online.name` —— 昵称（localStorage）
- `chess-app.online.cred` —— 重连凭据（sessionStorage，关标签页失效）

---

## 五、三个候选方案

### 方案 A：内网穿透（最快，5 分钟）

在自己电脑上跑隧道工具，把本地 8080 暴露成公网地址。

| 工具 | 免费 | 优点 | 缺点 |
|---|---|---|---|
| Cloudflare Tunnel | 无限流量 | 稳定、自带 HTTPS | 需要域名（可用免费的） |
| ngrok | 有限 | 注册即用 | 免费版地址每次变 |
| 花生壳 | 有免费版 | 国内速度快 | 要实名认证 |

命令示例（Cloudflare）：
```bash
cloudflared tunnel --url http://localhost:8080
```

**注意点：**
1. 必须确认隧道支持 **WebSocket**（Cloudflare Tunnel 和 ngrok 都支持）
2. 隧道给出的地址是 `https://`，客户端会自动改用 `wss://`
3. 你的电脑必须一直开着

**适合：临时和朋友下几盘。**

### 方案 B：云托管（推荐，长期可用）

把 `server/` 和 `dist/` 传到免费平台，得到固定网址。

| 平台 | 免费 | 说明 |
|---|---|---|
| Render | 有（15 分钟无访问会休眠） | `render.yaml` 已写好，最省事 |
| Railway | 有额度 | 部署快 |
| Fly.io | 有额度 | 全球节点 |

部署步骤（Render）：
1. 代码推到 GitHub
2. Render 新建 Web Service，连接仓库
3. Build Command：`node scripts/build.mjs`
4. Start Command：`node server/server.js`
5. 健康检查路径：`/api/health`

**适合：想随时能玩，不想开电脑。**

### 方案 C：VPS（最稳，需付费）

租云服务器（约 10~30 元/月），用 systemd + Nginx 部署。

`DEPLOY.md` 第 64 行起有完整步骤，含关键的 Nginx 配置：
```nginx
proxy_read_timeout 3600s;   # WebSocket 必须调大，否则连接会断
```

**适合：长期稳定使用。**

---

## 六、交接建议

**先做方案 A 验证链路**，理由是：

1. 不用注册云平台、不用改代码
2. 5 分钟就能确认「跨网络联机」这条路通不通
3. 如果 WebSocket 穿透有问题，方案 A 能立刻暴露出来
4. 验证通过后再决定要不要上方案 B 长期化

**验证清单（方案 A）：**

- [ ] 隧道建好，拿到 `https://xxx.trycloudflare.com`
- [ ] 本机浏览器打开该地址，能看到大厅
- [ ] 点「联机对局」，连接徽标显示「已连接」（说明 WebSocket 握手成功）
- [ ] 创建房间，拿到 4 位房间码
- [ ] 让另一个网络的人打开同一地址，输入房间码进房
- [ ] 双方走子能互相看到
- [ ] 断网重连后能回到原对局

只要第 3 步「已连接」出现，就说明 WebSocket 穿透没问题。

---

## 七、环境与坑

### 本机构建

沙箱限制 `spawn EPERM`，`vite build` / `vitest` / esbuild 的 JS API 全部不可用。必须两段式构建：

```bash
cd "D:\DeepSeek Harness Work\chess-app"

# 第一段：直接用 esbuild 二进制打包
./node_modules/@esbuild/win32-x64/esbuild.exe src/main.tsx \
  --bundle --format=esm --platform=browser --target=es2020 --jsx=automatic \
  --minify --charset=utf8 --outfile=dist/assets/app.js \
  --loader:.tsx=tsx --loader:.ts=ts --loader:.css=css \
  --loader:.png=file --loader:.svg=file \
  --external:/engines/* --external:/icons/* \
  --define:process.env.NODE_ENV='"production"' \
  --legal-comments=none

# 第二段：复制 public/ 并生成 index.html
node scripts/postbuild.mjs
```

Node 路径：
```
C:/Users/jiale/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node.exe
```

云平台没有这个限制，用 `node scripts/build.mjs` 即可（它会自动选路径）。

### 类型检查

```bash
"$NODE" node_modules/typescript/bin/tsc --noEmit
```

当前通过。

### Service Worker 缓存

`public/sw.js` 的 `VERSION` 每次发布前端改动都要递增（当前 `v4`）。静态资源已改成 **network-first**，不会再有「改了看不到」的问题。

用户如果还看到旧版，需要：F12 → Application → Service Workers → Unregister → Storage → Clear site data → Ctrl+Shift+R。

### 已验证的自测

| 文件 | 项数 | 说明 |
|---|---|---|
| `.verify/b1_engines.test.ts` | 23 | 三种引擎 + AI |
| `.verify/b2_server.test.mjs` | 38 | 服务端协议 |
| `.verify/b2_e2e.test.mjs` | 29 | 双客户端端到端 |
| `.verify/b3_dist.test.mjs` | — | 产物核对 |
| `.verify/b3_ui.test.ts` | 51 | 界面渲染 |
| `.verify/b4_fixes.test.ts` | 43 | 人机/联机 bug 回归 |
| `.verify/b5_online_page.test.ts` | 26 | 联机页回归 |

跑法：esbuild 打包成 `.mjs` 再用 Node 执行（`.test.ts` 需先 bundle，`.test.mjs` 可直接跑）。

---

## 八、当前运行状态

服务端在后台运行（job `bash-390022f2ff074364`），监听 `0.0.0.0:8080`。

```
健康检查：http://localhost:8080/api/health
局域网：  http://192.168.91.119:8080
```

`dist/` 已是最新构建（11 文件 / 2.17 MB，SW v4）。

---

## 九、边界

**已经确认不做的：**
- 观战
- 全局聊天
- 排行榜
- 账号系统
- APK（用户说「以后再说」）

**明确的产品取舍：**
- 房间状态存内存，重启丢失 —— 已确认可接受
- 服务端只转发并校验回合，规则由客户端判定 —— 已确认
- 联机悔棋需对方同意 —— 已确认

---

## 十、接手后第一步

1. 读 `DEPLOY.md`（已有完整方案）
2. 确认服务端还在跑：`curl http://localhost:8080/api/health`
3. 问用户选哪个方案
4. 按方案执行，重点验证 WebSocket 握手

**如果用户只是想快速试一下**，直接上方案 A 的 Cloudflare Tunnel，5 分钟能出结果。
