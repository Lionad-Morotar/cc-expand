# ADR 0003: 定位转为 capability 扩展，patch 体系统一为 plugin 抽象

## Status

Accepted (2026-06-24)

## Context

ccx 原本是 token patch 工具（扩 CC context window 上限）。为支持自定义 patch（首个场景：cc-flow 通过 Team Mailbox 注入的上下文，被 CC 自动套上 "This came from...permission laundering." 降权包装，需条件移除该包装以恢复注入权重），引入 plugin 体系。

若 plugin 作为 token patch 之上的附加层，会形成两套 patch 机制（token pattern + plugin patch），数据模型、执行流程、分发各一套，维护与扩展成本翻倍。决策：plugin 作为 patch 的一等统一抽象，token patch 重构为 internal plugin，ccx 定位从 "expand context window" 转为 "expand cc capability"。

降权包装嵌在 Mach-O 明文 JS 里（`u9t` 函数，553 字节字符串字面量），必须等长覆盖（ADR 0002）。研究 ast-grep / comby / IPS / BPS / aider 后确认：定位用内容 search（同 aider SEARCH/REPLACE），等长约束是 macOS codesign 的领域特化（四个实践无一强制等长），故 `literal-pad` 为合理自创，无现成标准可抄。

## Decision

1. **统一抽象 + token-as-internal**：plugin 是 patch 的唯一执行单元；`token-expansion` 为 internal plugin（随包分发，**可 disable**、不可 remove），patches 数据仍走 OSS Pattern。`ccx patch` 从"跑 token engine"变为"聚合 enabled plugin 序列"。定位转变写进 CONTEXT.md 开篇。

2. **patch item 数据模型**：item 层 target 只剩 literal（`{value, pad?}`）；token 的动态生成（`encodeTokenLiteral`）上移到 plugin manifest 的 `target:{type:"token-encode"}` 策略，与 item 的 target 字段**互斥**（有策略则 item 无 target）。消除 item 层的 `kind:"token"` 错位。

3. **合并同一 binary + 容错分级**：所有 enabled plugin 的 patches 合并一次扫描 215MB buffer（避免逐 plugin 多次扫描），按 plugin 归类结果。容错分级——internal（token-expansion）失败**中止整体**（PATTERN_NOT_FOUND 说明版本不对），installed plugin 失败**标 failed/skipped + 警告**（plugin 不支持该版本），继续其他。

4. **分发 = shard**：installed plugin 从 GitHub repo `add`（repo 根 `ccx-plugins.json` 索引，`--plugin` 过滤，默认全部 + confirm + `--yes`），声明 `shardBaseUrl`；patches 按 active version 从 shard 拉（`versions.json` + `<version>.json`，复用 `PatternService` 的 OSS+ETag 布局），避免 manifest 内嵌 patches 的滞后。管理命令（add/remove/list/enable/disable）**只动注册表**（`plugins.json` + `cache/plugins/<name>/`），binary 状态由 `ccx patch` 显式刷新。

5. **命名 = shortVer-hook**：每个 plugin 提供 plugin 级 shortVer-hook（discriminated kind：`token-target` / `literal`），各 enabled plugin 的 shortVer 按执行顺序用 `-` 拼成 binary 名（`claude-27w-flow`）。token 的 compact 由新写 `formatTokenCount`（求余链 M→w→k，舍弃 <1000 余数）生成；`parseTokenCount` 扩展支持 `m`（百万）保持 `parse(format(n))===n` 双向对称。命名从 `claude-<数字>` 变 `claude-<shortVer>`（破坏性，选 compact 好读性 over 原值兼容）。

6. **迁移拆分**：旧 binary 文件**不自动重命名**（孤儿留存，`status` 不扫 bin/ 只读 versions.json）；`versions.json` schema **自动迁移**（`targets:number[]` → `combos:string[]`，用 `formatTokenCount` 转换，首次运行 plugin 版本时一次性完成）；`run`/`status`/`list`/`getPatchedBinaryName`/shell codegen 必然改适配 shortVer + combos（属 plugin 化改造本身，非额外迁移）。

7. **安全立场（按 a，工具中立）**：ccx 是 patch 工具，plugin 用途 author 自负；plugin 可任意修改 binary（含安全提示如 permission laundering），用户自担风险。README 与本 ADR 明示。不搞审核/分级机制。

8. **monorepo 子包化 + 模块边界**：token 扩展独立为 `packages/plugin-context-expand`（`@cc-expand/plugin-context-expand`），workspace 已有（`packages/*`）。`src/` 留通用内核。token 专属代码（`encodeTokenLiteral`/`parseTokenCount`/`formatTokenCount`/`validate-target`、`pattern-discovery`、`shard-writer`、`desc-classifier`、`latest-checker`、`token-expansion` manifest）+ scripts + tests 移子包；通用（`cli`、`PatchEngine`、`Verifier`、`PatchApplier`、`ConfigService`、`PluginsManager`、`ShardService`）留内核。边界对应"内核零 token 知识"——token 逻辑封装子包，内核通过抽象接口消费。

9. **bundled 发布**：子包不单独发 npm，运行时代码（`InternalPluginDefinition` + encode/format/parse）tsup inline 进 ccx `dist`（`external` 不含 `@cc-expand/*`）；开发脚本（watch-patterns/pattern-gen 等）留子包 workspace，不进发布产物。理由：`token-expansion` 是 internal plugin，依赖 ccx 内核（`PatchEngine`/`ShardService`），无独立使用场景；单包发布避免双包同步。

10. **策略注册表（b 方案）**：内核定义 `InternalPluginDefinition` 接口（manifest + strategies: `targetEncode`/`shortVer`/`parseInput`），token 子包 export 完整定义，`PluginsManager` 启动时注册到 `PatchEngine` 的 target 策略表 + shortVer 计算器表 + input parser 表。installed plugin 不 export 代码（全数据）。选 b（注册表）而非 a（内核直接 import 子包）——代价是注册表抽象，换内核零 token 知识（不 import `encodeTokenLiteral`，只查表）+ 未来加 internal plugin 零改内核。

## Considered Options

- **集成**：合并同一 binary（采纳）vs 独立 binary 产物（N targets × M plugins 组合爆炸）vs patch 后额外修饰（流程分两步）。
- **数据模型**：discriminated target（采纳）vs 纯 literal 预计算（token 多 target，每 target 一份 pattern 爆炸）vs 声明式 intent（每加一种 patch 类型改 ccx 内核）。研究后精简：`kind:"token"` 上移 plugin 级，`literal-pad` 合并进 `literal + pad`。
- **分发**：远程 shard（采纳）vs manifest 内嵌 per-version（滞后：作者改 patches，用户本地旧）。
- **版本耦合**：manifest 内 per-version（A）vs shard（B，采纳，复用 PatternService）vs 单份通用 search（C，变量名漂移不稳）。
- **命名**：shortVer compact（B，采纳）vs targetTokens 原值（A，兼容但放弃 compact 好读）。
- **迁移**：binary 不迁 + versions.json 迁（采纳）vs 全自动迁移（codesign 风险）。
- **安全**：工具中立 + 文档声明（a，采纳）vs install 分级警告（b，需 plugin 分类字段）。
- **代码组织**：token 独立子包（采纳）vs 留 src 单包目录（边界模糊、内核耦合 token）vs 多个独立 npm 包（过度，token 无独立场景）。
- **发布形态**：bundled inline（采纳）vs 子包单独发 npm（双包同步发布复杂）vs git submodule（依赖管理复杂）。
- **策略注入**：b 注册表（采纳，内核纯净 + 可扩展）vs a 内核直接 import 子包（MVP 简单但耦合 token 知识）。

## Consequences

- **正向**：plugin 一等抽象，token 与自定义 patch 统一；shard 复用 `PatternService`，零新分发机制；shortVer 命名同时解决缓存隔离、`ccx run` 定位、token-disabled 边界；容错分级让 cc-flow plugin 不支持某版本时 token 扩展仍正常。
- **负向 / 破坏**：binary 命名破坏（`claude-1000000`→`claude-1m`），`versions.json` schema 变化，`run`/`status`/`list`/shell codegen 要改；移除安全提示的 plugin 削弱 CC 跨会话安全设计，靠文档声明而非机制拦截（用户须理解风险）。
- **未来扩展**：metavariable 结构化匹配（ast-grep/comby 风格）降低 per-version shard 维护成本，当 shard 维护负担上来再引入；plugin 分类字段（若安全立场改 b）；`owner/repo@ref` 指定分支/tag；manifest 内嵌与 shard 混合（小 plugin 内嵌、大 plugin shard）。
- **子包化影响**：token/内核边界清晰，未来重写 token 扩展（如换编码算法）不碰内核；tests 跟代码走，子包独立测试。代价：子包代码不可独立运行（internal 依赖内核，接受）；bundled 使发布仍是单包（保持简单）；注册表抽象增加少量内核复杂度（策略表 + 注册流程），换零 token 知识与可扩展性。
