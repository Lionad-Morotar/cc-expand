<!-- refreshed: 2026-10-02 -->
# 代码库结构（Codebase Structure）

**分析日期：** 2026-10-02

## 目录布局

```text
cc-expand/
├── src/                        # 根包源码（CLI 工具本体，npm 包 cc-expand）
│   ├── cli/                    # CLI 层：cac 入口 + 渲染 + i18n + 14 个子命令
│   │   ├── commands/           # 每个命令一个文件，导出 <name>Command 函数
│   │   ├── index.ts            # CLI 入口（tsup 打包为 dist/cli.js，bin: ccx / cc-expand）
│   │   ├── renderer.ts         # 输出渲染（color/quiet/JSON 信封/locale）
│   │   ├── i18n.ts             # en/zh 翻译键与 t() 函数
│   │   ├── result.ts           # CommandResult 类型 + BSD 退出码映射
│   │   ├── pager.ts            # TTY 分页器（supports --all 降级矩阵）
│   │   ├── version-line.ts     # 版本行格式化（pager/renderer 共用）
│   │   └── update-check-runner.ts  # 隐式更新检查编排（可独立测试）
│   ├── core/                   # 核心引擎：纯 buffer 字节操作，零 token 知识
│   │   ├── patch-engine.ts     # PatchEngine：文本锚点等长替换（latin1）
│   │   ├── bytecode-patch-engine.ts  # BytecodePatchEngine：常量池锚点（唯一性硬约束）
│   │   ├── verifier.ts         # Verifier：patch 后多步验证
│   │   ├── pattern-discovery.ts      # 文本锚点发现（伴生签名 + 结构不变量守卫）
│   │   ├── bytecode-anchor-discovery.ts  # 锚点自动生成四步流水线
│   │   ├── silence-guard-discovery.ts    # silence 插件 guard 骨架锚点发现
│   │   ├── binary-sections.ts  # Mach-O/ELF/PE __bun section 解析
│   │   └── standalone-graph.ts # Bun StandaloneModuleGraph 模块表解析
│   ├── services/               # 服务层：领域编排与 IO（CLI 无关）
│   │   ├── patch-applier.ts    # PatchApplier：prepare/execute 两阶段编排
│   │   ├── plugin-patches.ts   # collectPluginContext：PluginsManager + shard 聚合
│   │   ├── plugins-manager.ts  # PluginsManager：注册表 + shortVer 计算
│   │   ├── pattern.ts          # PatternService：OSS + ETag 缓存（pattern/shard 双角色）
│   │   ├── config.ts           # ConfigService：versions.json + CONFIG_DIR 常量
│   │   ├── package.ts          # PackageService：npm pack 下载平台 binary
│   │   ├── channel-config.ts   # channel.json 读写
│   │   ├── channel.ts          # 渠道探测（PATH/NPX）
│   │   ├── discovery.ts        # DiscoveryService：binary 发现（PATH→NPX→路径表）
│   │   ├── claude-discovery.ts # 跨包管理器安装路径全量表（源自 tweakcc）
│   │   ├── shell-codegen.ts    # shell 快捷方式代码生成
│   │   ├── shell-maintain.ts   # patch 后自动维护 cc/c 快捷方式
│   │   ├── shell-profile.ts    # shell profile 解析
│   │   ├── user-config.ts      # ~/.config/cc-expand/config.json 读写
│   │   ├── update-check.ts     # self-update 检查（节流 + npm registry）
│   │   ├── latest-checker.ts   # npm latest 查询（execFile timeout）
│   │   ├── install-method.ts   # cc-expand 自身安装方式三级检测
│   │   ├── shard-writer.ts     # pattern 生成流水线的分片写入
│   │   ├── desc-classifier.ts  # 锚点语义标签启发式归类
│   │   ├── backup.ts           # binary 备份/恢复
│   │   └── patch-cleanup.ts    # patched binary 删除（独立失败域）
│   ├── types/                  # 类型定义
│   │   ├── index.ts            # PatchItem/PatchResult + CcxError re-export（单一来源在子包）
│   │   └── plugins.ts          # plugin 体系类型（manifest/strategies/entry）
│   ├── utils/                  # 小工具（部分为子包 re-export 兼容层）
│   │   ├── encode-token-literal.ts   # re-export 自子包
│   │   ├── parse-token-count.ts      # re-export 自子包
│   │   ├── patched-combos.ts   # versions.json combos 提取（targets 兼容）
│   │   ├── release-channel.ts  # latest/alpha dist-tag 解析
│   │   ├── validate-target.ts  # target 输入位数校验
│   │   └── version.ts          # 版本号规范化 + isBytecodeVersion
│   ├── internal-plugins.ts     # internal plugin 定义集（当前唯一 token-expansion）
│   └── index.ts                # 库入口（导出 PatchEngine 等，4 行）
├── packages/                   # pnpm workspace 子包
│   ├── plugin-context-expand/  # @cc-expand/plugin-context-expand（token 逻辑 + CcxError 单一来源）
│   │   ├── src/                # index.ts（桶文件）+ format/encode/parse-token-count + ccx-error
│   │   ├── tests/              # 子包独立单测
│   │   └── fixtures/cc-flow/   # 测试 fixture
│   └── website/                # @cc-expand/website（Nuxt 4 SPA 官网，GitHub Pages）
│       ├── app/                # app.vue + pages/index.vue + components/BannerBackground.vue
│       │   └── banner/banner-scene.ts  # Three.js 横幅场景逻辑（可测试的纯 TS）
│       ├── public/             # 静态资源
│       └── nuxt.config.ts      # ssr: false + nitro preset github-pages
├── scripts/                    # 运维/生成流水线（tsx 运行，不进发布产物）
│   ├── pattern-gen.ts          # pnpm pattern:gen：文本锚点 + bytecode 锚点生成
│   ├── plugin-silence-gen.ts   # pnpm plugin:gen-silence：silence 插件 shard 生成
│   ├── watch-patterns.ts       # pnpm watch:patterns：chokidar 监听自动上传（装配层）
│   ├── pattern-uploader.ts     # 上传器：hash 去重 + 持久化缓存 + 指数退避（可单测）
│   ├── oss-upload.ts           # pnpm pattern:upload / plugin:upload-silence：一次性上传
│   ├── oss-verify.ts           # pnpm pattern:verify-oss：OSS 数据核验（MD5）
│   ├── pattern-verify.ts       # pnpm pattern:verify：本地 pattern 校验
│   ├── latest-check.ts         # pnpm pattern:latest-check：npm latest 对比
│   ├── cleanup-versions.ts     # 过期版本清理
│   ├── platform-artifacts.ts   # 五平台 binary 下载/解压/patch 模拟共享工具
│   └── visual-regression.ts    # website 横幅视觉回归（playwright + pixelmatch）
├── tests/                      # 根包测试（vitest，与 src 层镜像）
│   ├── cli/                    # commands/ 子目录 + 渲染/i18n/pager 等单测
│   ├── core/                   # 引擎单测 + helpers/binary-fixtures.ts（合成三格式 fixture）
│   ├── services/               # 服务单测
│   ├── utils/                  # 工具单测
│   ├── scripts/                # pattern-uploader 单测
│   ├── integration/            # e2e：跑 dist/cli.js 的真实 CLI 集成测试
│   └── website/                # website 构建验证（主包 vitest 排除，独立运行）
├── patterns/                   # [生成物，gitignored] token pattern 分片，上传 OSS
├── plugin-shards/              # [生成物，gitignored] 插件 shard（silence-unrecognized-model）
├── dist/                       # [构建产物，gitignored] tsup 输出（cli.js / index.js）
├── docs/                       # 项目文档
│   ├── adr/                    # 架构决策记录（0001–0004）
│   ├── design/  plans/  qa/  tdd/  reports/  reviews/  research/  # 过程文档
├── assets/                     # 仓库图片资源（logo、banner）
├── tmp/                        # [临时产物] 截图/对比图（视觉回归输出）
├── zRefs/                      # [gitignored] 第三方源码调试区（tweakcc/bun 等）
├── .claude/skills/watch-patch/ # 运维技能：新版本 pattern 生成上传的定时流程定义
├── .planning/codebase/         # 本文档所在（代码库地图）
├── CONTEXT.md                  # 项目术语权威定义（plugin/pattern/shard/channel 等）
├── ccx-plugins.json            # GitHub 插件仓根索引格式示例（ccx plugins add 消费）
├── package.json                # 根包（bin: ccx/cc-expand；pnpm scripts 定义流水线）
├── pnpm-workspace.yaml         # workspace: packages/*
├── tsup.config.ts              # 双入口构建（lib + cli，子包 noExternal inline）
├── vitest.config.ts            # 测试配置（forks pool，排除 tests/website 与 zRefs）
└── tsconfig.json               # TypeScript 配置
```

## 目录职责

**`src/cli/`：**
- 职责：用户交互边界。cac 路由注册、参数解析、交互提示、结果渲染、退出码
- 包含：命令处理函数（`<name>Command`）、渲染器、i18n 字典、pager、result 类型
- 关键文件：`src/cli/index.ts`（入口）、`src/cli/commands/patch.ts`（最复杂的命令，283 行）

**`src/core/`：**
- 职责：字节级 patch 引擎与二进制结构解析。输入输出均为 Buffer，不做文件 IO，不认识 token 语义
- 包含：两个 patch 引擎、一个验证器、三个发现模块、两个二进制格式解析器
- 关键文件：`src/core/patch-engine.ts`、`src/core/bytecode-patch-engine.ts`

**`src/services/`：**
- 职责：领域编排。把 core 引擎 + 文件系统 + 网络（OSS/npm）组装为可复用深模块
- 包含：20 个服务文件，统一风格为 class（XxxService）或具名导出函数（collectPluginContext）
- 关键文件：`src/services/patch-applier.ts`（patch 编排中枢）

**`packages/plugin-context-expand/`：**
- 职责：token-expansion internal plugin 的代码载体；token 工具唯一真相来源；CcxError/ErrorCode 单一来源（ADR 0004）
- 包含：`src/index.ts` 桶文件导出 formatTokenCount / encodeTokenLiteral / parseTokenCount / CcxError / ErrorCode / isCcxError
- 注意：`main` 直接指向 `./src/index.ts`（不开发生态，运行时由 tsup inline 进根包 dist）

**`packages/website/`：**
- 职责：官网（产品介绍 + Three.js 横幅）。独立部署产物（GitHub Pages），不属于 npm 包
- 包含：`app/`（Nuxt 4 app 目录结构）、`nuxt.config.ts`（ssr: false、github-pages preset、预渲染 `/`）
- 依赖：nuxt ^4.4.8、three ^0.184.0、postprocessing

**`scripts/`：**
- 职责：pattern/插件 shard 的生成、上传、核验流水线，以及 website 视觉回归
- 包含：12 个 tsx 脚本，全部经根 `package.json` 的 pnpm scripts 暴露（`pattern:gen`、`plugin:gen-silence` 等）
- 复用 src 代码：脚本 import `../src/core/*` 与 `../src/services/*`（如 `scripts/pattern-gen.ts` 用 PatternDiscovery + ShardWriter）

**`tests/`：**
- 职责：根包全部测试，目录与 `src/` 逐层镜像（cli/core/services/utils/scripts/integration）
- 命名：`<被测文件名>.test.ts`（如 `tests/services/patch-applier.test.ts` 对应 `src/services/patch-applier.ts`）
- 特殊：`tests/core/helpers/binary-fixtures.ts` 合成最小 Mach-O/ELF/PE fixture，不依赖真实 binary；`tests/integration/` 需先 `pnpm build`（跑 dist/cli.js）

## 关键文件位置

**入口点：**
- `src/cli/index.ts`：CLI 入口（bin: `ccx`/`cc-expand` → `dist/cli.js`）
- `src/index.ts`：库入口（程序化使用 PatchEngine）
- `packages/website/app/app.vue`：website 根组件

**配置：**
- `package.json`：根包 manifest + 全部 pnpm scripts
- `pnpm-workspace.yaml`：workspace 定义
- `tsup.config.ts`：构建（双 entry、子包 inline、cli banner shebang）
- `vitest.config.ts`：测试（happy-dom + forks pool + 排除项）
- `packages/website/nuxt.config.ts`：website 构建

**术语与决策：**
- `CONTEXT.md`：项目术语权威定义（写代码前必读，消除 plugin/pattern/update 歧义）
- `docs/adr/0001`–`0004`：状态读 channel、等长 patch、plugin 统一抽象、CcxError 单一来源
- `.claude/skills/watch-patch/SKILL.md`：pattern 生产运维流程

**数据 schema 样例：**
- `patterns/versions.json`：版本索引（含 `bytecodePlatforms` 实证平台标注）
- `ccx-plugins.json`：GitHub 插件仓根索引格式（`ccx plugins add` 消费）
- `packages/plugin-context-expand/src/index.ts`：子包公共 API 清单

## 命名规范

**文件名：**
- 全小写 kebab-case：`patch-applier.ts`、`bytecode-anchor-discovery.ts`、`ccx-error.ts`
- 命令文件与命令名一致：`src/cli/commands/self-update.ts` → `ccx self-update`
- 测试文件 = 被测文件名 + `.test.ts`，目录镜像 src 层级

**标识符：**
- 服务类：`XxxService` 后缀（`PatchApplier` 与 `PluginsManager` 例外，无 Service 后缀）
- 命令导出：`export async function <name>Command(args, options?)`，返回 `CommandResult`
- 引擎类：`PatchEngine` / `BytecodePatchEngine` / `Verifier` / `PatternDiscovery`（Xxx + 角色）
- 错误码：SCREAMING_SNAKE_CASE（`PATTERN_NOT_FOUND`、`AMBIGUOUS_PATTERN`）
- plugin 名：kebab-case（`token-expansion`、`silence-unrecognized-model`）

**代码注释：**
- 每个文件头部有块注释说明职责与设计意图（Why 而非 What）
- 关键不变量处有行内中文注释解释折衷（如 latin1 语义、原子性保证）
- 测试隔离统一用 `homeDir` / `options?` 注入注释标注「测试隔离用」「测试注入用」

## 新代码放置指南

**新增 CLI 子命令：**
1. 实现：`src/cli/commands/<name>.ts`，导出 `export async function <name>Command(args: string[] = [], options?: <Name>Options): Promise<CommandResult<<Name>Data>>`
2. 注册：`src/cli/index.ts` import 并 `cli.command(...)` 注册（含 i18n 描述键）
3. 文案：`src/cli/i18n.ts` 加翻译键（en/zh 都要）
4. 测试：`tests/cli/commands/<name>.test.ts`（参照 `tests/cli/commands/patch.test.ts` 的注入模式）

**新增服务：**
- 实现：`src/services/<kebab-case-name>.ts`
- 风格：class `XxxService`（构造器接受注入项：`homeDir?`、缓存路径、可替换 IO 实现）或纯函数编排器（参照 `src/services/plugin-patches.ts`）
- 测试：`tests/services/<name>.test.ts`
- 若被多个命令共用，在 `src/cli/commands/` 各命令中以 `options` 注入以便测试替换

**新增核心引擎/发现模块：**
- 实现：`src/core/<name>.ts`；输入输出 Buffer，禁止文件 IO 与 token 语义 import
- 特殊编码（非默认 UInt32LE 等）经回调注入（参照 `BytecodePatchEngine.patch` 的 `resolveTokenBytes` 参数）
- 测试：`tests/core/<name>.test.ts`；若需二进制 fixture，扩展 `tests/core/helpers/binary-fixtures.ts`

**新增 internal plugin：**
1. 子包：`packages/<plugin-name>/src/index.ts` 导出 `InternalPluginDefinition`（manifest + strategies，参照 `packages/plugin-context-expand/src/index.ts`）
2. 注册：根包 `src/internal-plugins.ts` 加入 `INTERNAL_PLUGINS` 数组
3. 依赖：根 `package.json` devDependencies 加 `workspace:*`；`tsup.config.ts` 的 `noExternal` 数组加包名（inline 进 dist）

**新增 installed plugin（纯数据，无代码）：**
- author 侧：GitHub repo 根放 `ccx-plugins.json` 索引（schema 见根目录 `ccx-plugins.json`），manifest 声明 `shardBaseUrl`；shard 按 `<baseUrl>/versions.json` + `<baseUrl>/<version>.json` 布局托管
- shard 生成流水线复用：`scripts/oss-upload.ts --dir <local> --prefix <oss-prefix>`（参照 `plugin:upload-silence` script）

**新增工具函数：**
- token 相关：一律放子包 `packages/plugin-context-expand/src/`，根包 `src/utils/` 只留 re-export
- 通用小工具：`src/utils/<name>.ts`，配套 `tests/utils/<name>.test.ts`

**新增运维脚本：**
- 放 `scripts/<kebab-case>.ts`，在根 `package.json` 加 pnpm script（命名 `pattern:*` / `plugin:*` 风格）
- 需要跨脚本复用的平台/下载逻辑进 `scripts/platform-artifacts.ts`

## 特殊目录

| 目录 | 性质 | 生成方式 | 是否提交 git |
|------|------|---------|-------------|
| `patterns/` | 生成物 | `pnpm pattern:gen`（ShardWriter 写入） | 否（.gitignore，上传 OSS 分发） |
| `plugin-shards/` | 生成物 | `pnpm plugin:gen-silence` | 否（.gitignore，上传 OSS 分发） |
| `dist/` | 构建产物 | `pnpm build`（tsup） | 否 |
| `packages/website/.output/` `.nuxt/` | 构建产物 | nuxt generate / dev | 否 |
| `tmp/` | 临时产物 | `scripts/visual-regression.ts` 截图输出 | 否（未跟踪） |
| `zRefs/` | 调试参考 | 手动放置第三方源码（tweakcc、bun） | 否（.gitignore） |
| `tests/website/` | website 测试 | 手写 | 是，但主包 vitest 排除，独立运行 |
| `.claude/skills/watch-patch/` | 运维技能定义 | 手写 | 是 |
| `~/.cc-expand/` | 运行时状态 | CLI 运行时生成 | 不在仓库内 |

结构分析：2026-10-02
