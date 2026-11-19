# 部署文档

本项目分两部分：**前端**（纯静态，`dist/`）与**联机服务端**（`server/`，零依赖 Node）。
两者可以分开部署，也可以合在一起（服务端顺便托管 `dist/`，推荐）。

---

## 一、最快路径：一个服务端全包（推荐）

服务端自带静态文件托管，所以只要部署 `server/`，前端和联机同时上线。

### 1. 本地验证

```bash
# 构建前端（产物在 dist/）
node scripts/build.mjs

# 启动服务端（默认 8080，自动托管 dist/）
node server/server.js
```

打开 `http://localhost:8080` 即可。想两台设备联机，把 `localhost` 换成你电脑的局域网 IP，
手机连同一个 Wi-Fi 后访问 `http://192.168.x.x:8080`。

### 2. 部署到 Render

1. 把整个仓库推到 GitHub。
2. Render → **New** → **Web Service** → 选这个仓库。
3. 填写：

   | 项 | 值 |
   |---|---|
   | Runtime | `Node` |
   | Build Command | `npm install --prefix server && node scripts/build.mjs` |
   | Start Command | `node server/server.js` |
   | Health Check Path | `/api/health` |

4. 环境变量（可选）：

   | 变量 | 说明 | 默认 |
   |---|---|---|
   | `PORT` | 监听端口 | Render 自动注入 |
   | `STATIC_ROOT` | 静态文件目录 | `dist` |
   | `HOST` | 绑定地址 | `0.0.0.0` |

5. 部署完成后，Render 给出的 `https://xxx.onrender.com` 就是完整应用地址。
   前端与 WebSocket 同源，**不需要任何额外配置**。

> Render 免费实例 15 分钟无请求会休眠，首次访问要等 30 秒左右唤醒。
> 对局期间有 WebSocket 心跳（25 秒一次），不会休眠。

### 3. 部署到 Railway

Railway 的流程更简单，它会自己识别 `package.json`：

1. **New Project** → **Deploy from GitHub repo**。
2. 设置 → **Build Command**：`npm install --prefix server && node scripts/build.mjs`
3. 设置 → **Start Command**：`node server/server.js`
4. Railway 自动注入 `PORT`，无需手动配置。
5. **Settings → Networking → Generate Domain** 拿到公网地址。

也可以直接用仓库里的 `railway.json`（已配好）。

### 4. 部署到 Fly.io / VPS / 自己的服务器

任何能跑 Node 18+ 的地方都行：

```bash
npm install --prefix server
node scripts/build.mjs
PORT=8080 node server/server.js
```

用 systemd 托管：

```ini
[Unit]
Description=chess-app
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/chess-app
ExecStart=/usr/bin/node server/server.js
Environment=PORT=8080
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

Nginx 反代（**必须**转发 WebSocket 的 Upgrade 头）：

```nginx
server {
    listen 80;
    server_name chess.example.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 3600s;
    }
}
```

`proxy_read_timeout` 必须调大，否则长连接会在 60 秒空闲后被 Nginx 掐断。
上 HTTPS 用 `certbot --nginx` 一条命令即可；HTTPS 下前端会自动改用 `wss://`。

---

## 二、分开部署：前端静态站 + 联机服务端

适合前端放 CDN（Vercel / Netlify / Cloudflare Pages），服务端放 Render / Railway。

### 前端（Vercel / Netlify / Cloudflare Pages）

| 项 | 值 |
|---|---|
| Build Command | `node scripts/build.mjs` |
| Output Directory | `dist` |
| Node Version | 18+ |

> 注意：`scripts/build.mjs` 在禁止创建子进程的环境里会回退到直接调用
> esbuild 二进制。云平台的构建环境不受此限制，两条路径都能用。

### 服务端（Render / Railway）

同「一、2」的部署方式，但 **不要** 设置 `STATIC_ROOT`（或设成空目录），
前端资源由 CDN 提供。

### 连接两端

前端默认连「同源」的 WebSocket。前后端不同域时，需要在浏览器里指定服务端地址：

1. 打开前端站点，按 F12 进控制台，执行一次：

   ```js
   localStorage.setItem('chess-app.online.url', 'wss://你的服务端域名')
   ```

2. 刷新页面。

该设置存在 `localStorage`，只影响当前浏览器。

> 服务端已对 HTTP 请求开放 `Access-Control-Allow-Origin: *`，
> WebSocket 本身不受同源策略限制，因此跨域可用。

---

## 三、内网穿透（不想买服务器时）

本机跑服务端，用免费隧道暴露到公网。任选一个：

### Cloudflare Tunnel（免费、稳定、自带 HTTPS）

```bash
# 安装 cloudflared 后
cloudflared tunnel --url http://localhost:8080
```

输出里会给出 `https://xxx.trycloudflare.com`，直接用。

### ngrok

```bash
ngrok http 8080
```

### 花生壳 / frp

国内网络环境可用，配置略复杂，按各自文档做端口映射即可。

> 内网穿透都支持 WebSocket，但免费版可能有带宽或连接时长限制。

---

## 四、PWA：安装到手机主屏幕

部署到 HTTPS 后（`localhost` 也算安全上下文），浏览器会提供「添加到主屏幕」：

- **Android Chrome**：菜单 → 「安装应用」/「添加到主屏幕」
- **iOS Safari**：分享 → 「添加到主屏幕」
- **桌面 Chrome / Edge**：地址栏右侧的安装图标

安装后是独立窗口，全屏无地址栏。本地对局（含人机）**离线可玩**——
Service Worker 缓存了页面、样式、棋子和 Stockfish 引擎。
联机功能需要网络。

### 缓存策略

| 资源 | 策略 |
|---|---|
| HTML | network-first（有网永远最新，断网回退缓存） |
| JS / CSS / 图片 / 引擎 | stale-while-revalidate（秒开 + 后台更新） |
| WebSocket、`/api/` | 不拦截 |

改了前端代码要重新构建并更新 `public/sw.js` 里的 `VERSION`，
否则老用户会一直用旧缓存。

---

## 五、打包成 APK（以后再说）

当前阶段交付 PWA。若以后要 APK，`android/BUILD.md` 里有 WebViewAssetLoader
的方案说明——它把 `dist/` 打进 APK 的 assets 目录，本地对局完全离线，
联机则走 `WebSocket`（需要 `INTERNET` 权限）。

---

## 六、常见问题

**Q：房间码输对了却提示「房间不存在」**
服务端重启后房间全部丢失（房间状态存在内存里，见设计取舍 S2）。
重新建房即可。

**Q：对手掉线了还能继续吗**
掉线方 30 分钟内可以刷新页面重连（凭 token 恢复身份），房间会保留。
双方都断线且超过 30 分钟，房间被回收。

**Q：为什么没有观战 / 聊天室列表 / 排行榜**
当前版本刻意不做（S5），只保留一对一房间 + 房间内聊天。

**Q：免费实例休眠后，正在下的棋怎么办**
休眠只在「无任何请求」时触发。对局中每 25 秒有心跳，不会休眠。
如果确实断开了，刷新页面会自动重连回原对局。

**Q：能同时开很多房间吗**
可以。房间是内存里的对象，几百个房间对内存的压力可以忽略。
单个房间固定 2 人，第 3 个人会收到「房间已满」。

---

## 七、运维小抄

```bash
# 健康检查
curl https://你的域名/api/health
# → {"ok":true,"rooms":3,"uptime":123.4}

# 在线统计
curl https://你的域名/api/stats
# → {"rooms":3,"players":5}
```

服务端收到 `SIGTERM` / `SIGINT` 会先关闭所有连接再退出，
云平台滚动重启时不会把对局用户晾在那里。
