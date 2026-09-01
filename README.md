# indus-apiusage

ForOpenCode Usage Dashboard

这个项目会做三件事：

1. 抓取 `https://www.foropencode.com/usage-logs/common` 背后的日志接口。
2. 按 `token_name` 也就是 API Key 名称聚合每天的调用量和消耗。
3. 把结果输出成 `docs/data/latest.json`，再用 GitHub Pages 直接展示成可视化页面。

## 项目结构

- `scripts/sync-usage-data.mjs`: 主同步入口。
- `scripts/sync-and-push.sh`: 同步后按需提交并推送到 GitHub。
- `src/lib/for-api-client.mjs`: 认证、分页抓取、接口请求。
- `src/lib/aggregate.mjs`: 日级聚合、成员映射、额度换算。
- `work/usage-log-cache.json`: 本地原始日志缓存，常规同步只刷新最近日期以提升速度。
- `config/people.example.json`: 成员映射配置示例。
- `config/people.repo.json`: 可提交到仓库、供 GitHub Actions 使用的成员映射。
- `docs/`: GitHub Pages 静态站点。
- `.github/workflows/`: 自动同步数据和自动部署 Pages 的工作流。

## 已确认的接口

前端真实使用的普通日志接口如下：

- 用户自己的普通日志列表：`/api/log/self`
- 管理员普通日志列表：`/api/log`
- 用户自己的统计卡片：`/api/log/self/stat`
- 管理员统计卡片：`/api/log/stat`

其中普通日志页支持这些核心参数：

- `p`
- `page_size`
- `type`
- `model_name`
- `token_name`
- `group`
- `request_id`
- `upstream_request_id`
- `start_timestamp`
- `end_timestamp`

本项目默认只抓消费类日志，也就是 `type=2`。

## 本地使用

### 1. 安装依赖

```bash
npm install
```

### 2. 配置成员映射

复制一份示例配置：

```bash
cp config/people.example.json config/people.json
```

如果你希望远端 GitHub Actions 也保留成员映射，可以直接维护仓库里的 `config/people.repo.json`。

配置读取优先级如下：

1. `config/people.json`
2. `config/people.repo.json`
3. 空配置

`config/people.json` 里可以把多个 token 名称归到同一个人名下面：

```json
{
  "timezone": "Asia/Shanghai",
  "lookbackDays": 30,
  "refreshDays": 2,
  "people": [
    {
      "displayName": "Alice",
      "tokenNames": ["alice-key"]
    }
  ]
}
```

如果某个 token 没有出现在配置里，页面会直接显示 token 原名，并在 dashboard 里给出提醒。

### 3. 提供认证

推荐直接用 Cookie，最稳：

```bash
export FOROPENCODE_COOKIE='session=...; other_cookie=...'
export FOROPENCODE_USER_ID='1143'
```

这里的 `FOROPENCODE_USER_ID` 很重要。ForOpenCode 的前端除了 Cookie 之外，还会额外带一个 `New-Api-User` 请求头。
这个值通常等于浏览器里的：

- 请求头里的 `new-api-user`
- 或 `localStorage.uid`

如果你只有裸 `session=...`，没有这个值，接口通常会返回：

```text
Unauthorized, New-Api-User header not provided
```

如果浏览器请求中还包含 `Authorization: Bearer ...`，也需要配置它。推荐把完整请求头放在本地 `work/sync.env` 或 GitHub Actions Secret `FOROPENCODE_AUTHORIZATION` 中，不要写入仓库：

```bash
export FOROPENCODE_AUTHORIZATION='Bearer ...'
export FOROPENCODE_USER_ID='1479'
```

也可以只配置 JWT 字符串，脚本会自动补上 `Bearer ` 前缀：

```bash
export FOROPENCODE_ACCESS_TOKEN='...'
```

Bearer 令牌通常有过期时间。过期后需要从浏览器重新获取最新令牌并更新本地配置和 GitHub Secret；Cookie、Bearer 和 `New-Api-User` 应来自同一次登录会话。

如果需要同步多个账号，可以继续使用兼容旧配置的第二账号变量：

```bash
export FOROPENCODE_ACCOUNT_2_LABEL='备用账号'
export FOROPENCODE_ACCOUNT_2_COOKIE='session=...'
export FOROPENCODE_ACCOUNT_2_AUTHORIZATION='Bearer ...'
export FOROPENCODE_ACCOUNT_2_USER_ID='1143'
```

也可以把多个账号整体放到 GitHub Secret `FOROPENCODE_ACCOUNTS_JSON` 中。这个 Secret 的结构如下，真实凭据不要写进仓库：

```json
[
  {
    "id": "account-1",
    "label": "主账号",
    "auth": {
      "cookie": "session=...",
      "authorization": "Bearer ...",
      "userId": "1479"
    }
  },
  {
    "id": "account-2",
    "label": "备用账号",
    "auth": {
      "cookie": "session=...",
      "authorization": "Bearer ...",
      "userId": "1143"
    }
  }
]
```

`FOROPENCODE_ACCOUNTS_JSON` 优先级高于单账号变量。同步器会为每个账号维护独立的 `work/usage-log-cache.json` 分区，首次加入新账号时回填一次历史区间，之后只刷新最近日期并行完成。

也支持用户名密码登录：

```bash
export FOROPENCODE_USERNAME='your-username'
export FOROPENCODE_PASSWORD='your-password'
```

为避免 New API 的 `AUTH_SESSION_LIMIT`，密码登录采用“明确连接一次、后续只刷新”的模式。首次建立会话时，需显式允许这一次密码登录：

```bash
FOROPENCODE_ALLOW_PASSWORD_LOGIN=1 npm run sync:publish
```

不要把 `FOROPENCODE_ALLOW_PASSWORD_LOGIN=1` 写入 `work/sync.env` 或后台循环的环境中。首次成功登录后，ForOpenCode 会签发短期访问令牌与仅用于续期的 `HttpOnly` 刷新 Cookie；同步器会将两者保存在权限为 `600` 的本机 `work/auth-session-cache.json`，并按账号 ID、站点地址隔离。访问令牌临近过期时，同步器调用 `/api/user/auth/refresh` 续期，不会再次提交账号密码，也不会额外创建服务端登录会话。多个同步进程共享本地锁，避免并发使用同一个轮换刷新 Cookie。

如果需要让密码登录优先于已保存的浏览器 Cookie，可以配置：

```bash
export FOROPENCODE_PREFER_PASSWORD_LOGIN='true'
```

默认情况下，本机没有可续期刷新 Cookie 的旧缓存仍会要求一次人工连接。若已明确设置 `FOROPENCODE_ALLOW_PASSWORD_RECOVERY=true`，同步器会先按网站前端的刷新协议处理 `AUTH_REFRESH_RACE` 和 `AUTH_SESSION_MISMATCH`，避免把可恢复的 Cookie 轮换误判为登录失效。只有服务端明确拒绝已保存的刷新会话时，系统才会自动补建密码会话；恢复由跨进程锁串行化，并从 15 分钟开始指数退避、最长 6 小时，冷却结束后会自行重试，不需要重复点击“重新连接”。网站返回 `AUTH_SESSION_LIMIT` 时始终停止自动尝试，避免后续周期反复创建服务端会话。

macOS App 会为使用账号密码的账号启用上述受限恢复策略。点击“重新连接”时，App 会安全暂停自身管理的循环，等待其完全退出后只重连所选账号；成功后按原自动同步开关恢复，失败或 `AUTH_SESSION_LIMIT` 时则保持同步关闭。请先在网站端结束不需要的登录会话，再重试该操作。

这个会话缓存只适合本机或受信任的私有运行环境。不要把 `work/auth-session-cache.json` 上传到公开仓库，也不要把它放进公开 GitHub Actions 缓存。

本地循环会把 `docs/data/latest.json` 与 `docs/data/widget.json` 作为唯一的自动发布文件。即使你同时在编辑 Swift、网页源码或其他文件，循环也不会再因为工作区不干净而跳过；它不会 stash、覆盖或提交这些本地改动。发布时会从远端最新提交构造只包含两份 dashboard 数据的提交，因此远端在同步期间产生新提交也可以在下一次尝试中重新合并。同步失败只记录本次失败，后续周期会继续重试。

同步生成的数据仍会写入本地 `docs/data/`，方便 macOS App 立即读取；由于自动提交使用临时 Git index，主工作区可能显示这两份数据为未提交状态，这是预期行为，不会阻止下一次同步。若需要手动整理本地分支，请先确认没有正在运行的同步周期。

如果站点启用了 Turnstile，还可以额外传：

```bash
export FOROPENCODE_TURNSTILE_TOKEN='...'
```

### 4. 运行同步

```bash
npm run sync
```

同步优先复用已有 `docs/data/latest.json` 中的历史日聚合，并把新抓取的原始日志保存在 `work/usage-log-cache.json`。因此常规运行默认只重新抓取今天和昨天；当本地没有历史 dashboard 数据时，才会补齐完整回看区间。如需强制全量重建，可运行：

```bash
npm run sync -- --refresh-all
```

如果你希望抓取完成后自动提交并推送当前变更：

```bash
npm run sync:publish
```

同步结果会写到：

- `docs/data/latest.json`

如果你只想先生成一个空的占位数据，让 GitHub Pages 页面先跑起来：

```bash
npm run sync:placeholder
```

### 5. 运行测试

```bash
npm test
```

## macOS 控制台 App

仓库包含一个原生 SwiftUI 控制台 `Indus Usage Console`，用于替代终端管理本地同步。它支持：

- 添加、编辑、启用或暂停多个 ForOpenCode 账号。
- 使用 macOS Keychain 保存 Bearer Token、Cookie、用户名和密码。
- 一键启动或暂停五分钟同步循环，或者立即执行一次同步并推送。
- 查看账号余额、凭据状态、同步 PID 和最近运行日志。
- 选择项目目录、网络代理和 Git SSH 私钥路径。

在 macOS 上构建并打开：

```bash
chmod +x scripts/build-macos-app.sh
bash scripts/build-macos-app.sh --open
```

生成的 App 位于 `dist/Indus Usage Console.app`。首次使用时，在“控制设置”确认项目目录，再进入“账号矩阵”添加账号。App 只把非敏感账号元数据写入 Application Support，敏感凭据写入 Keychain；同步时通过 `SYNC_ENV_FILE` 生成权限为 `600` 的本地运行环境，并复用现有 Bash/Node 同步链路。

App 默认优先使用账号密码登录，但不会每个同步周期重新登录。它会复用本地认证会话缓存，并通过服务端刷新 Cookie 轮换短期令牌；只有服务端明确撤销一个已保存的刷新会话时，App 才会在本机锁和冷却保护下自动补建一次会话。遇到 `AUTH_SESSION_LIMIT` 时它会立即隔离该账号并停止自动登录。

如果希望让 Xcode 自动管理 WidgetKit 的签名，可以打开 `macos/IndusUsageConsole/IndusUsageConsole.xcodeproj`，分别选择 `IndusUsageConsole` 和 `IndusUsageWidget` Target，在 `Signing & Capabilities` 中勾选 `Automatically manage signing` 并选择 Team。之后可以运行：

```bash
bash scripts/build-macos-xcode.sh
APP_SOURCE="$PWD/dist/xcode-derived/Build/Products/Debug/Indus Usage Console.app" \
  bash scripts/install-macos-app.sh
bash scripts/check-macos-widget.sh
```

这个路径不需要手动填写 provisioning profile；需要 Xcode 账号拥有可用 Team 和 Apple Development 身份。当前免费兼容模式不依赖 App Group：Widget 从 GitHub Pages 的公开聚合文件读取数据。

App 需要 macOS 13 或更高版本。当前项目没有把生成的 `.app`、Swift 构建缓存或运行时凭据提交到 Git。

### macOS 系统级桌面小组件

这不是 App 内打开的浮动窗口，而是真正的 WidgetKit 扩展。构建脚本会把扩展嵌入 `Contents/PlugIns/IndusUsageWidget.appex`，小组件提供小号、中号和大号三种尺寸，展示本月累计、今日用量、余额、`gpt_plus` 倍率和账号轨道。同步脚本会生成 `docs/data/widget.json` 并随网页数据一起推送，Widget 从 GitHub Pages 读取这个只含汇总数字的文件；文件不包含 Cookie、Token、密码或 API Key。主 App 仍会把本机快照写到 Application Support，供本地调试和网络失败时使用。

在本机安装并注册：

```bash
bash scripts/build-macos-app.sh
bash scripts/install-macos-app.sh
bash scripts/check-macos-widget.sh
```

然后在 macOS 桌面右键选择“编辑小组件”，搜索“Indus API 用量”并添加到桌面。小组件点击后会回到 App 的总览页面。

注意：系统小组件不是普通网页或 App 浮窗，macOS 通常要求主 App 和 `.appex` 使用 Apple Development 或 Developer ID 签名。未提供签名身份时，构建脚本仍会生成 ad-hoc 本地测试包，但 `PlugInKit` 可能不会将它加入系统小组件列表。正式签名构建示例：

```bash
CODESIGN_IDENTITY="Apple Development: 你的 Apple ID (TEAMID)" \
APP_PROVISIONING_PROFILE="$HOME/Library/MobileDevice/Provisioning Profiles/你的主 App.mobileprovision" \
WIDGET_PROVISIONING_PROFILE="$HOME/Library/MobileDevice/Provisioning Profiles/你的 Widget.mobileprovision" \
  bash scripts/build-macos-app.sh
```

如果 `bash scripts/check-macos-widget.sh` 显示 `No registered extension`，先在 Xcode 登录 Apple ID，在主 App 和 Widget Target 中选择同一个 Team，打开 Automatically manage signing，再重新构建和安装。Personal Team 不需要配置 App Groups；本机验证表明当前无 App Group 版本可以由 Personal Team 签署并注册。

## 可用环境变量

- `FOROPENCODE_BASE_URL`
  默认是 `https://www.foropencode.com`
- `FOROPENCODE_SCOPE`
  可选 `self` 或 `admin`
- `FOROPENCODE_COOKIE`
- `FOROPENCODE_AUTHORIZATION`
- `FOROPENCODE_ACCESS_TOKEN`
- `FOROPENCODE_ACCOUNTS_JSON`
- `FOROPENCODE_USER_ID`
- `FOROPENCODE_ACCOUNT_2_COOKIE`
- `FOROPENCODE_ACCOUNT_2_AUTHORIZATION`
- `FOROPENCODE_ACCOUNT_2_USER_ID`
- `FOROPENCODE_USERNAME`
- `FOROPENCODE_PASSWORD`
- `FOROPENCODE_PREFER_PASSWORD_LOGIN`
- `FOROPENCODE_ALLOW_PASSWORD_LOGIN`
  仅用于一次人工建立密码会话。不要写入后台自动同步环境；macOS App 的“重新连接”按钮会按账号自动、安全地传递该权限。
- `FOROPENCODE_ALLOW_PASSWORD_RECOVERY`
  可选。仅允许在一个已保存的刷新会话被服务端明确拒绝后自动补建密码会话；不会用于首次登录或缺少刷新 Cookie 的旧缓存。恢复从 15 分钟开始指数退避、最长 6 小时，并会在冷却结束后自动重试。
- `FOROPENCODE_TURNSTILE_TOKEN`
- `AUTH_SESSION_CACHE_FILE`
  默认是 `work/auth-session-cache.json`，只应指向本地、权限为 `600` 的忽略文件。
- `USAGE_TIMEZONE`
- `USAGE_LOOKBACK_DAYS`
- `USAGE_REFRESH_DAYS`
  默认 `2`，每次同步重新抓取最近几天；其余日期从本地缓存复用。
- `USAGE_CACHE_FILE`
  默认是 `work/usage-log-cache.json`。
- `USAGE_START_DATE`
  格式 `YYYY-MM-DD`
- `USAGE_END_DATE`
  格式 `YYYY-MM-DD`
- `OUTPUT_FILE`
  默认是 `docs/data/latest.json`

## GitHub Pages 部署

仓库已经带了两个工作流：

- `Sync Usage Data`
  每 5 分钟自动拉一次最新数据，更新 `docs/data/latest.json`，并在有变化时自动提交回仓库
- `Deploy GitHub Pages`
  当 `docs/` 有变更时自动发布 Pages

### 需要在 GitHub 仓库里配置的内容

在仓库 `Settings -> Secrets and variables -> Actions` 里至少配置下面之一：

- `FOROPENCODE_COOKIE`
- `FOROPENCODE_AUTHORIZATION`
- `FOROPENCODE_ACCOUNTS_JSON`
- `FOROPENCODE_USER_ID`

或者：

- `FOROPENCODE_USERNAME`
- `FOROPENCODE_PASSWORD`

如果你还想自定义范围和时区，也可以配 Variables：

- `FOROPENCODE_USER_ID`
- `FOROPENCODE_SCOPE`
- `USAGE_TIMEZONE`
- `USAGE_LOOKBACK_DAYS`

## 发布到 GitHub

如果你的目标仓库是 `indus-apiusage/indus-apiusage`，推荐把整个项目一起提交，而不是只提交 `README.md`。

推上去之后，还需要在 GitHub 仓库里完成两项设置：

1. `Settings -> Secrets and variables -> Actions`
   配置 `FOROPENCODE_COOKIE` 与 `FOROPENCODE_USER_ID`
2. `Settings -> Pages`
   Source 选择 `GitHub Actions`

## 定时说明

现在仓库里的 `Sync Usage Data` workflow 已经改成：

- 每 5 分钟运行一次
- 自动执行爬虫
- 如果 `docs/data/latest.json` 有变化，就自动 commit 并 push

需要注意的是，GitHub Actions 的 cron 是尽力调度，不保证精确到秒；高峰期偶尔会比 5 分钟稍晚一点触发。

## 注意事项

- 如果仓库是公开的，不建议把原始日志明细公开出去。现在页面默认只发布聚合后的数据。
- `config/people.json` 已经加入 `.gitignore`，适合你在本地或私有仓库里维护真实成员映射。
- `docs/data/latest.json` 会包含 token 名称。如果 token 名称本身敏感，建议在 `config/people.json` 里统一改成更适合展示的成员名，并避免把敏感 token 名写进系统里。
