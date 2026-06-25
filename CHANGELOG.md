# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0-alpha.1] - 2026-06-25

### Fixed
- `npm install -g cc-expand@0.4.0-alpha.0` 报 `EUNSUPPORTEDPROTOCOL: workspace:*`：`@cc-expand/plugin-context-expand` 误列在 dependencies（子包已 tsup inline bundle 进 dist，runtime 不需），npm publish 把 pnpm 的 `workspace:*` 协议原样发布导致 npm 无法解析。改移到 devDependencies（`npm install -g` 不装 devDeps，绕开）

## [0.4.0-alpha.0] - 2026-06-25

### Added
- plugin 体系：token 扩展降级为内置 plugin（`token-expansion`），支持从 GitHub repo 安装第三方 plugin（`ccx plugins add/remove/list/enable/disable`）。`ccx patch` 聚合所有 enabled plugin 对同一 binary 一次扫描，产物 binary 命名编码 plugin 集合（如 `claude-27w-flow`）；第三方 plugin 可声明任意等长字节替换（literal target），实现条件移除 CC 跨会话降权包装等能力
- `ccx run` 支持 combo 参数（`ccx run 27w-flow`、`ccx run 270k-flow`），token 段自动规范化
- plugin 作者指南（`docs/plugin-authoring.md`，manifest / shard 托管 / shortVer / literal target 说明）

### Changed
- 项目定位从「扩展 context window」转为「扩展 Claude Code 能力」
- [internal] patch-engine/verifier 解耦 token 知识（targetGenerator 必传）、CcxError 单一来源、token 工具搬入 `@cc-expand/plugin-context-expand` 子包、versions.json schema 迁移（targets→combos）
- [internal] 新增 ADR 0003（plugin 统一抽象）、ADR 0004（CcxError 单一来源）架构决策记录

### Fixed
- `parseTokenCount` 缺 m（百万）后缀与多段 shortVer 解析（`ccx run 1m` / `25w6k` 失败，违反 `parse(format(n))` 双向对称）
- verifier 对第三方 plugin literal-target patch 的误判（patch 成功但 verify 失败、binary 被误删）
- disable `token-expansion` 后 token 仍被扩展的逻辑错误
- `ccx plugins` 无子命令报 missing required args（改为默认显示 help）
- pager `key.shift` 触发 tsc 构建阻塞

## [0.3.9] - 2026-06-23

### Fixed

- `ccx supports current` / `ccx list` 的版本解析改以 `channel.json` 的 active version 为权威来源（与 `patch`/`setup` 一致），避免 ADR-0001 约定在不同命令间分叉

### Added

- `ccx supports` / `ccx list` 增加交互式 pager，支持上下翻页与搜索过滤；同时修复方向键/翻页键触发后 footer 错误渲染函数源码的问题

### Changed

- [internal] `watch-patterns` 重启时通过持久化 hash 缓存避免全量重新上传模式文件，降低 OSS 流量与启动耗时

## [0.3.8] - 2026-06-17

### Fixed

- `ccx patch` / `ccx run` 对 ≥100 万 token（7 位）目标崩溃（Bun `Expected CommonJS module to have a function wrapper`）：被 patch 的 `claude` 是 ~215MB Mach-O native binary，patch 必须字节级等长替换；旧 `PatchEngine` 的 `buffer.write` 对 7 位目标多出的字节吃掉相邻 JS 语法字符（`,`/`:`）破坏 minified bundle。新增等长数值编码——目标放不进源槽位时用更短等值字面量（`1000000`→`1e6   `）+ 空格 pad（见 ADR-0002）
- 交互式 `ccx patch` 输入校验原先按「十进制位数」硬拒 7 位目标，与非交互 `-t` 路径行为分叉：改为按「可编码性」校验，与 patch 引擎一致
- `Verifier` 校验原先用单一 slotWidth 编码目标字面量，与 `PatchEngine` 的 per-patch 编码不对称（不同宽度 sourceValue 时误判）：改为逐项按 `sourceValue.length` 编码校验

### Added

- 生成的 `cc` shell 函数运行 patched binary 前校验版本（读 `channel.json` active version 比对 `binary --version`），版本不符或 binary 损坏（`--version` 失败）时报错退出，避免静默跑过时的「版本孤儿」binary
- 纯函数工具 `encodeTokenLiteral`、`validateTargetInput`
- ADR-0002《Patch 必须等长替换 Mach-O，大目标用数值字面量等长编码》

## [0.3.7] - 2026-06-16

### Fixed

- `ccx status` 在 `ccx migration` / `ccx setup` 切换 `channel.json` 后仍显示旧版本：status 原先只探测 PATH 上的原生 `claude`（System Version），不读 `channel.json`。现版本解析对齐 `patch`/`setup`——以 `channel.json.version`（Active Version）为权威当前版本，无 channel.json 时回退 PATH 探测，与项目既有的版本源约定一致
- `ccx status` 在 `channel.json` 损坏（手编或写入被中断）时不再崩溃：`getChannel()` 的 `JSON.parse` 已用 try/catch 隔离，损坏即视作无 channel 回退 PATH 探测

### Added

- `ccx status` 返回结构新增 `activeSource: 'channel' | 'system'`，标注 version 来源
- `CONTEXT.md` 新增 Active Version / System Version 术语；`docs/adr/0001` 记录 status 以 channel.json 为权威版本的决策

## [0.3.6] - 2026-06-16

### Fixed

- `ccx self-update` 的更新检查原先硬编码查官方 `registry.npmjs.org`，而实际 `npm install -g` 走用户配置的 registry（如 npmmirror）。镜像同步窗口内检查判定有新版、npm 却装了镜像里的旧版（退出码仍为 0），self-update 每次都报告"已更新"但实际版本从未变化（用户反复执行始终装不上新版，并非程序循环），末尾隐式检查又提示有更新。现 `UpdateCheckService` 改走 `npm view`，与安装同源，检查源 = 安装源
- `ccx self-update` 在 spawn 成功后回验实际安装版本：若仍落后 latest（多为镜像延迟），渲染为 `[WARN]` 并提示用 `--registry=https://registry.npmjs.org` 重试，而非谎报"已更新到 X"
- `ccx self-update` 纳入隐式更新检查排除列表（与 `run` 同），消除"已更新"后紧接自相矛盾的"发现新版本"提示
- 修复 `self-update` 命令两个遗留 TypeScript 类型错误：`Spawner` 参数收紧为 `readonly string[]`、进程被信号杀死时 `code` 为 `null` 兜底为 `killed`

### Changed

- `queryLatestVersion` 泛化支持 `packageName` 参数（默认 `@anthropic-ai/claude-code`，查 cc-expand 自身传 `cc-expand`）
- `UpdateCheckService` 的注入边界从 `registryUrl: string` 升级为 `versionResolver: () => Promise<string | undefined>`，测试改用 resolver 注入替代 `globalThis.fetch` mock

## [0.3.5] - 2026-06-16

### Fixed

- `ccx status` 在目标版本已 patch（如刚 `ccx migration latest` 完成）时不再重复建议 `ccx migration latest`：next 现要求 latest 既新于当前版本、又尚未 patch

## [0.3.4] - 2026-06-16

### Added

- `ccx migration [version]`：把源版本已 patch 的 token 配置批量迁移到目标版本，升级 Claude Code 后无需逐个重新 patch。源解析优先级 `--from` > discovery 当前版本 > `patchedAt` 最新；支持 `--from <version>`、`--dry-run`、`-y`
- `ccx status` / `ccx list`：检测到 npm 新版本且当前已 patch 时，next 建议 `ccx migration latest`
- `ccx install` 有历史 patch 记录时建议 migration（首次仍建议 patch）；`ccx verify` 未 patch 且有历史记录时建议 migration
- `PatchApplier` 深模块：`patch` 与 `migration` 共用核心流程（prepare + execute 两阶段）

### Changed

- `ccx patch` 核心逻辑重构为调用 `PatchApplier`，外部行为不变（净 -117 行内联逻辑）

### Fixed

- `ccx status` / `ccx list` 此前的 latest 检测会让进程挂起最多约 30 秒（npm 子进程未终止），改用带超时自动终止的 `queryLatestVersion`，失败静默跳过不破坏主输出
- `ccx migration`：`channel.json` 路径写入与 `setup` 对齐（含版本目录）；`--from` 缺值不再被静默忽略且支持 `v` 前缀；npm 解析失败时不再以字面 `latest` 继续执行（避免落盘脏记录）
- `isVersionGreater` 对畸形版本（如 `2.1.x-beta`）保守返回 false，避免误判
- 补 `PATTERN_DISCOVERY_FAILED` 的退出码映射（0.3.3 遗漏）

## [0.3.3] - 2026-06-16

### Fixed

- `ccx config set installMethod` 不再被拒：config 命令白名单补齐 `installMethod`/`autoUpdateCheck`/`updateCheckInterval`（服务层早已支持，CLI 白名单漏同步），修复 `ccx self-update` 在 fnm/nvm 等非标准路径下检测失败后引导用户配置却被 config 拒绝的契约分裂
- 新增 `installMethod`（npm/pnpm/yarn/npx/unknown）与 `updateCheckInterval`（正整数毫秒）的值校验，非法值返回 `INVALID_TARGET`

## [0.3.2] - 2026-06-16

### Fixed

- `ccx patch` / `ccx install` 的 `--version` 参数与 cac 内置版本标志冲突导致无法传值，改为位置参数（如 `ccx patch 2.1.178`、`ccx install 2.1.178`），README 用法同步更新

### Added

- 内部 patch 模式生成 pipeline（维护工具，不随 npm 包发布）：
  - `PatternDiscovery`：贪心多字段算法从真实二进制 diff 自动发现 patch 模式
  - `desc-classifier`：启发式描述字段标注
  - `ShardWriter`：分片模式文件与版本索引写入
  - `LatestChecker`：npm 最新版检测与版本对比
  - `pattern:gen` / `pattern:verify` / `pattern:latest-check` 编排脚本，已通过 9 个 Claude Code 真实版本的 patch 等价验证
- `watch-patch` skill 重写为脚本驱动，支持 JSON 轮询发版

### Changed

- `prepublishOnly` 排除 integration 与 website 测试，发包不再触发 e2e

## [0.3.1] - 2026-06-14

### Added

- `ccx restore` 在 `autoMaintain` 开启时自动把 cc/c 快捷方式覆盖为调用原版 Claude Code（对称于 `patch` 的 maintain；之前只警告）
- 新增 `generateRestoredShellFunction` 与 `maintainShellShortcutsToOriginal`，复用 `extractBlock` 把 cc-expand 块内容改为 `claude --dangerously-skip-permissions`
- 新增 `ccx self-update` 命令：检测安装方式（npm/pnpm/yarn/npx/unknown）路由到正确的全局更新命令，`npx` 提示无需更新、`unknown` 引导配置 `installMethod`；手动执行强制跳过缓存查最新版，已是最新则跳过 spawn，有更新显示 `from→to`，查询失败降级为直接 spawn
- 新增隐式更新检查器：非 `run` 命令启动时并行查询 npm registry，发现新版本在 stderr 提示；24h 节流、3s 硬超时、尊重 `autoUpdateCheck` 偏好、失败静默
- 新增用户偏好字段 `installMethod`（声明安装方式，覆盖自动检测）、`autoUpdateCheck`（默认开启）、`updateCheckInterval`（默认 24h）
- 新增退出码 `NETWORK_ERROR`(69) 与 `SELF_UPDATE_FAILED`(70)
- 新增 `CONTEXT.md` 术语表：消歧 `channel` 与 `installMethod`，定义 `update` 的三重含义（self-update / CC binary / pattern）

### Fixed

- `--locale`/`-l` 传入非法值（如 `fr`）不再导致 `t()` 崩溃，回退到 `en`
- `ccx config set locale` 写入的偏好现在会被后续命令读取（之前持久化值从不生效）
- `ccx config set autoMaintain` 支持大小写不敏感的 `true/false/1/0/yes/no/on/off`，无法识别的值报错而非静默变 `false`
- `ccx config set locale <非法值>` 现在会被拒绝，防止后续命令崩溃
- `ccx run` 监听 child 的 `error` 事件，binary 存在但无法执行时不再 uncaughtException 崩溃
- `ccx run` 失败时现在打印错误消息（之前只退出，看不到原因）
- `--json` 输出的 `locale` 字段不再错误地填入翻译句子
- `ccx verify` 未 patch 时渲染为黄色 `[WARN]` 而非绿色 `[OK]`，避免"验证通过"的视觉误导
- renderer 的 `⚠ 注意：`/`建议操作：` 标签现在走 i18n，`--locale en` 下显示英文

### Changed

- `ConfigService` 接受 `homeDir` 注入，`list` 命令复用 `ConfigService.getUserConfig()`（消除直读 versions.json 的重复逻辑）
- `makeErrorResult` 泛型化，消除整类 `CommandResult<unknown>` 类型错误
- `runCommand` 支持 `spawn` 函数注入，测试用依赖注入替代 `vi.mock`

### Removed

- 删除重构后成为 dead code 的 `src/cli/output.ts` 及其测试

### Fixed (Tests)

- 修复 `run.test.ts` 的 `vi.mock` 从未生效问题（工厂引用未 hoisted 变量），测试从假绿（真实 spawn 巧合 exit 0）改为真正的依赖注入验证

## [0.3.0] - 2026-06-13

### Added

- 新增 `config` 命令：管理用户偏好，支持 `get`、`set`、`lang` 子命令
- 新增 `list` 命令：列出已安装和已 patch 的 Claude Code 版本，支持 `--patched` 过滤
- CLI 输出渲染器：支持 `--json` 结构化输出、`--no-color` 关闭颜色、`--quiet` 安静模式
- 国际化（i18n）支持：新增 `--locale`/`-l` 全局参数（`en` 或 `zh`）
- 新增 BSD 风格退出码映射（`EX_USAGE`、`EX_DATAERR`、`EX_NOINPUT` 等）
- 新增 `UserConfigService`：XDG 兼容的用户配置管理（`~/.config/cc-expand/config.json`）

### Changed

- CLI 路由迁移至 `cac`，所有命令统一返回结构化 `CommandResult` 对象
- `status`、`supports`、`install`、`setup`、`restore`、`verify`、`run`、`patch` 命令全部改为结果对象输出
- 集成测试扩展为对 `dist/cli.js` 的端到端测试

### Fixed

- 非 TTY 环境和 `NO_COLOR`/`TERM=dumb` 现在会正确禁用 ANSI 颜色
- `--yes` 标志不再被全局错误处理误拦截

## [0.2.1] - 2026-06-12

### Fixed

- Windows 平台 `install` / `patch` 命令调用 `npm.cmd` 时出现 `spawn EINVAL` 的问题，通过为 Windows 启用 `shell: true` 修复

## [0.2.0] - 2026-06-11

### Added

- `PatternService`：支持从阿里云 OSS 远程获取 patch 模式，带 ETag 缓存
- `watch-patterns` 脚本：自动检测新 Claude Code 版本并上传模式到 OSS
- `install` 命令支持 `v` 前缀版本号（如 `v2.1.173`）
- `utils/version`：集中式版本号归一化工具

### Changed

- `ConfigService` 重构为异步 API，模式解析委托给 `PatternService`
- CLI 命令适配异步 `ConfigService` API

### Fixed

- `watch-patterns` 适配 chokidar v5 目录监听 API

## [0.1.2] - 2026-06-11

### Added

- 支持 Claude Code v2.1.173（darwin-arm64、darwin-x64、win32-x64、linux-arm64、linux-x64）

## [0.1.1] - 2026-06-11

### Added

- 支持 Claude Code v2.1.172（darwin-arm64、darwin-x64、win32-x64、linux-arm64、linux-x64）

## [0.1.0] - 2026-06-10

### Added

- CLI 输出格式化器（支持成功/错误/信息/警告等带 emoji 的富文本输出）
- Shell profile 自动检测器（自动识别 .zshrc / .bashrc / PowerShell $PROFILE）
- `install`、`supports`、`setup`、`patch` 命令支持富文本输出
- `restore`、`status`、`verify` 命令支持富文本输出

### Changed

- 移除 `install.js`，改为直接通过 CLI 进行安装和配置

## [0.0.4] - 2026-06-10

### Added

- Windows 平台支持：PowerShell 函数生成、`.exe` 二进制文件处理、`npm.cmd` 调用适配
- CLI 全局 `--version` 标志
- `install` 命令支持 `latest` 标签自动解析为最新 semver 版本
- `install.js` Windows 环境适配（npm 命令和配置文件路径提示）

### Changed

- 重写 README 文档，优化 Agent 驱动的模式发现说明和压缩性能影响提示

## [0.0.3] - 2026-06-10

### Changed

- `install.sh` 重构为跨平台的 `install.js`，支持非 TTY 环境安全运行
- `setup` / `patch` 命令的交互式提示改为按需动态导入，避免 stdin 监听器残留导致 publish 时进程 hang

### Fixed

- 修复 `npm publish` 时 `prepublishOnly` 中的 `vitest --run` 卡死问题

## [0.0.2] - 2026-06-10

### Added

- `install.sh` 一键安装脚本，支持自动检测平台并安装 Claude Code

### Fixed

- 修复 `recordPatchedVersion` 中 `patchedVersions` 可能为 `undefined` 时的崩溃问题
- 优化 README 中一键安装脚本的说明文档

## [0.0.1] - 2026-06-10

### Added

- 首次发布
- `install` 命令：下载并安装指定版本的 Claude Code 本地二进制文件
- `setup` 命令：生成渠道无关的 Shell 包装函数，自动路由到本地二进制文件
- `supports` 命令：列出所有支持的平台和版本
- `patch` 命令：对本地二进制文件进行上下文窗口扩容 patch
- `run` 命令：启动已 patch 的本地二进制文件
- 本地二进制架构：将 Claude Code 管理在 `~/.cc-expand/` 目录下，避免触碰系统二进制文件
- 渠道发现服务：自动检测 brew、npx、direct 等安装渠道并按优先级排序
- 渠道配置持久化：记录用户选择的安装渠道
- 跨平台模式支持：根据 OS/arch 自动匹配对应的 patch 模式
- 平台特定二进制提取：从 npm 包中解析并提取平台原生二进制文件
- 内置 Claude Code 版本模式数据库（v2.1.169 / v2.1.170）
