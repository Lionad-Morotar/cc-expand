# Plugin 作者指南

ccx 从 v0.4 起支持 plugin 体系（ADR 0003）——plugin 是 patch 的一等统一抽象，token 扩展降级为内置 plugin（`token-expansion`），第三方可从 GitHub repo 安装自定义 plugin。本文档指导如何编写和发布 plugin。

关联：[ADR 0003](../adr/0003-plugin-unified-patch-abstraction.md)、[CONTEXT.md](../CONTEXT.md)（Plugin/Shard/ShortVer/Patch Item 术语）、[PRD](../plans/2026-06-24-plugin-system.md)。

## plugin 是什么

一个 plugin = 极简 manifest（元信息）+ 远程 shard（per-version patches 数据）。ccx 在 `ccx patch` 时拉取 enabled plugin 的 shard，聚合所有 patches 对同一 Claude Code binary 一次扫描等长覆盖（ADR 0002），产物 binary 命名编码 plugin 集合（如 `claude-27w-flow`）。

## 1. manifest（极简元信息）

```json
{
  "name": "cc-flow-trust-peer",
  "version": "1.0.0",
  "description": "条件移除 CC 跨会话降权包装",
  "shardBaseUrl": "https://raw.githubusercontent.com/you/your-plugin/main/patterns",
  "shortVer": { "kind": "literal", "value": "flow" }
}
```

字段：
- `name`：唯一标识，kebab-case
- `shardBaseUrl`：per-version patches 的远程根地址（OSS / GitHub raw / CDN 皆可）
- `shortVer`：plugin 贡献给 binary 命名的短标识。`{kind:"literal", value:"flow"}`（固定）或 `{kind:"token-target"}`（仅 internal token-expansion 用，作者不需要）
- `target`：**仅 internal plugin 使用**（`{type:"token-encode"}`，声明走 token-encode 策略）。第三方 plugin **不应设置**——installed plugin 的 patches 自带 item 级 literal target（见下文 PatchItem.target），无需 plugin 级策略
- `version` / `description`：可选

## 2. shard 数据布局（`shardBaseUrl` 下）

```
<shardBaseUrl>/versions.json        # 版本索引：支持哪些 CC 版本
<shardBaseUrl>/<cc-version>.json    # per-version patches（OsPatterns 格式）
```

`versions.json`：
```json
["2.1.186"]
```

`2.1.186.json`（OsPatterns：os → arch → PatchItem[]）：
```json
{
  "darwin": {
    "arm64": [
      {
        "search": "...目标字符串（含足够上下文唯一定位）...",
        "sourceValue": "...被覆盖的精确子串（长度 = 等长槽位宽度）...",
        "desc": "可选，patch 结果展示",
        "target": {
          "value": "process.env.YOUR_FLAG?\"\" : \"短安全指令\"",
          "pad": "right-space"
        }
      }
    ]
  }
}
```

### PatchItem

- `search`：定位上下文（ccx 在 binary 里 indexOf 它）
- `sourceValue`：被覆盖的精确子串（必须在 search 内；其字节长度 = 等长槽位宽度）
- `desc?`：可选描述
- `target`：
  - `value`：替换字节（installed plugin 用，literal 固定值）
  - `pad?: "right-space"`：value 不足 sourceValue 长度时，ccx 自动右 pad 空格到等长（作者须保证该上下文允许尾随空格，如 `${}` 插值表达式内）

无 `target` 字段的 item 走 plugin 级 token-encode 策略（仅 internal token-expansion）。

### 等长约束（关键）

Mach-O binary 必须等长替换（ADR 0002）：
- `target.value`（+ pad 后）的字节长度**必须**等于 `sourceValue` 字节长度
- 超长 → ccx 报 `INVALID_TARGET`，拒绝 patch
- 不足 + `pad:"right-space"` → ccx 自动补空格
- 不足 + 无 pad → ccx 报 `INVALID_TARGET`

## 3. repo 索引（`ccx-plugins.json`）

repo 根放 `ccx-plugins.json`（一个 repo 可含多 plugin）：
```json
{
  "plugins": [
    { "name": "cc-flow-trust-peer", "version": "1.0.0", "shardBaseUrl": "...", "shortVer": {...} },
    { "name": "another-plugin", "shardBaseUrl": "...", "shortVer": {...} }
  ]
}
```

## 4. 安装与使用

```bash
ccx plugins add your-name/your-plugin           # 拉取 ccx-plugins.json + 注册（重复 add 同名会 upsert 更新 manifest，保留 enabled 状态）
ccx plugins add your-name/your-plugin --yes     # 跳过 confirm
ccx plugins add your-name/your-plugin --plugin cc-flow-trust-peer  # 选装子集
ccx plugins list                                 # 查看 internal + installed + enabled
ccx plugins disable cc-flow-trust-peer           # 临时关闭
ccx plugins enable cc-flow-trust-peer
ccx plugins remove cc-flow-trust-peer            # 卸载
ccx patch --target 270000                        # patch 时聚合 enabled plugins
```

binary 命名：各 enabled plugin 的 shortVer 按序用 `-` 拼（如 token `27w` + cc-flow `flow` → `claude-27w-flow`）。

## 5. 安全声明

plugin 可对 Claude Code binary 做任意等长改写，**包括移除安全提示**（如跨会话权限提升警告）。ccx 不审核 plugin 内容，用户安装第三方 plugin 需自行信任来源。移除安全提示会削弱 CC 的跨会话安全设计，仅应在理解风险的前提下使用。
