# cc-expand

一个 CLI 工具（命令名 `ccx` / `cc-expand`），通过 **plugin 体系** patch Claude Code 二进制来扩展其**能力（capability）**——上下文窗口扩展只是首个内置 plugin，并非 ccx 的全部职责。本文档定义项目特定术语，消除“plugin/pattern/update”等高频歧义词的混淆。

## Language

**Channel（渠道）**:
Claude Code 二进制在用户系统上的安装来源。
值域：`brew`、`npx`、`npm-global`、`pnpm-global`、`direct`。持久化在 `~/.cc-expand/channel.json`，供 patch/run 流程选择正确的二进制。
_Avoid_: source、distribution、location、installation

**Active Version（激活版本）**:
cc-expand 当前生效的 Claude Code 版本，持久化在 `~/.cc-expand/channel.json` 的 `version` 字段。由 `setup`/`migration` 写入，`patch`/`setup`/`status` 读取，代表 cc-expand 状态机的"当前位置"。区别于 **System Version**——PATH 上原生 `claude` 二进制的版本（未被 cc-expand 管理的系统默认）。
_Avoid_: current version（口语歧义）、installed version（混淆"是否已 install 包"）

**Install Method（安装方式）**:
cc-expand 自身被安装到用户系统所用的包管理器或分发途径。
值域：`npm`、`pnpm`、`yarn`、`npx`、`unknown`。仅用于 self-update 流程，决定执行哪条更新命令。持久化在用户偏好 `~/.config/cc-expand/config.json` 的 `installMethod` 字段。
_Avoid_: channel（已专指 CC 渠道，见上）、source

**Self-update（自更新）**:
更新 cc-expand 自身（npm 包 `cc-expand`）到最新版本。由 `ccx self-update` 命令显式触发，或由隐式更新检查器提示后引导用户执行。
_Avoid_: upgrade（语义模糊，可被理解为 CC 升级）、update（三重歧义，见下）

**Update（更新）**:
在 cc-expand 语境下有**三重含义**，必须根据上下文消歧：

1. **Self-update** —— 更新 cc-expand 自身（见上）
2. **CC binary update** —— install 新版 Claude Code 二进制并 patch，由 `ccx install` + `ccx patch` 完成
3. **Pattern update** —— 拉取最新 patch 模式，已是远程按需 + ETag 缓存，用户无感，无需手动

**Migration（迁移）**:
把某个 CC 版本已 patch 的全部 targets（token 配置）整体重新 patch 到另一个 CC 版本，供版本升级场景一键迁移。由 `ccx migration [version]` 命令触发；默认源版本取当前 channel/discovery 版本（回退到 `versions.json` 中 `patchedAt` 最新的版本），目标版本默认 `latest`。是 "CC binary update"（update 第 2 义）的批量复用形态——区别于 `patch`（交互式、单 target、需手动指定）。复用 `versions.json` 的 `patchedVersions[version].targets` 作为迁移源。
_Avoid_: upgrade、sync、re-patch（re-patch 仅是实现动作，不是用户概念）

**Plugin（插件）**:
ccx 的 patch 能力单元与管理单元。一个 plugin = 元数据 + 一组等长二进制 patch 规则（patch items），由 `ccx patch` 按序对同一 Claude Code binary 执行。分两类：**Internal Plugin**（内置）与 **Installed Plugin**（用户安装）。`ccx patch` 产物是聚合所有 enabled plugin 的单一 patched binary，而非每 plugin 独立产物。
_Avoid_: extension、addon、module、patch（patch 是动词动作，plugin 是管理/执行单元名词）

**Internal Plugin（内置插件）**:
随 ccx npm 包分发的 plugin。当前唯一实例是 `token-expansion`（上下文窗口扩展），其 patches 数据仍走 OSS Pattern（per-version）。**不可 remove**（内置），**可 disable**——disable 后不参与 `ccx patch`，产物退化为不含该 plugin 的 patched binary。
_Avoid_: default plugin、core plugin（暗示不可 disable，与"可 disable"冲突）

**Installed Plugin（已安装插件）**:
用户通过 `ccx plugins add <owner/repo>` 从 GitHub 仓库安装的 plugin。注册于 `~/.cc-expand/plugins.json`（注册表），shard 缓存于 `~/.cc-expand/cache/plugins/<name>/`。可 `remove` / 可 disable。执行顺序按 `add` 时间（先装先跑），且晚于所有 internal plugin。
_Avoid_: user plugin（歧义：作者还是用户）、custom plugin（与 internal 对应的是 installed，非 custom）

**Pattern（模式）**:
针对特定 Claude Code 版本 + 平台的 patch 指令集，托管在阿里云 OSS。每个 CC 版本对应一个 pattern shard，按 ETag 条件请求缓存到 `~/.cc-expand/cache/patterns/`。plugin 体系下，pattern 是 internal `token-expansion` plugin 的 patches 数据源——不再被 ccx 直接消费，而是经 internal plugin 间接使用。
_Avoid_: rule、config、recipe、patch（patch 是动词动作，pattern 是名词资源）

**Shard（分片）**:
plugin 的 per-version patches 远程托管单元。installed plugin 的 author 在 manifest 声明 `shardBaseUrl`，ccx 按 active version 拉 `<baseUrl>/versions.json`（版本索引）+ `<baseUrl>/<version>.json`（per-version patches），ETag 缓存到 `~/.cc-expand/cache/plugins/<name>/`。与 Pattern 平行——pattern 是 internal 的数据源，shard 是 installed 的数据源。MVP 用远程 shard 避免内嵌 manifest 的滞后（改 patches 不碰 manifest）；未来可能引入结构化匹配（metavariable）降低 per-version 维护成本。
_Avoid_: pattern（专指 internal token-expansion 的 OSS 数据）、bundle、package

**ShortVer（短版本标识）**:
plugin 贡献给 patched binary 命名的短字符串。各 enabled plugin 的 shortVer 按执行顺序用 `-` 拼成 binary 名（`claude-<sv1>-<sv2>`，如 `claude-27w-flow`）。`token-expansion` 的 shortVer 由 `formatTokenCount(targetTokens)` 生成（compact：`27w`/`1m`/`25w6k`，求余链 M→w→k）；installed plugin 用 `{kind:"literal", value}` 声明固定值（如 `flow`）。是 binary 的确定性指纹——不同 plugin 组合产不同 binary，缓存天然隔离。
_Avoid_: tag、label、suffix、version（version 指 plugin/CC 版本号，shortVer 是命名标识）

**Patch Item（patch 规则）**:
plugin 清单里的一条等长二进制改写规则：`{search, sourceValue, target}`。`search` 定位上下文、`sourceValue` 是被覆盖的精确子串、`target` 是等长替换（`{value, pad?}` 的 literal）。`token-expansion` 的 item 无 target 字段（走 plugin 级 `token-encode` 策略）。是现有 `PatchItem` 类型的泛化——从“只替换数字常量”扩展到“任意等长 JS 源码改写”。
_Avoid_: rule、operation、step

## Flagged ambiguities

- **`channel` 与 `install method` 必须严格区分**。前者回答“用户的 Claude Code 装在哪”（5 种渠道），后者回答“用户的 cc-expand 用什么装的”（5 种包管理器/分发）。任何代码、文档、对话中混用都会导致 self-update 执行错误的更新命令。
- **`plugin` 与 `pattern` 必须严格区分**。plugin 是管理/执行单元（元数据 + patch items）；pattern 是 internal `token-expansion` plugin 的 per-version patches 数据源（OSS 托管）。用户说“加个 plugin”指 installed plugin（从 repo 安装），“pattern 没更新”指 OSS 的 token 数据。混用会让 `ccx plugins add` 与 pattern OSS 流程互相干扰。
- **`update` 单独出现时永远歧义**。必须追问或根据上下文锁定到三重含义之一。README 中的"Version Update Mechanism"特指 pattern update（第 3 种）。
- **`migration` 与 `patch` 的边界**。两者都产生 patched binary，但意图不同：`patch` 是「为某版本设定/调整 token 配置」（交互、单 target、可首次设定）；`migration` 是「把既有配置原样搬到新版本」（非交互、批量、仅升级场景）。当用户说「升级后还要重新 patch」时，正确引导是 `migration` 而非重复 `patch`。
- **`status` 报告的版本以 Active Version（`channel.json`）为准，而非 System Version（PATH 原生 `claude`）**。`setup`/`migration` 切换 channel 后，`status` 必须反映新版本；若仍显示旧版本，说明 status 未读 `channel.json`（v0.3.7 前的 bug）。无 `channel.json` 时回退 DiscoveryService，照顾未 `setup` 的用户——这与 `patch`/`setup` 读 channel.json 的优先级一致。

## 示例对话

> **用户**：cc-expand 怎么更新到最新版？
> **ccx**：你说的"更新"是哪个？self-update（更新 cc-expand 自己）、升级 Claude Code 二进制、还是刷新 pattern？pattern 是自动的，无需手动。
> **用户**：更新 cc-expand 自己。
> **ccx**：好，这是 self-update。你的 install method 是什么？
> **用户**：npm 全局装的。
> **ccx**：install method = npm，执行 `npm install -g cc-expand@latest`。注意你的 channel（CC 装在哪）不受影响，这次只动 cc-expand 自己。
