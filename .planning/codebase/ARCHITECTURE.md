# 架构（Architecture）

**分析日期：** 2026-10-06

## 系统概览

cc-expand 是一个 Node CLI 工具（命令名 `ccx` / `cc-expand`），通过插件化二进制 patch 扩展 Claude Code 能力。整体是 pnpm workspace monorepo：根包是 CLI 本体，`packages/plugin-context-expand` 是 token 逻辑子包（同时是 CcxError 单一来源），`packages/website` 是 Nuxt 4 官网（独立产物，不属于 npm 包）。

```text
┌────────────────────────────────────────────────────────────────────┐
│                        CLI 命令层（cac 路由）                        │
│  `src/cli/index.ts`（入口）+ `src/cli/commands/`（14 个子命令）        │
│  renderer / i18n / pager / result（CommandResult 信封 + 退出码）      │
└──────────┬──────────────────────────────┬──────────────────────────┘
           │ CommandResult                │ 注入 internal plugin 定义
           ▼                              ▼
┌────────────────────────────────────────────────────────────────────┐
│                          服务层（services）                          │
│  `src/services/patch-applier.ts`（两阶段编排：prepare/execute）       │
│  `src/services/plugin-patches.ts`（收集 PluginsManager + shard）     │
│  `src/services/plugins-manager.ts`（plugin 注册表）                  │
│  `src/services/pattern.ts`（OSS + ETag 拉取）  `config.ts`（状态）    │
│  `package.ts`（npm pack 下载） discovery/channel/shell-*/update-*    │
└──────────┬──────────────────────────────┬──────────────────────────┘
           │ patches + buffer             │ token 策略（encode/format/parse）
           ▼                              ▼
┌────────────────────────────┐  ┌─────────────────────────────────────┐
│      核心引擎（core）        │  │  子包 @cc-expand/plugin-context-     │
│  `src/core/patch-engine.ts` │  │  expand（`packages/plugin-context-  │
│  （文本锚点等长替换）         │  │  expand/src/index.ts`）              │
│  `src/core/bytecode-patch-  │  │  token 工具 + CcxError/ErrorCode    │
│  engine.ts`（常量池锚点）     │  │  单一来源（ADR 0004），tsup inline   │
│  discovery 三件套 +          │  │  进 dist                             │
│  binary-sections/           │  └─────────────────────────────────────┘
│  standalone-graph/verifier  │
└──────────┬─────────────────┘
           ▼
┌────────────────────────────────────────────────────────────────────┐
│                    二进制 / 状态 / 远程存储                           │
│  `~/.cc-expand/packages/<v>/bin/claude`（只读源缓存，永不被改写）      │
│  `~/.cc-expand/bin/claude-<shortVer>`（patch 产物，ccx run 执行它）   │
│  `~/.cc-expand/{channel,versions,plugins}.json`（状态机持久化）       │
│  `~/.cc-expand/cache/{patterns,plugins}/`（ETag 缓存）               │
│  阿里云 OSS（patterns/ 与 plugins/<name>/ 的 shard 托管）             │
│  npm registry（@anthropic-ai/claude-code 平台包 + cc-expand 自身）    │
└────────────────────────────────────────────────────────────────────┘
```

## 核心术语表

权威定义见 `CONTEXT.md`，以下为架构视角摘要：

| 术语 | 含义 | 关键代码位置 |
|------|------|-------------|
| Plugin（插件） | patch 的管理/执行单元 = manifest + patch items。分 internal（随包分发，可 disable 不可 remove）与 installed（用户从 GitHub repo 安装，可 remove） | `src/internal-plugins.ts`、`src/services/plugins-manager.ts`、`src/types/plugins.ts` |
| Internal Plugin | 内置插件，当前唯一实例 `token-expansion`，manifest 是代码常量，patches 数据走 OSS Pattern | `src/internal-plugins.ts` |
| Installed Plugin | 经 `ccx plugins add owner/repo` 安装，注册于 `~/.cc-expand/plugins.json`，shard 缓存于 `~/.cc-expand/cache/plugins/<name>/`，执行顺序按 add 时间且晚于所有 internal | `src/services/plugins-manager.ts` |
| Pattern（模式） | 针对 CC 版本 + 平台的 patch 指令集，OSS 托管，是 internal `token-expansion` 的 per-version 数据源 | `src/services/pattern.ts`、`patterns/versions.json` |
| Shard（分片） | installed plugin 的 per-version patches 远程托管单元，author 在 manifest 声明 `shardBaseUrl`，布局与 pattern 相同（`versions.json` + `<version>.json`） | `src/services/plugin-patches.ts`、`ccx-plugins.json`（repo 根索引格式） |
| Patch Item（patch 规则） | 一条等长改写规则 `{search, sourceValue, target?, bytecodePatterns?}`。`search` 定位上下文，`sourceValue` 是被覆盖子串，`target` 是等长 literal（省略则走 plugin 级 token-encode 策略） | `src/types/index.ts` |
| Bytecode Pattern（字节码锚点） | CC 2.1.246+ Bun bytecode 常量池的 hex 字节锚点，`{{tokens}}` 占位符标记 4 字节 Int32 token 槽位。唯一命中是硬约束（0 或 ≥2 次命中均拒绝） | `src/core/bytecode-patch-engine.ts` |
| Bytecode Anchor（锚点发现） | 把锚点生成工程化：signature 定位模块 → 槽位候选 → 伴生扩展唯一化 → binary 级实证，实证失败不产出锚点 | `src/core/bytecode-anchor-discovery.ts` |
| Guard（消音守卫锚点） | silence-unrecognized-model 插件的 patch 对象：`if(n==="model_validation")return;` 编译出的 `jnstrcteq+ret` 融合指令骨架，改跳转偏移 `06→04` 使告警恒不发 | `src/core/silence-guard-discovery.ts` |
| ShortVer（短版本标识） | plugin 贡献给 patched binary 命名的短串；各 enabled plugin 的 shortVer 按执行序用 `-` 拼成 binary 名（`claude-27w-flow`） | `src/services/plugins-manager.ts` 的 `computeShortVer` |
| Combo | `versions.json` 里记录的 shortVer 组合（如 `"27w-flow"`），是已 patch binary 的权威标识（旧 schema `targets:number[]` 自动迁移） | `src/services/config.ts` |
| Channel（渠道） | CC 二进制在用户系统上的安装来源（brew/npx/npm-global/pnpm-global/direct），持久化于 `~/.cc-expand/channel.json` | `src/services/channel-config.ts`、`src/services/channel.ts` |
| Active Version | cc-expand 当前生效的 CC 版本（`channel.json` 的 `version` 字段），状态机的"当前位置"，区别于 PATH 上的 System Version | `src/cli/commands/status.ts` |
| Install Method | cc-expand 自身的安装方式（npm/pnpm/yarn/npx/unknown），仅 self-update 使用，与 Channel 严格区分 | `src/services/install-method.ts` |
| Migration（迁移） | 把某版本已 patch 的全部 combos 批量 re-patch 到另一 CC 版本，非交互、仅升级场景；与 `patch`（交互、单 target）意图不同 | `src/cli/commands/migration.ts` |

## 架构模式

**整体：分层架构（CLI → services → core）+ 插件化数据驱动 + deep module 服务**

关键特征：

- **内核零 token 知识**：`src/core/patch-engine.ts` 与 `src/core/bytecode-patch-engine.ts` 不 import token 工具，编码策略由调用方注入（`targetGenerator` 回调、`resolveTokenBytes` 回调）。internal plugin 通过 `InternalPluginDefinition.strategies`（`src/types/plugins.ts`）把 `targetEncode`/`shortVer`/`parseInput` 注册进内核（ADR 0003 决策 10 的策略注册表方案）。
- **root → 子包单向依赖**：`@cc-expand/plugin-context-expand` 不能 import root（会成环），CcxError/ErrorCode 单一来源放在子包侧（`packages/plugin-context-expand/src/ccx-error.ts`），root 经 `src/types/index.ts` re-export 保持 `instanceof` 跨包有效（ADR 0004）。
- **数据与代码分离的插件体系**：internal plugin 携带代码策略；installed plugin 纯数据（patches 全部走远程 shard），不 export 任何代码。
- **命令层薄、服务层厚**：命令只做参数解析、交互提示（@inquirer/prompts）、渲染编排；领域行为在 service。`PatchApplier` 拆 prepare/execute 两阶段，使命令层能在中间插入交互/批量循环，patch 与 migration 两条命令复用同一编排。
- **依赖注入便于测试**：所有 service 构造器接受 `homeDir`/`cacheDir`/`baseUrl`/`spawn` 等注入项实现测试隔离，无模块级单例。
- **文件即状态**：无数据库、无进程内全局状态，全部状态持久化在 `~/.cc-expand/*.json` 与 `~/.config/cc-expand/config.json`。

## 分层职责

**CLI 层（`src/cli/`）：**
- 职责：cac 路由、参数解析、交互确认、结果渲染（彩色/quiet/JSON 信封）、i18n（en/zh）、pager 分页、隐式更新检查编排、BSD 风格退出码
- 位置：`src/cli/index.ts`、`src/cli/commands/*.ts`、`src/cli/renderer.ts`、`src/cli/i18n.ts`、`src/cli/pager.ts`、`src/cli/result.ts`、`src/cli/update-check-runner.ts`、`src/cli/guard-banner.js`（node 版本守卫，经 banner 注入 dist 头部）
- 依赖：services 层 + `src/internal-plugins.ts`
- 14 个子命令：config / status / supports / install / setup / restore / verify / run / patch（含 remove 子命令 `patch-remove.ts`）/ migration / list / self-update / plugins

**服务层（`src/services/`）：**
- 职责：领域编排与 IO 封装，CLI 无关（`PatchApplier` 返回 `ApplyPatchOutcome` 领域结果而非 CommandResult）
- 核心模块：
  - `patch-applier.ts`：patch 流程编排（copy → 文本替换 → bytecode 替换 → codesign → verify → 记录）
  - `plugin-patches.ts`：`collectPluginContext` 组装 PluginsManager + 拉 enabled installed plugin 的 shard patches（patch/migration 共用，保证 binary 命名与能力集合一致）
  - `plugins-manager.ts`：plugin 注册表（`~/.cc-expand/plugins.json`，`{installed, disabledInternal}` 布局）与 `computeShortVer`
  - `pattern.ts`：PatternService，OSS 拉取 + ETag 条件请求缓存（同时被 installed plugin shard 复用，仅换 baseUrl 与 cacheDir）
  - `config.ts`：ConfigService，`~/.cc-expand/versions.json` 读写 + `targets→combos` 自动迁移
  - `package.ts`：PackageService，npm pack 下载 wrapper 包 → 读 optionalDependencies → 下载平台包 → 提取 binary 到 `~/.cc-expand/packages/<v>/`
  - `channel-config.ts` / `channel.ts` / `discovery.ts` / `claude-discovery.ts`：渠道状态、渠道探测、PATH/NPX/全路径表兜底发现
  - `shell-codegen.ts` / `shell-maintain.ts` / `shell-profile.ts`：shell profile 中 `cc`/`c` 快捷方式的生成与自动维护（marker 包裹块）
  - `user-config.ts` / `update-check.ts` / `latest-checker.ts` / `install-method.ts`：用户偏好（XDG 路径）、self-update 检查（节流 + npm registry 查询）、CC latest 查询、安装方式三级检测
  - `shard-writer.ts` / `desc-classifier.ts`：pattern 生成流水线的写入与语义归类（scripts 侧使用）
  - `backup.ts` / `patch-cleanup.ts`：binary 备份恢复、patched binary 删除（记录与文件两个失败域分离）

**核心层（`src/core/`）：**
- 职责：纯 buffer 字节操作，无文件 IO（输入输出都是 Buffer），token 不可知
- 引擎：
  - `patch-engine.ts`：PatchEngine，文本锚点等长替换。latin1 字节语义（非 utf8，支持 `\u00XX` 转义的任意字节）；先全量预编码再扫描（任一 item 无法等长编码则整体失败，buffer 不动，原子性）
  - `bytecode-patch-engine.ts`：BytecodePatchEngine，常量池 Int32 锚点替换。每锚点必须恰好命中 1 次（`PATTERN_NOT_FOUND`/`AMBIGUOUS_PATTERN`），无占位符锚点仅作唯一性确认；`patch()` 用源值定位、`verify()` 用目标值回查，对称
  - `verifier.ts`：Verifier，patch 后多步验证（per-patch 替换完整性 + bytecode 锚点回查 + 可执行性 + codesign）
- 发现（生产 pattern 侧，与引擎对偶）：
  - `pattern-discovery.ts`：PatternDiscovery，从 binary latin1 文本发现 `=200000` 上下文锚点（伴生签名过滤 + 结构不变量守卫，违反即 throw `PATTERN_DISCOVERY_FAILED`）
  - `bytecode-anchor-discovery.ts`：signature 定位模块 → 槽位候选 → 伴生扩展唯一化 → 引擎级 patch+verify 实证
  - `silence-guard-discovery.ts`：guard 指令骨架（`52 07 11 06 6a 12`）扫描 + 上下文扩展唯一化 + literal patch 实证
- 二进制解析：
  - `binary-sections.ts`：按魔数分派解析 Mach-O/ELF/PE 三格式的 `__bun` section（`[u64 len][payload]` 布局），fail loud
  - `standalone-graph.ts`：解析 Bun StandaloneModuleGraph 模块表（52B/条模块记录、flags 位链式记录、trailer 校验）

**子包（`packages/plugin-context-expand/src/`）：**
- `format-token-count.ts` / `encode-token-literal.ts` / `parse-token-count.ts`：token 紧凑命名（`27w`/`1m`）、等长数值编码（科学计数法/十六进制 + 空格右 pad，`parse(format(n))===n` 双向对称）
- `ccx-error.ts`：CcxError/ErrorCode 单一来源（11 个错误码）+ `isCcxError` 守卫
- root 侧 `src/utils/encode-token-literal.ts` 等仅为 re-export 兼容层

## 数据流

### 主流程：`ccx patch`（交互式打补丁）

1. cac 路由进入 `patchCommand`（`src/cli/commands/patch.ts:92`）；`remove` 子命令分流到 `patchRemoveCommand`（`src/cli/commands/patch-remove.ts`）
2. 解析 `--target`/`--yes`/位置版本参数；版本缺省时读 `~/.cc-expand/channel.json`（`src/services/channel-config.ts`）
3. `collectPluginContext`（`src/services/plugin-patches.ts:45`）：构造 PluginsManager，按序拉每个 enabled installed plugin 的 per-version shard（`PatternService` 换 baseUrl + 独立 cacheDir，按 os/arch 选取、universal 回退，逐 item 运行时校验）
4. `PatchApplier.prepare`（`src/services/patch-applier.ts:106`）：包未装则 `PackageService.install`（npm pack wrapper → 平台包 → 提取 binary）；查 internal token-expansion 是否 enabled → `ConfigService.getPatternForVersion` 拉 OSS pattern（`PatternService` ETag 缓存）；OSS 无数据时 `PatternDiscovery` 本地兜底发现
5. 命令层交互：@inquirer/prompts 输入 target（位数校验 `src/utils/validate-target.ts`）+ confirm（`--yes` 跳过，但必须配 `--target`）
6. `PatchApplier.execute`（`src/services/patch-applier.ts:212`）：
   - 复制 `~/.cc-expand/packages/<v>/bin/claude` → `~/.cc-expand/bin/claude-<shortVer>`（shortVer 由 `PluginsManager.computeShortVer` 生成）
   - `PatchEngine.patch` 文本替换（合并 token patches + installed literal patches，一次扫描）
   - 聚合去重 `bytecodePatterns`，bytecode 版本（2.1.246+，判定在 `src/utils/version.ts`）则 `BytecodePatchEngine.patch`；无锚点配置时置 `bytecodeAnchorMissing` 标记（文本成功但运行时无效，CLI 层渲染警告）
   - macOS `codesign --sign - --force --deep` 重签名
   - `Verifier.verify`（`src/core/verifier.ts:50`）：替换完整性 + bytecode 锚点回查 + 可执行性
   - 任一步失败即删除产物 binary 返回 error；成功则 `ConfigService.recordPatchedCombo` 写 `versions.json`
7. 回命令层：`ChannelConfig.saveChannel` 把该版本记为 active；`autoMaintain` 开启时 `maintainShellShortcuts`（`src/services/shell-maintain.ts`）刷新 shell 快捷方式
8. `renderResult`（`src/cli/index.ts:104`）渲染 CommandResult（pager 分支见下），并 await 隐式更新检查 promise

### 次流程：`ccx run <combo>`

1. `runCommand`（`src/cli/commands/run.ts:58`）把输入规范化为 shortVer（`resolveRunShortVer`：首段 token parse+format，plugin 段保留）
2. 定位 `~/.cc-expand/bin/claude-<shortVer>`，缺失报 `BINARY_NOT_FOUND`；`--print-binary` 只输出路径供 shell 快捷方式使用
3. `spawn(binaryPath, ['--dangerously-skip-permissions'], { stdio: 'inherit' })`，子进程接管 stdio，退出码透传 `process.exit`

### 迁移流程：`ccx migration [version]`

1. `migrationCommand`（`src/cli/commands/migration.ts`）：源版本解析链 = 命令行 → channel.json → DiscoveryService → `versions.json` 中 `patchedAt` 最新
2. 读源版本 `patchedVersions[version].combos`，逐 combo 反解 token
3. 复用 `collectPluginContext` + `PatchApplier.prepare/execute` 循环 re-patch 到目标版本（默认 latest，经 `PackageService.resolveVersion` 解析）
4. 完成后切换 channel 指向新版本

### 自更新流程：`ccx self-update [channel]`

1. `selfUpdateCommand`（`src/cli/commands/self-update.ts`）：`InstallMethodDetector` 三级检测（用户配置 → `npm_config_user_agent` → argv[1] 路径）
2. `UpdateCheckService.check`（`src/services/update-check.ts`，节流缓存 + `queryLatestVersion` 走用户 registry）比较 semver
3. spawn 对应包管理器的全局安装命令；`release-channel.ts` 处理 latest/alpha dist-tag

### 状态读取流程：`ccx status`

1. `statusCommand`（`src/cli/commands/status.ts`）：以 Active Version（channel.json）为准，无则回退 DiscoveryService
2. 读 `versions.json` combos + `readShortcutState`（`src/services/shell-profile.ts`）解析快捷方式指向
3. `queryLatestVersion` 查 npm latest（execFile timeout 自动 kill，失败静默），有新版且已 patch 时 next 建议走 migration

### pattern 生产流水线（scripts/，运维侧）

1. `pnpm pattern:latest-check`（`scripts/latest-check.ts`）对比 npm latest 与本地 `patterns/versions.json` 判定 `needWork`
2. `pnpm pattern:gen <version>`（`scripts/pattern-gen.ts`）：五平台下载解压（`scripts/platform-artifacts.ts` 平台表）→ `PatternDiscovery` 文本锚点 → patch 模拟 → bytecode 版本追加 `discoverBytecodeAnchor` 自动生成与实证 → `ShardWriter` 写 `patterns/{version}.json` + `versions.json`（含 `bytecodePlatforms` 实证平台标注）
3. `pnpm plugin:gen-silence <version>`（`scripts/plugin-silence-gen.ts`）：`discoverSilenceGuardCandidates` 结构候选 → runtime 探活选定 → 写 `plugin-shards/silence-unrecognized-model/`
4. `pnpm pattern:upload` / `plugin:upload-silence`（`scripts/oss-upload.ts`，复用 `scripts/pattern-uploader.ts` 的 hash 去重 + 持久化缓存 + 指数退避）上传 OSS
5. 整个循环由 `.claude/skills/watch-patch/SKILL.md` 定义的定时技能驱动（backoff L0–L3 轮询）

## 关键抽象

**CommandResult 信封（`src/cli/result.ts`）：**
- 所有命令返回 `{success, command, summary, data?, next?, warnings?, severity?, error?}`
- `EXIT_CODES` 把 11 个 ErrorCode 映射为 BSD 风格退出码（64/69/70/77）
- 渲染器（`src/cli/renderer.ts`）按 color/quiet/json/locale 分支纯函数渲染；pager 是 index.ts 层的副作用编排，不侵入渲染层

**PatchApplier 两阶段编排（`src/services/patch-applier.ts`）：**
- `prepare(version)` 返回 `PrepareOutcome`（patches + sourceValue），供交互提示与批量迁移复用
- `execute(version, targetTokens, prepared)` 返回 `ApplyPatchOutcome`，每 target 生成独立 binary，可循环调用
- 领域结果类型（`ok: true/false` + ApplierError）CLI 无关，命令层负责转 CommandResult

**Plugin 抽象（`src/types/plugins.ts`）：**
- `PluginManifest { name, shardBaseUrl, shortVer, target?, ... }` + `ShortVerHook`（`token-target` | `literal`）判别联合
- `InternalPluginDefinition { manifest, strategies }`：internal 携带代码策略；installed 只存 manifest

**PatternService 双角色（`src/services/pattern.ts`）：**
- 同一个类既服务 internal 的 OSS pattern（默认 baseUrl + `cache/patterns/`），也经 `plugin-patches.ts` 以自定义 baseUrl + `cache/plugins/<name>/` 服务 installed shard——布局协议一致（`versions.json` + `<version>.json`，ETag）

## 入口点

**CLI 入口：**
- 位置：`src/cli/index.ts`（tsup 打包为 `dist/cli.js`，带 node shebang）
- 触发：`ccx` / `cc-expand` bin（`package.json` bin 字段）
- 前置守卫：`src/cli/guard-banner.js` 经 tsup banner（`tsup.config.ts` 读该文件拼接 shebang）注入 `dist/cli.js` 头部，先于 bundle 一切 require 执行。node 不满足 require(esm)（v20.19+ backport / v22+，典型场景：项目目录 `.node-version`/`.nvmrc` 经 fnm use-on-cd 把 `env node` 劫持到老版本）时，按候选序（`CC_EXPAND_NODE` 环境变量 → fnm default 别名 → volta → Homebrew → `/usr/local/bin/node`）spawnSync 探活并以子进程接力重执行自身；无可用候选则 stderr 提示修复路径后 exit 1（不走 CommandResult 信封）。守卫必须自包含（仅 node 内置），且只能经 banner 注入——esbuild 把 import 提升为顶部 require，任何 import 形态接入的守卫都晚于 cac 的 require
- 职责：locale 预解析（help 文案需在 cac parse 前定 locale）、命令注册、隐式更新检查 promise 启动、未知命令兜底渲染

**库入口：**
- 位置：`src/index.ts`
- 导出：`PatchEngine`、`CcxError`、`ErrorCode`、`PatchConfig`、`PatchResult`（供程序化使用）

**构建/运维脚本：**
- 位置：`scripts/*.ts`，经 `tsx` 运行（`pnpm pattern:gen` 等 npm scripts）
- 不进发布产物（tsup 只打 `src/index.ts` 与 `src/cli/index.ts`）

## 架构约束

- **等长替换（硬约束）**：Claude binary 是 ~215MB 的 Bun standalone native 可执行文件，Mach-O/ELF/PE 的 segment offset 与 code signature 硬编码文件布局，任何变长改写导致 codesign 失效、macOS AMFI exec 时 SIGKILL(137)。所有写入必须是字节级等长原地覆盖（ADR 0002）
- **latin1 字节语义**：引擎侧 search/sourceValue/target 一律按 latin1 编解码（`src/core/patch-engine.ts:99`），非 ASCII 字面量必须以 `\u00XX` 转义写入 shard，>U+00FF 字符被 `assertLatin1Representable` 拒收
- **bytecode 锚点唯一性**：每锚点全 binary 恰好命中 1 次；多命中意味着布局漂移，直接拒绝而非猜测
- **原子性**：引擎先全量预编码校验再动 buffer；applier 始终在拷贝上 patch，任一阶段失败删除产物
- **依赖方向**：root → 子包单向；子包不得 import root（CcxError 因此放子包，ADR 0004）；core 层不 import CLI 渲染层
- **内核零 token 知识**：`src/core/` 不 import token 编码工具，策略经回调/注册表注入；新增 internal plugin 理论上零改内核
- **运行时**：Node >= 18（`package.json` engines）；实际运行需 require(esm) 能力（v20.19 backport / v22+，依赖链 cac 等纯 ESM），入口 banner 守卫（`src/cli/guard-banner.js`）对老 node 自动换可用 node 重执行；依赖原生 `fetch`；macOS patch 后需重签名；Windows binary 需 `.exe` 扩展名处理（`getPatchedBinaryName`）
- **发布形态**：子包 tsup `noExternal` inline 进 dist（`tsup.config.ts`），单包发布；`patterns/`、`plugin-shards/` 是生成物（gitignored），数据通过 OSS 分发而非 npm

## 反模式（本仓库明令避免）

### utf8 代替 latin1 做字节搜索

- 现象：用 `Buffer.from(str, 'utf8')` 构造搜索 needle
- 后果：installed plugin 的字节锚点含 >=0x80 字节（JSON 以 `\u00XX` 转义），utf8 会双字节化导致搜索错位
- 正确做法：一律 latin1（见 `src/core/patch-engine.ts:96` 注释与实现）

### 跨包 instanceof CcxError（无守卫）

- 现象：子包与 root 各有一份 CcxError 类时 `instanceof` 恒 false
- 现状：ADR 0004 已把单一来源定到子包，`instanceof` 恢复有效；但边界处（JSON 反序列化、非 Error 对象）仍应使用 `isCcxError` 守卫（`packages/plugin-context-expand/src/ccx-error.ts`）
- 正确做法：新代码 catch 处优先 `isCcxError(e)`；不复制 CcxError 定义

### 变长 patch / 修改文件长度

- 后果：Mach-O load command 偏移表与物理数据脱节，codesign `invalid or unsupported format for signature`，运行时 SIGKILL(137)（ADR 0002 三对照实验确证）
- 正确做法：literal target 用 `pad: 'right-space'` 凑等长；token 用 `encodeTokenLiteral` 等长编码（科学计数法/十六进制）

### 已 patch binary 上的幂等重放

- 现象：对已 patch 的 buffer 再次跑锚点 patch，期望源值仍存在
- 后果：源值已被覆盖，锚点不命中；bytecode 引擎直接拒绝（by design）
- 正确做法：patch 总是基于 `~/.cc-expand/packages/<v>/bin/claude` 只读源缓存的拷贝执行（`src/services/patch-applier.ts:244`）

### 验证用错 binary 路径

- 现象：在源缓存或 PATH 系统 binary 上验证 patch 效果
- 后果：看到「未生效」假象（三个路径是三个不同 binary）
- 正确做法：只验证 `~/.cc-expand/bin/claude-<shortVer>`（CONTEXT.md "Flagged ambiguities" 末条）

### 扫描 `bin/` 目录推导 patch 状态

- 正确做法：状态一律读 `~/.cc-expand/versions.json` 的 combos（`src/services/config.ts`），孤儿 binary 不代表已 patch（ADR 0003 决策 6）

## 错误处理

**策略：** 类型化错误码 + 分层降级 + fail-loud/fail-safe 二分

- `CcxError { code, message, suggestion? }` 单一来源在子包（`packages/plugin-context-expand/src/ccx-error.ts`），root re-export（`src/types/index.ts`）；11 个 ErrorCode 经 `src/cli/result.ts` 映射 BSD 退出码
- 用户态服务 fail-safe：`PluginsManager.readRegistry` 注册表损坏降级为空；`PatternService` 网络失败降级本地缓存（404 不降级）；`UpdateCheckService` 一切异常路径返回 null（绝不因隐式检查打扰用户）
- 结构发现 fail-loud：`PatternDiscovery`/`binary-sections.ts`/`standalone-graph.ts`/锚点发现任何结构不变量违反一律 throw，不产出存疑数据、不静默降级
- 命令层错误统一经 `makeErrorResult`（`src/cli/result.ts:43`）构造信封，渲染到 stderr 并按错误码退出

## 横切关注点

- **i18n**：`src/cli/i18n.ts` 命令级翻译键（en/zh），locale 优先级 = `--locale` flag → 用户配置 → `en`；cac help 章节标题经 `localizeHelpSections` 覆写
- **日志**：无日志框架，诊断信息用 `console.warn`（如 `PatchApplier`/`PatternService` 的降级告警），用户输出经 renderer
- **校验**：版本号规范化 `src/utils/version.ts`（去 v 前缀）；target tokens 解析 `parseTokenCount`（支持 `27w`/`270k`/纯数字）；shard patch item 结构校验 `isValidPatchItem`（`src/services/plugin-patches.ts:33`）；版本字符串路径遍历防护 `isValidVersion`（`src/services/pattern.ts:41`）
- **测试隔离**：所有 IO 服务支持注入路径/实现（homeDir、spawn、execFile、confirm 等），见 `src/services/patch-applier.ts` 的 `PatchApplierOptions`

## 状态管理

无进程内全局状态，全部为文件持久化：

| 文件 | 内容 | 写入方 | 读取方 |
|------|------|--------|--------|
| `~/.cc-expand/channel.json` | `{channel, path, version}`（Active Version） | setup/migration/patch | patch/status/setup/run 链路 |
| `~/.cc-expand/versions.json` | `patchedVersions: { [v]: { targets?, combos?, patchedAt } }` | `recordPatchedCombo`/remove | status/list/migration |
| `~/.cc-expand/plugins.json` | `{installed[], disabledInternal[]}` 注册表 | PluginsManager | plugins 命令、collectPluginContext |
| `~/.config/cc-expand/config.json` | 用户偏好（locale/autoMaintain/installMethod/autoUpdateCheck） | config 命令 | i18n/update-check/self-update |
| `~/.cc-expand/cache/patterns/` | OSS pattern ETag 缓存 | PatternService | pattern 拉取 |
| `~/.cc-expand/cache/plugins/<name>/` | installed plugin shard 缓存 | PatternService（换 baseUrl） | collectPluginContext |
| `~/.cc-expand/packages/<v>/bin/claude` | 只读源 binary 缓存（永不被改写） | PackageService | PatchApplier（patch 输入） |
| `~/.cc-expand/bin/claude-<shortVer>` | patch 产物 | PatchApplier | run/shell 快捷方式 |

## 已知架构权衡

- **per-version pattern 维护成本**：CC 每个新版本都需重新生成 pattern shard（文本锚点随混淆变量漂移）。缓解：watch-patch 自动化流水线 + 本地 PatternDiscovery 兜底；远期方向是结构化匹配（metavariable），见 `CONTEXT.md` Shard 条目
- **installed plugin 顺序即 add 时间**：无显式优先级机制，先装先跑（`PluginsManager.list` 顺序）
- **codesign 验证是空实现**：`Verifier.verifyCodesign` 固定返回 passed（`src/core/verifier.ts:181`），实际签名校验由 patch 时的 `codesign --verify` 缺省与运行时表现兜底
- **website 独立于主包测试**：`vitest.config.ts` 排除 `tests/website/**`，website 构建验证单独运行

架构分析：2026-10-06
