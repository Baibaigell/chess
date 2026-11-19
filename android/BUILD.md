# chess-app 安卓封装：构建说明

本目录是把 `chess-app` 打包成 Android 应用（.apk）的工程。
前端已预先构建并放入 `app/src/main/assets/`，**不需要再跑 `pnpm build`**。

> 重要：生成本工程的这台机器**没有 JDK 与 Android SDK**，因此我无法在这里编译出 .apk。
> 编译必须在装有 Android 构建环境的机器上进行。下面是从零到装上手机的完整步骤。

---

## 零、先理解三个关键点

1. **用的是 WebViewAssetLoader，不是 file://**
   页面挂在 `https://appassets.androidplatform.net/assets/index.html` 这个本地虚拟域名下。
   该域名不经过真实网络，但拥有 https 的全部能力，于是：
   - Stockfish 的 Web Worker 能正常加载（`file://` 下会被浏览器禁止）
   - `localStorage` 可用
   这是本工程能跑起来的前提，不要改回 `file://`。

2. **应用不需要 INTERNET 权限**
   所有资源都在 assets 内，虚拟域名不联网。清单文件里没有申请网络权限。

3. **安装到手机用 debug 包即可**
   自签名 debug 包可以直接装，无需应用商店账号。

---

## 一、准备环境（一次性）

| 组件 | 版本 | 说明 |
|---|---|---|
| JDK | **17** | Gradle 8.2 要求 JDK 17。低于 17 会报 unsupported class file |
| Android SDK | API 34 | 需含 Build-Tools 与 Platform-Tools |
| Gradle | 8.5 | 用 wrapper 自动下载，或自己装 |

### 1. 装 JDK 17

推荐 Eclipse Temurin：<https://adoptium.net/temurin/releases/?version=17>

安装后设置环境变量（Windows）：

```bat
setx JAVA_HOME "C:\Program Files\Eclipse Adoptium\jdk-17.0.x-hotspot"
```

验证：

```bat
"%JAVA_HOME%\bin\java" -version
```
应输出 `openjdk version "17.x"`。

### 2. 装 Android SDK

**最省事的方式**：装 [Android Studio](https://developer.android.com/studio)，
它自带 SDK Manager，首次启动会引导你下载 SDK。

装完在 Android Studio 里：
`Tools → SDK Manager → SDK Platforms` 勾选 **Android 14.0 (API 34)**，
`SDK Tools` 勾选 **Android SDK Build-Tools** 与 **Android SDK Platform-Tools**。

### 3. 配置 SDK 路径

打开本目录下的 `local.properties`，把 `sdk.dir` 改成你机器上的实际路径：

```properties
sdk.dir=C\:\\Users\\你的用户名\\AppData\\Local\\Android\\Sdk
```

注意路径里的冒号和反斜杠都要转义（`\:` 和 `\\`）。

---

## 二、生成 Gradle Wrapper（首次必做）

本工程**没有附带 `gradle-wrapper.jar`**（二进制文件，抓取不到且应由 Gradle 自己生成）。
两种方式任选：

### 方式 A：如果已装 Gradle（推荐）

在本目录（`android/`）执行：

```bat
gradle wrapper --gradle-version 8.5
```

生成 `gradle/wrapper/gradle-wrapper.jar` 与 `gradlew`。之后就能用 `gradlew.bat`。

### 方式 B：不装 Gradle，直接用已装的 gradle 构建

跳过 wrapper，直接：

```bat
gradle assembleDebug
```

---

## 三、编译出 .apk

在 `android/` 目录执行：

```bat
gradlew.bat assembleDebug
```

产物路径：

```
android\app\build\outputs\apk\debug\app-debug.apk
```

首次构建要下载 Gradle 与 Android 依赖，约 5–15 分钟。
国内网络慢的话，可以在 `settings.gradle` 的仓库列表里加阿里云镜像：

```gradle
maven { url 'https://maven.aliyun.com/repository/google' }
maven { url 'https://maven.aliyun.com/repository/public' }
```

---

## 四、装到手机

### 方式 1：数据线 + adb（最快）

```bat
"%ANDROID_HOME%\platform-tools\adb.exe" install -r android\app\build\outputs\apk\debug\app-debug.apk
```

### 方式 2：直接拷贝

把 `app-debug.apk` 传到手机，用文件管理器点开安装。
手机会提示「未知来源应用」，允许即可（Android 8+ 需在设置里为本文件管理器单独授权）。

---

## 五、前端改动后如何重新同步

前端代码改了之后，重新构建并把产物拷进 assets：

```bat
cd /d "D:\DeepSeek Harness Work\chess-app"

:: 1) 打包前端（本机可用 esbuild 静态打包）
node_modules\@esbuild\win32-x64\esbuild.exe src\main.tsx ^
  --bundle --format=esm --platform=browser --jsx=automatic ^
  --loader:.css=css --outfile=dist\assets\app.js ^
  --external:/pieces/* --external:/engines/* ^
  --define:process.env.NODE_ENV=\"production\" --minify

:: 2) 复制静态资源
xcopy /E /I /Y public\pieces dist\pieces
xcopy /E /I /Y public\engines dist\engines

:: 3) CSS 里的绝对路径要改成相对（否则 appassets 域名下 404）
::    把 url(/pieces/  替换为  url(../pieces/

:: 4) 同步进 Android assets
rmdir /S /Q android\app\src\main\assets
xcopy /E /I /Y dist android\app\src\main\assets
```

`dist/index.html` 也必须存在且引用 `./assets/app.js`、`./assets/app.css`（相对路径）。

---

## 六、常见问题

| 现象 | 原因与处理 |
|---|---|
| `JAVA_HOME is not set` | 没装 JDK 17 或环境变量没生效，重开终端 |
| `SDK location not found` | `local.properties` 的 `sdk.dir` 路径不对 |
| 装上了但白屏 | 用 `chrome://inspect` 连上真机看 Console。多半是 assets 里的 `index.html` 路径不对 |
| 棋盘能下但电脑不走棋 | Stockfish 的 Worker 没加载。确认没有改回 `file://`，且 `assets/engines/` 存在 |
| 高版本安卓报「应用未安装」 | 手机上有同包名旧版本且签名不同，先卸载旧的 |
| `Unsupported class file major version` | JDK 版本太高或太低，必须 17 |

---

## 七、本工程的文件职责

| 文件 | 作用 |
|---|---|
| `settings.gradle` | 声明仓库与包含的模块 |
| `build.gradle` | 声明 Android Gradle Plugin 版本 |
| `gradle.properties` | JVM 堆大小、AndroidX 开关 |
| `gradle/wrapper/gradle-wrapper.properties` | Gradle 8.5 发行包地址 |
| `app/build.gradle` | 模块配置：包名、SDK 版本、依赖 |
| `app/src/main/AndroidManifest.xml` | 应用清单：入口 Activity、图标、主题 |
| `app/src/main/java/com/chessapp/MainActivity.java` | **核心**：WebView 容器 + WebViewAssetLoader |
| `app/src/main/res/values/*.xml` | 应用名字符串、主题、颜色 |
| `app/src/main/res/mipmap-*/ic_launcher.png` | 5 个尺寸的启动图标 |
| `app/src/main/assets/` | 打包好的前端（index.html / assets / pieces / engines） |

---

## 八、包名与版本

当前配置：

- 包名 `com.chessapp`
- 应用名 `chess-app`
- `minSdk 24`（Android 7.0+，覆盖约 98% 设备）
- `targetSdk 34`（Android 14）
- 版本 `1.0`（versionCode 1）

改包名需要同时改三处：`app/build.gradle` 的 `namespace` 与 `applicationId`、
以及 `MainActivity.java` 的 `package` 声明和它所在的目录层级。

改版本改 `app/build.gradle` 的 `versionCode` / `versionName`。
