# 技术栈（Technology Stack）

**分析日期：** 2026-10-06

## 语言

**主语言：**
- TypeScript ^5.5（strict 模式，`target: ES2022`，`module: NodeNext`）— CLI 内核（`src/`）、维护脚本（`scripts/*.ts`）、子包（`packages/plugin-context-expand/src/`）

**次语言：**
- Python — 单个辅助脚本 `scripts/analyze-banner.py`
- Vue 3（Nuxt SFC）— 官网页面与组件（`packages/website/app/`）

## 运行时

**环境：**
- Node.js >= 18.0.0（`package.json` 的 `engines` 字段；类型基准 `@types/node ^22`）
- CLI 实际运行底线为支持 `require(esm)` 的 node（v22+，或 v20.19+ backport）：`src/cli/guard-banner.js` 以 banner 形态注入 `dist/cli.js` 首部，先于一切第三方 require 检测老 node（如被 `.node-version` / fnm use-on-cd 劫持的环境），命中时按 `CC_EXPAND_NODE` → fnm/volta/Homebrew 默认安装位顺序找可用 node 重执行自身，找不到则以可操作提示退出
- 运行时无原生依赖，产物为纯 JS bundle

**包管理器：**
- pnpm（lockfile 为 `pnpm-lock.yaml`，`lockfileVersion: '9.0'`；根 `package.json` 未声明 `packageManager` 字段）
- `pnpm-workspace.yaml`：workspace 为 `packages/*`；`allowBuilds` 仅放行 `@parcel/watcher`（esbuild 显式 `false`）
- 存在 `.npmrc`（53 字节，内容未读取——发布 registry/凭证类配置）

## Monorepo 布局

| 包 | 名称 | 版本 | 发布 | 说明 |
|---|---|---|---|---|
| 根包 | `cc-expand` | 0.5.2 | npm 公开发布 | CLI 主体；`bin`：`cc-expand` / `ccx` → `dist/cli.js`；`main`/`module`/`types` → `dist/index.*`；`files` 仅 `dist` |
| `packages/plugin-context-expand` | `@cc-expand/plugin-context-expand` | 0.4.0-alpha.2 | private | token 编解码逻辑唯一真相源；ESM；`main`/`exports` 直指 `./src/index.ts`（源码级引用），由根包 tsup 以 `noExternal` 内联打包 |
| `packages/website` | `@cc-expand/website` | - | private | Nuxt 4 官网，产物部署 GitHub Pages |

根包通过 `devDependencies` 以 `workspace:*` 引用子包（`package.json:50`）。

## 框架

**核心（CLI 运行时依赖，`package.json` 的 `dependencies`）：**
- `cac ^7.0.0` — 命令行参数解析与命令路由（入口 `src/cli/index.ts`）
- `@inquirer/prompts ^7.0.0` + `@inquirer/core ^10.0.0` — 交互式确认/选择
- `picocolors ^1.1.1` — 终端着色
- `semver ^7.8.4` — 版本解析与 release 通道判定（`src/utils/release-channel.ts`、`src/services/update-check.ts`）
- `tar ^7.5.16` — 解压 npm 平台包提取 Claude Code 二进制（`src/services/package.ts`）

**测试：**
- `vitest ^2.0.0` — 单测 + 集成测试；`globals: true`、`environment: happy-dom`、`pool: forks`；排除 `tests/website/**` 与 `zRefs/**`（`vitest.config.ts`）
- 集成测试对网络做了 mock（如 `tests/integration/silence-plugin.test.ts` 用 `vi.stubGlobal('fetch', ...)`），不真实外呼

**构建/开发工具（devDependencies）：**
- `tsup ^8.0.0` — 双 bundle 构建（见下「构建流程」）
- `typescript ^5.5.0` — 类型检查
- `tsx` — `pattern:*` / `plugin:*` / `watch:patterns` 系列脚本的解释器。注意：根包未直接声明 tsx；lockfile 中的 `tsx@4.23.1` 是 `postcss-load-config` 的 optional peer（经 `packages/website` 的 Nuxt 链路进入 store），根 `node_modules/.bin` 无 tsx 软链——脚本执行依赖全局安装的 tsx 或相应 hoist 配置
- `ali-oss ^6.23.0`（+ `@types/ali-oss`）— 维护侧 OSS 上传/核验脚本
- `chokidar ^5.0.0` — `patterns/` 目录监听（`scripts/watch-patterns.ts`）
- `playwright ^1.60.0` + `pixelmatch ^7.2.0` + `pngjs ^7.0.0` + `@napi-rs/canvas ^1.0.0` — 官网 banner 视觉回归（`scripts/visual-regression.ts`：本地 HTTP 服务 + 截图 + 像素 diff）

**官网（`packages/website/package.json`）：**
- `nuxt ^4.4.8` — SPA 模式（`ssr: false`），Nitro preset `github-pages`（`packages/website/nuxt.config.ts`）
- `three ^0.184.0` + `postprocessing ^6.39.1` — 3D banner 场景（`packages/website/app/banner/banner-scene.ts`）

## 关键依赖

**关键（缺了跑不起来）：**
- `cac` — 所有 CLI 命令的骨架（`src/cli/index.ts` 集中注册）
- `tar` — `ccx install` 下载 Claude Code 平台包后的解压路径
- `semver` — latest/alpha 通道与 self-update 的版本比较
- `ali-oss` — watch-patch 运维流的上传通道（仅维护侧）

**基础设施形态：**
- 无数据库、无服务端；分发面由「npm 包（CLI 本体）+ 阿里云 OSS（pattern/plugin shard）」组成
- 环境变量加载为脚本内手写 `loadEnv()`（解析 `.env` 的 `KEY=VALUE`），无 `dotenv` 依赖（如 `scripts/oss-upload.ts:24-35`）

## 开发命令（`package.json` scripts）

```bash
pnpm build            # tsup 双 bundle 构建到 dist/
pnpm dev              # tsup --watch
pnpm test             # vitest（watch 模式）
pnpm test:unit        # vitest run tests/cli
pnpm test:e2e         # 先 build 再 vitest run tests/integration
pnpm dev:website      # 官网 nuxt dev
pnpm build:website    # 官网 nuxt generate（GitHub Pages 产物）

# watch-patch 运维流（pattern 分片）
pnpm watch:patterns        # chokidar 监听 patterns/ 自动上传（长驻，不推荐；见下）
pnpm pattern:latest-check  # 对比 npm latest 与本地 versions.json，输出 {latest, processed, needWork}
pnpm pattern:gen <ver>     # 下载→解压→锚点发现→patch 模拟→写 patterns/<ver>.json
pnpm pattern:upload <ver>  # 一次性上传分片 + versions.json 到 OSS
pnpm pattern:verify-oss <ver>  # MD5 核验 OSS 与本地一致
pnpm pattern:verify        # 校验本地 pattern 文件
pnpm pattern:cleanup       # 清理历史版本

# silence 插件 shard 流
pnpm plugin:gen-silence <ver>     # 生成 plugin-shards/silence-unrecognized-model/
pnpm plugin:upload-silence <ver>  # 上传到 OSS plugins/ 前缀
pnpm plugin:verify-silence <ver>  # MD5 核验

# 发布
pnpm release         # pnpm publish --config.registry=https://registry.npmjs.org --no-git-checks
```

## 构建流程

`tsup.config.ts` 定义两个 bundle：

1. **库 bundle**（`src/index.ts` → `dist/index.js` / `index.mjs` / `index.d.ts`）：`cjs` + `esm` 双格式，`dts: true`，sourcemap，`clean: true`
2. **CLI bundle**（`src/cli/index.ts` → `dist/cli.js`）：`cjs` 单格式，banner 注入 shebang + `src/cli/guard-banner.js` 全文（构建时 `readFileSync` 读入，`tsup.config.ts:6-9`——node 版本守卫必须先于 bundle 的一切第三方 require，只能走 banner 不能走 import，见 `src/cli/guard-banner.js` 头注释）；`noExternal: ['@cc-expand/plugin-context-expand']` 将子包运行时代码内联——因子包 `main` 直指 `.ts` 源文件，Node 无法直接执行（见 `tsup.config.ts:33-35` 注释）

**顺序约束：** `prebuild` 钩子先跑 `vitest run --exclude tests/integration`（集成测试需要 dist 产物），再执行 `tsup`。

## 发布流程

- `prerelease`（构建）→ `pnpm run build`；`prepublishOnly` → `tsup`（双保险，保证 `files: ["dist"]` 内容新鲜）
- `release` → `pnpm publish --config.registry=https://registry.npmjs.org --no-git-checks`，直发 npm 官方 registry
- 发布物仅 `dist/`；`patterns/` 与 `plugin-shards/` 均在 `.gitignore` 中——**新 Claude Code 版本的支持通过 OSS 动态下发 pattern，通常无需发新 npm 包**（`README.md`、`.claude/skills/watch-patch/SKILL.md`）
- 官网发布：`pnpm build:website`（`nuxt generate`，Nitro preset `github-pages`，预渲染 `/`）；`baseURL` 由环境变量 `NUXT_APP_BASE_URL` 控制；仓库无 `.github/workflows`，部署为本地构建后手动发布
- 版本策略：patch / prerelease（如子包 `0.4.0-alpha.2`）可自由变动；minor/major 视为显著变动

## watch-patch 运维闭环（pattern 生产链）

固化为 `.claude/skills/watch-patch/SKILL.md` 定义的定时流程（退避轮询 L0=30min → L3=240min）：

1. `pnpm pattern:latest-check` — 判断是否有未处理的新 CC 版本（`scripts/latest-check.ts`，显式 `--registry https://registry.npmjs.org` 绕过镜像缓存）
2. `pnpm pattern:gen <ver>` — 文本锚点发现 + patch 模拟 + bytecode 锚点生成实证（≥2.1.246）；同流程顺带 `pnpm plugin:gen-silence <ver>`（含 runtime 探活，见 INTEGRATIONS.md）
3. `pnpm pattern:upload <ver>` + `pnpm plugin:upload-silence <ver>` — 事件驱动一次性上传（长驻的 `watch:patterns` 会被会话 SIGTERM 杀掉，弃用为上传通道）
4. `pnpm pattern:verify-oss <ver>` + `pnpm plugin:verify-silence <ver>` — MD5 闭环核验

## 配置文件

| 文件 | 用途 |
|---|---|
| `tsconfig.json` | ES2022 / NodeNext / strict；`include` 仅 `src/**/*` |
| `tsup.config.ts` | 双 bundle 定义（见上） |
| `vitest.config.ts` | globals / happy-dom / forks pool / 排除项 |
| `pnpm-workspace.yaml` | workspace 与 `allowBuilds` |
| `ccx-plugins.json`（仓根） | 插件索引样例：`silence-unrecognized-model` 的 `shardBaseUrl` 等元信息 |
| `.npmrc` | 存在（内容未读取，发布相关） |
| `.env` | 存在，已被 `.gitignore` 排除；OSS 写凭据（见 INTEGRATIONS.md），禁止提交 |

## 平台要求

**开发：**
- macOS / Linux / Windows 均可（脚本含 Windows 适配：`npm.cmd` + `shell: true`，`src/services/package.ts` 的 `getNpmCommand` / `getNpmExecOptions`）
- 维护侧脚本需 Node >= 18、pnpm、全局 tsx、OSS 凭据

**产物运行：**
- CLI 支持为 Claude Code patch 产出 macOS / Windows / Linux 二进制（`scripts/platform-artifacts.ts` 的 `PLATFORMS` 五平台矩阵）

*技术栈分析：2026-10-06*
