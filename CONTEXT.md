# cc-expand

一个 CLI 工具（命令名 `ccx` / `cc-expand`），通过 patch Claude Code 二进制来扩展其上下文窗口上限。本文档定义项目特定术语，消除"更新"等高频歧义词的混淆。

## Language

**Channel（渠道）**:
Claude Code 二进制在用户系统上的安装来源。
值域：`brew`、`npx`、`npm-global`、`pnpm-global`、`direct`。持久化在 `~/.cc-expand/channel.json`，供 patch/run 流程选择正确的二进制。
_Avoid_: source、distribution、location、installation

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

**Pattern（模式）**:
针对特定 Claude Code 版本 + 平台的 patch 指令集，托管在阿里云 OSS。每个 CC 版本对应一个 pattern shard，按 ETag 条件请求缓存到 `~/.cc-expand/cache/patterns/`。
_Avoid_: rule、config、recipe、patch（patch 是动词动作，pattern 是名词资源）

## Flagged ambiguities

- **`channel` 与 `install method` 必须严格区分**。前者回答"用户的 Claude Code 装在哪"（5 种渠道），后者回答"用户的 cc-expand 用什么装的"（5 种包管理器/分发）。任何代码、文档、对话中混用都会导致 self-update 执行错误的更新命令。
- **`update` 单独出现时永远歧义**。必须追问或根据上下文锁定到三重含义之一。README 中的"Version Update Mechanism"特指 pattern update（第 3 种）。
- **`migration` 与 `patch` 的边界**。两者都产生 patched binary，但意图不同：`patch` 是「为某版本设定/调整 token 配置」（交互、单 target、可首次设定）；`migration` 是「把既有配置原样搬到新版本」（非交互、批量、仅升级场景）。当用户说「升级后还要重新 patch」时，正确引导是 `migration` 而非重复 `patch`。

## 示例对话

> **用户**：cc-expand 怎么更新到最新版？
> **ccx**：你说的"更新"是哪个？self-update（更新 cc-expand 自己）、升级 Claude Code 二进制、还是刷新 pattern？pattern 是自动的，无需手动。
> **用户**：更新 cc-expand 自己。
> **ccx**：好，这是 self-update。你的 install method 是什么？
> **用户**：npm 全局装的。
> **ccx**：install method = npm，执行 `npm install -g cc-expand@latest`。注意你的 channel（CC 装在哪）不受影响，这次只动 cc-expand 自己。
