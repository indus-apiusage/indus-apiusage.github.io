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

也支持用户名密码登录：

```bash
export FOROPENCODE_USERNAME='your-username'
export FOROPENCODE_PASSWORD='your-password'
```

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

## 可用环境变量

- `FOROPENCODE_BASE_URL`
  默认是 `https://www.foropencode.com`
- `FOROPENCODE_SCOPE`
  可选 `self` 或 `admin`
- `FOROPENCODE_COOKIE`
- `FOROPENCODE_USER_ID`
- `FOROPENCODE_USERNAME`
- `FOROPENCODE_PASSWORD`
- `FOROPENCODE_TURNSTILE_TOKEN`
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
