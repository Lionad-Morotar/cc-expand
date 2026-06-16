# ADR 0001: status 以 channel.json 为激活版本的权威来源

## Status

Accepted (2026-06-16)

## Context

`ccx status` 曾通过 `DiscoveryService` 探测 PATH/NPX 上的 `claude` 二进制来确定"当前版本"（System Version）。但 cc-expand 的写入流程 `setup`/`migration` 都把"当前激活版本"写入 `~/.cc-expand/channel.json`，`patch`/`setup` 也优先读它的 `version` 字段。`status` 不读 `channel.json`，导致用户执行 `ccx migration latest`（channel 切到新版本）后，`status` 仍报告 PATH 上的旧版本，与 migration 结果脱节——这是 v0.3.6 上报的 bug：migration 成功迁到 2.1.178，status 仍显示 2.1.177。

## Decision

`status` 的版本解析对齐 `patch`：**优先读 `channel.json.version`（Active Version），无 `channel.json` 时回退 `DiscoveryService`（PATH/NPX，System Version）**。`StatusData` 新增 `activeSource: 'channel' | 'system'` 标注来源。

## Considered Options

- **A. channel 优先，回退 discovery（采纳）** —— 与 patch/setup 的版本源统一，migration 后状态一致。
- **B. 同时显示 Active + System 两个版本** —— 更透明但输出变复杂，且改变了既有 `version` 字段语义，破坏面大。
- **C. 仅在 installedVersions 列表标记 channel 版本为 current，不改 summary** —— summary 仍报 PATH 旧版本，用户核心抱怨未解决。

## Consequences

- 正向：`migration`/`setup` 后 `status` 与状态机一致；与 `patch` 的版本源统一，消除内部不一致。
- 负向：`status` 不再直接反映"PATH 原生 claude 版本"。可接受——`status` 的职责是报告 cc-expand 管理的状态，System Version 可经 `activeSource: 'system'` 或单独诊断获取。
- 回退兼容：无 `channel.json` 的老用户（直接 patch PATH claude 未走 setup）行为不变，回退 DiscoveryService。
