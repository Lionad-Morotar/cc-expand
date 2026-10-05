# 外部集成（External Integrations）

**分析日期：** 2026-10-06

## 外部服务总览

```text
                    ┌──────────────────────────────┐
                    │        cc-expand CLI          │
                    │  （npm 包，用户机器本地运行） │
                    └───────┬──────────────┬───────┘
                            │              │
             公共读 fetch    │              │  execFile npm
                            ▼              ▼
             ┌────────────────────┐  ┌──────────────────────┐
             │  阿里云 OSS（只读）│  │  npm registry        │
             │  patterns/ 分片    │  │  （用户配置的源）    │
             │  plugins/ 分片     │  │  @anthropic-ai/      │
             └────────▲───────────┘  │  claude-code 包下载  │
                      │              │  cc-expand 自更新    │
        ali-oss 写入  │              └──────────────────────┘
             ┌────────┴───────────┐
             │  阿里云 OSS（写）  │←─ 仅维护侧脚本（.env 凭据）
             │  bucket: cc-expand │
             └────────────────────┘
```

## API 与外部服务

**阿里云 OSS（核心分发通道）：**
- 用途：token pattern 分片与插件 shard 的托管；新 CC 版本支持靠 OSS 下发，通常无需发新 npm 包
- Bucket / Region：`cc-expand` / `oss-cn-shanghai`（`scripts/oss-upload.ts:71-77`）
- 公共读端点（CLI 运行时，无需凭据）：
  - token pattern：`https://cc-expand.oss-cn-shanghai.aliyuncs.com/patterns/`（`src/services/pattern.ts:36`，`PatternService` 默认 `baseUrl`）
  - 插件 shard：`https://cc-expand.oss-cn-shanghai.aliyuncs.com/plugins/silence-unrecognized-model/`（仓根 `ccx-plugins.json`）
  - internal 插件 `token-expansion` 复用 `patterns/` 前缀（`src/internal-plugins.ts:16`）
- 客户端形态：
  - 读：全局 `fetch` + `If-None-Match` ETag 条件请求，本地缓存于 `~/.cc-expand/cache/patterns/`（`src/services/pattern.ts:35,106,148`）；插件 shard 经同一服务类注入 `baseUrl` 复用（`src/services/plugin-patches.ts:59`）
  - 写（仅维护侧）：`ali-oss` SDK，凭据来自环境变量（见下「凭据」）

**npm registry（包获取与版本源）：**
- Claude Code 包下载：`npm pack @anthropic-ai/claude-code` → 读 `optionalDependencies` → `npm pack` 平台包 `@anthropic-ai/claude-code-{platform}-{arch}` → `tar` 解压提取二进制（`src/services/package.ts` 头注释与实现；`scripts/platform-artifacts.ts` 的 `downloadAndExtract`）
- 走用户本机 `npm`（`execFile`，Windows 用 `npm.cmd` + `shell: true`，`src/services/package.ts` 的 `getNpmCommand` / `getNpmExecOptions`），因此自动尊重用户配置的镜像源——self-update 的检查与安装必须同源，避免镜像同步窗口误报（`src/services/latest-checker.ts` 头注释）
- CLI 版本检查：`npm view <pkg>@<dist-tag> version --json`，4 秒超时即 kill；查询对象为 `cc-expand` 自身（self-update，按 latest/alpha 通道查对应 dist-tag，`src/services/update-check.ts:53-70`）与 `@anthropic-ai/claude-code`（supports/status）；检查结果带 TTL 缓存（`src/services/update-check.ts`）
- 维护侧版本检查：显式 `--registry https://registry.npmjs.org` 直查官方源，绕过 npmmirror 缓存延迟（`scripts/latest-check.ts:15-19`）
- 发布：`pnpm publish --config.registry=https://registry.npmjs.org --no-git-checks`（根 `package.json` 的 `release` 脚本）

**GitHub：**
- 第三方插件索引：`ccx plugins add <owner/repo>` → `fetch https://raw.githubusercontent.com/<repo>/main/ccx-plugins.json`（`src/cli/commands/plugins.ts:61-69`）；返回内容不可信，经 `validateManifest` 运行时校验（kebab-case name、http(s) `shardBaseUrl`、`shortVer` 结构）后才持久化到 `~/.cc-expand/plugins.json`（`src/cli/commands/plugins.ts:71-85`）
- 注意：`plugins.ts:8` 头注释标注 `add` 命令处于演进中（confirm / `--plugin` 过滤等），`fetchPluginsIndex` 函数本体已实现
- 官网托管：GitHub Pages（`packages/website/nuxt.config.ts` 的 Nitro preset `github-pages`，预渲染 `/`）；仓库无 `.github/workflows`，无 CI 流水线，部署为本地构建后手动发布
- README 图片外链：`mgear-image.oss-cn-shanghai.aliyuncs.com`（`README.md:26-26`，仅文档引用）

**Claude Code 本体（patch 目标，非服务调用）：**
- npm 分发的 wrapper 包 + 平台二进制包（见上）
- silence 插件 shard 生成时做 runtime 探活：在本机启动 patch 后的 CC 副本并真实发起一次 API 往返，验证 stderr 告警消失（`scripts/plugin-silence-gen.ts`，探针模型 `PROBE_MODEL = 'glm-5.3'`，超时 120 秒；探活失败为 fail loud，人工兜底见 `.claude/skills/watch-patch/references/patch-steps.md`）

## 数据存储

**数据库：** 无（纯本地文件 + 对象存储）

**文件存储：**
- 阿里云 OSS `cc-expand` bucket——pattern 分片（`patterns/` 前缀）与插件 shard（`plugins/<name>/` 前缀）的唯一分发面
- 本地产物：`~/.cc-expand/packages/`（下载的 CC 包）、`~/.cc-expand/bin/`（patch 后二进制）、`~/.cc-expand/plugins.json`（已装插件）

**缓存：**
- `~/.cc-expand/cache/patterns/` — pattern JSON + `.etag` 文件（`src/services/pattern.ts`）
- `.watch-patterns.cache.json`（仓根，gitignored）— 上传去重缓存：文件路径 → 内容 hash，跨重启复用，`watch-patterns.ts` 与 `oss-upload.ts` 共享（`scripts/pattern-uploader.ts`）
- update-check 状态缓存（`src/services/update-check.ts` 的 `cachePath`）

## 认证与身份

**认证提供方：** 无用户认证体系。CLI 无账号、无登录；OSS 读路径为公共读，无需凭据。

## 监控与可观测性

**错误追踪：** 无第三方服务。错误处理为本地结构化 `CcxError` + `ErrorCode`（`src/types/index.ts`，`src/cli/result.ts` 决定退出码）。

**日志：** `console` 直出；维护脚本用 `[UPLOAD]/[SKIP]/[FAIL]` 等前缀输出结构化行（`scripts/oss-upload.ts:98-104`）。

**遥测：** 无。CLI 唯一「外呼」是隐式更新检查（`src/cli/update-check-runner.ts`，与命令并行启动、失败静默、带缓存节流）。

## CI/CD 与部署

**托管：**
- npm 包：npm 官方 registry（`pnpm release` 手动发布）
- 官网：GitHub Pages（`packages/website/nuxt.config.ts`，`NUXT_APP_BASE_URL` 控制 baseURL）

**CI 流水线：** 无（仓库无 `.github/` 目录）。测试与发布全部本地手动执行。

## 环境配置

**环境变量（维护侧脚本必需；CLI 运行时仅一个可选覆盖项）：**
- `CC_EXPAND_NODE` — 可选，仅 CLI 运行时：node 版本守卫（`src/cli/guard-banner.js`）在当前 node 不支持 `require(esm)` 时按此路径优先探测可用 node 并重执行自身；未设置则自动尝试 fnm/volta/Homebrew 等默认安装位（macOS/Linux 路径），全部失败则报错退出
- `AccessKeyID` / `AccessKeySecret` — 阿里云 OSS 写凭据；从根目录 `.env` 加载（`scripts/oss-upload.ts:24-43`、`scripts/watch-patterns.ts`、`scripts/oss-verify.ts` 各自内联 `loadEnv()`，手写解析 `KEY=VALUE`，无 dotenv 依赖）；缺失时 fail loud（`process.exit(1)`）
- `NUXT_APP_BASE_URL` — 官网构建 baseURL（`packages/website/nuxt.config.ts:4`，默认 `/`）
- `XDG_CONFIG_HOME` — 可选，用户配置目录定位（`src/services/user-config.ts:31-43`；默认 `~/.config/cc-expand/config.json`，Windows 走 `appData`）

**密钥位置：**
- `.env`（仓根，84 字节，已被 `.gitignore` 排除）——OSS AccessKey 对；内容不读取、不入库
- `.npmrc`（仓根，53 字节）——npm 发布凭证类配置；存在性确认，内容未读取

## Webhooks 与回调

**入站：** 无（纯 CLI，无常驻服务）

**出站：** 无 webhook；对外交互仅上述 fetch / npm 子进程 / ali-oss 三类

*集成审计：2026-10-06*
