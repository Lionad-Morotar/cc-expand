# 代码库关注点（技术债务 / 风险 / 注意事项）

**分析日期：** 2026-10-02

本文档基于代码实证（源码、注释、`docs/adr/`、`docs/qa/`、`docs/reports/`、测试跳过项），供规划阶段评估改动风险与优先级。所有路径相对仓库根。

## 技术债

**文本锚点 0 命中静默通过，ADR 0003 容错分级未完全落地：**
- Issue: `PatchEngine.patch` 对单个 patch item 在 binary 中 0 命中时不报错、不计数，只要任一 item 命中即整体成功。installed plugin 的 item 在新 CC 版本失效（混淆变量漂移）时，patch 照常成功，且产物 binary 名仍含该 plugin 的 shortVer（`computeShortVer` 不受 patch 结果影响），用户无任何感知。ADR 0003 第 3 条明确「installed plugin 失败标 failed/skipped + 警告」，实现中没有按 plugin 归类失败并警告。
- Files: `src/core/patch-engine.ts`（`continue` 分支与 while 循环 0 命中即静默）、`src/services/patch-applier.ts`（`execute` 只看 `totalPatches`）、`src/services/plugin-patches.ts`（shard 拉取失败仅 `console.warn` 后跳过）
- Impact: 第三方插件失效 → binary 命名与实际能力不一致，插件功能静默缺失；排障困难（verify 也只校验已命中项）。
- Fix approach: `PatchDetail` 增加 plugin 归属（patch item 按 plugin 分组传入），`PatchApplier.execute` 汇总「0 命中的 plugin」列表，CLI 层渲染警告；bytecode 锚点已是硬约束（`src/core/bytecode-patch-engine.ts` 唯一性校验）无需改动。

**versions.json 读取无容错 + 非原子写 + 读改写竞态：**
- Issue: `ConfigService.getUserConfig` 直接 `JSON.parse` 无 try/catch（文件损坏/写入中断即抛异常，仅靠 `src/cli/index.ts:409` 顶层 catch 兜底为 exit 1，非结构化报错）；`setUserConfig` 普通 `writeFileSync` 非原子；`recordPatchedCombo`/`removePatchedCombo` 为读-改-写序列，无锁，两个并发 `ccx patch` 进程会互相覆盖丢更新。与 `src/services/plugins-manager.ts`（损坏降级空表）、`src/services/update-check.ts`（损坏降级 null）的容错策略不一致。
- Files: `src/services/config.ts`（`getUserConfig`/`setUserConfig`/`recordPatchedCombo`）
- Impact: 状态文件损坏导致所有命令崩溃式失败；并发 patch 丢 patch 记录 → `migration`/`status` 数据不全。
- Fix approach: 统一容错策略（损坏时备份坏文件 + 结构化 CcxError 或降级 + 警告）；写入改为临时文件 + `renameSync` 原子替换；读改写加简单文件锁或进程内队列。

**plugins.json 写入中断导致注册表静默清空：**
- Issue: `PluginsManager.readRegistry` 对损坏文件降级为空表（注释明确此行为），`writeRegistry` 非原子写。两者叠加：一次写入中断 → 下次读取降级空表 → 后续任何一次写操作把空表落盘，installed plugin 全部「消失」，patch 产物不再含这些插件，无告警。
- Files: `src/services/plugins-manager.ts`（`readRegistry`/`writeRegistry`）
- Impact: 低概率但后果是用户安装的第三方插件整体丢失且无提示。
- Fix approach: 写入原子化（temp + rename）；损坏时不要静默清空，至少 `console.warn` 并保留损坏文件副本供恢复。

**Verifier 的 codesign 检查是空壳：**
- Issue: `Verifier.verifyCodesign` 恒返回 `{ name: 'codesign', passed: true }`，注释承认「跳过实际调用」。patch 后的 codesign 签名（`execSync('codesign --sign - --force --deep ...')`）失败也只降级为 `codesignWarning` 字符串。即 macOS 上「codesign 校验通过」这一 verify 结论从未真实产生。
- Files: `src/core/verifier.ts`（Check 3 与 `verifyCodesign`）、`src/services/patch-applier.ts`（codesign 签名与 `codesignWarning`）
- Impact: 签名损坏的 binary 通过全部 verify；实际后果延迟到 `ccx run` 时 spawn 失败（`src/cli/commands/run.ts` 的 `child.on('error')`）才暴露，排障链路变长。
- Fix approach: verify 阶段真实调用 `codesign --verify <path>`（失败标 fail 或保留 warning 但如实命名），删除虚假的 passed: true。

**CcxError/ErrorCode 暂居 token 子包（ADR 0004 自认债务）：**
- Issue: 通用错误类型定义在 `packages/plugin-context-expand/src/ccx-error.ts`（依赖图底层防循环 import），ADR 0004 明确「命名职责违和，演进方向是拆 `@cc-expand/errors`」。`isCcxError` 守卫保留（对 JSON 边界更稳健），但新代码可能误用已恢复可用的 `instanceof`。
- Files: `packages/plugin-context-expand/src/ccx-error.ts`、`src/types/index.ts`（re-export）
- Impact: 新增共享类型时会加重违和；`instanceof` 与守卫双轨并存需要约定。
- Fix approach: 通用共享类型增多时拆 `@cc-expand/errors`；当前阶段新代码统一用 `isCcxError`。

**migration 数据结构带 @deprecated 派生字段：**
- Issue: `MigrationData.migratedTargets`/`failedTargets` 注释标 @deprecated「后续版本移除」，与 `migratedCombos`/`failedCombos` 并存，消费者可能读旧字段。
- Files: `src/cli/commands/migration.ts`（`MigrationData` 接口）
- Impact: 双 schema 并存的认知成本，移除时需排查 JSON 消费者。
- Fix approach: 下一个破坏性版本移除，同步 grep 测试与文档中的引用。

**update-check 注释与实现不符（声称 atomic write）：**
- Issue: `UpdateCheckService` 头注释写「atomic write」，实现是普通 `writeFileSync`（`src/services/update-check.ts` `writeState`）。该文件损坏时降级 null 无实际危害，但注释误导后来者。
- Files: `src/services/update-check.ts`
- Impact: 轻微，认知误导。
- Fix approach: 改注释或改实现，二选一对齐。

**.gitignore 存在无效死条目：**
- Issue: `.gitignore` 中 `~/.cc-expand/` 是字面路径（gitignore 不展开 `~`），永不匹配任何文件；运行时目录实际在用户 home，不在仓库内，规则无意义。
- Files: `.gitignore`
- Impact: 无实际危害，纯噪音。
- Fix approach: 删除该条目即可。

**scripts 目录大部分无测试：**
- Issue: `tests/scripts/` 仅有 `pattern-uploader.test.ts`；`scripts/pattern-gen.ts`、`watch-patterns.ts`、`plugin-silence-gen.ts`、`visual-regression.ts`、`platform-artifacts.ts`、`cleanup-versions.ts` 等模式生产链路脚本零测试。这些脚本直接产出 OSS 分发物（pattern shard），出错即影响所有用户。
- Files: `scripts/`（除 `pattern-uploader.ts` 外全部）、`tests/scripts/`
- Impact: pattern 生成逻辑回归只能靠端到端人工验证（watch-patch 流程）。
- Fix approach: 优先为 `pattern-gen.ts` 的锚点生成与 `platform-artifacts.ts` 的平台矩阵逻辑补单元测试（核心逻辑多在 `src/core/` 已有测试覆盖，脚本层主要测编排与 IO 参数）。

## 已知问题（行为性缺陷）

**restore 链路与现行 patch 架构脱节，正常使用下必然失败：**
- Symptoms: `ccx restore` 依赖 `BackupService.restore` 从 `~/.cc-expand/backups/` 恢复系统 binary，但现行 patch 流程（`PatchApplier`）是「源缓存只读（`~/.cc-expand/packages/<version>/bin/claude`）+ 拷贝生成 `~/.cc-expand/bin/claude-<shortVer>`」，从不改写渠道安装的 binary，也从不调用 `BackupService.backup`（全仓搜索确认仅测试调用）。backups/ 目录永远为空 → restore 必报 `BACKUP_NOT_FOUND`。
- Files: `src/services/backup.ts`、`src/cli/commands/restore.ts`、`src/core/verifier.ts`（失败建议语 `"Run 'cc-expand restore' to revert"` 误导）、`src/core/bytecode-patch-engine.ts`（verify 失败建议语同）
- Trigger: 任何按建议执行 `ccx restore` 的用户。
- Workaround: 无需 restore——现行架构下重新 `ccx patch` 或删除 `~/.cc-expand/bin/` 下的产物即可；真正的「还原」是不再使用快捷方式。
- 建议：要么移除 restore 命令与 `BackupService`（架构已不需要），要么重定义 restore 语义为「删除 patched binary + 恢复 shell 快捷方式指向原 binary」（后者已有 `maintainShellShortcutsToOriginal` 基础设施）。

## 安全考量

**OSS 上传凭证为长期 AccessKey 明文存放 .env：**
- Risk: `scripts/oss-upload.ts`、`watch-patterns.ts`、`oss-verify.ts` 从仓库根 `.env` 读取 `AccessKeyID`/`AccessKeySecret`（主 AK 形态、长期凭证、无 STS 临时凭证）。凭证泄露 = bucket 写权限泄露，可向所有用户分发恶意 pattern。
- Files: `scripts/oss-upload.ts`（`loadEnv`）、`scripts/watch-patterns.ts`、`scripts/pattern-uploader.ts`
- Current mitigation: `.env` 已被项目 `.gitignore` 的 `# Secrets` 段排除（已确认存在该文件，内容未读取）。
- Recommendations: 换 RAM 子账号 + 仅 `oss:PutObject`（限定 `cc-expand` bucket 前缀）最小权限；考虑 STS 临时凭证；上传端可引入对象签名或内容校验（当前 `plugin:verify-silence` 已做 MD5 核验闭环，可推广到 pattern 通道）。

**ccx run 硬编码 --dangerously-skip-permissions：**
- Risk: `run.ts` 启动 patched binary 时固定附加 `--dangerously-skip-permissions`，跳过 Claude Code 全部权限确认。
- Files: `src/cli/commands/run.ts`（`doSpawn(binaryPath, ['--dangerously-skip-permissions'], ...)`）
- Current mitigation: 无（shell 快捷方式 `cc()` 底层也走 `run --print-binary` 定位后自行 spawn，但 run 命令本身带此 flag）。
- Recommendations: 改为可配置（user-config）或文档显著声明；至少在 `ccx setup` 生成快捷方式时告知用户该行为。

**第三方 plugin shard 无内容安全边界（ADR 0003 第 7 条立场）：**
- Risk: installed plugin 的 shard 内容只有结构校验（`isValidPatchItem`，`src/services/plugin-patches.ts`），文本锚点可改写 binary 内任意等长 JS 源码（含移除权限提示，ADR 0003 的 cc-flow 即是此用途），无审核/分级机制。`src/services/plugins-manager.ts` 的 `add` 也不锁 ref（`owner/repo@ref` 是 ADR 列出的未来扩展），作者 push 即影响用户下一次 patch。
- Files: `src/services/plugin-patches.ts`、`src/services/plugins-manager.ts`、`src/cli/commands/plugins.ts`
- Current mitigation: 文档声明「工具中立，author/用户自担」（ADR 0003、README）。
- Recommendations: 保持立场的前提下，考虑在 `ccx plugins add` 回显 shard 将修改的内容摘要（patch item desc 列表），让用户确认行为可见。

**PatternService / shard 拉取的 fetch 无超时：**
- Risk: `fetchVersionPattern`/`fetchVersionsIndex`（`src/services/pattern.ts`）与 `collectPluginContext` 的第三方 `shardBaseUrl` 拉取均使用裸 `fetch` 无 AbortController。OSS 或恶意/故障的第三方 shard host 挂起时，`ccx patch`/`migration` 无限等待。对比 `src/services/latest-checker.ts` 有显式 4s 超时设计（且注释说明了为什么）。
- Files: `src/services/pattern.ts`、`src/services/plugin-patches.ts`
- Recommendations: 统一给 pattern/shard fetch 加 AbortSignal.timeout（如 10s），超时走既有降级路径（本地缓存/discovery 兜底）。

**macOS codesign 为 ad-hoc 签名：**
- `codesign --sign - --force --deep`（`src/services/patch-applier.ts`）是无身份的 ad-hoc 签名，满足本机 AMFI 执行要求，但不提供分发级信任。这是设计选择（ADR 0002 的等长约束实验基础），仅记录，无需改动。

## 性能瓶颈

**215MB binary 的多轮全量扫描：**
- Problem: 一次 patch 至少三轮全量扫：`PatchEngine.patch` 内对每个 patch item 独立 `buffer.indexOf` 全扫（N items × 215MB）；`BytecodePatchEngine.patch` 对每个锚点再全扫；`Verifier.verify` 重新 `readFileSync` 后逐 item 再扫一遍 + bytecode verify 再扫。
- Files: `src/core/patch-engine.ts`、`src/core/bytecode-patch-engine.ts`、`src/core/verifier.ts`、`src/services/patch-applier.ts`
- Cause: 引擎按 item 独立扫描，未做单趟多模式匹配；verify 重新读盘而非复用内存 buffer。
- Improvement path: 单趟扫描聚合全部 needle（AC 自动机或排序跳跃表）；verify 复用 execute 已持有的 buffer。当前 8 个 item 左右的规模在秒级可完成，属「可感知但不致命」，优先级低，但 item 数随插件增长会线性放大。

**全量载入内存：**
- `readFileSync` 两次持有 215MB buffer（execute 一次、verify 一次）。Node 默认堆下可承受，注意不要在单进程内叠加多个版本操作（migration 批量循环是串行释放的，当前安全）。

## 脆弱区域

**pattern-discovery 启发式（版本耦合最重处）：**
- Files: `src/core/pattern-discovery.ts`
- Why fragile: `EXPECTED_ANCHOR_COUNTS = [5, 6, 7, 8]` 与 `COMPANION_SIGNATURES`（32000/128000/1e6/1536/26214400/50000000/50/64//memories）均为硬编码，注释自带演变史（2.1.205→5、206–209→7、210→6、218→8、227 起表达式噪声过滤）。CC 新版本锚点数变为 9、或上游改模型表/预算常量使签名失效，都会抛 `PATTERN_DISCOVERY_FAILED`。它在两条路径上被依赖：pattern-gen 生产链路（`scripts/pattern-gen.ts`）与 OSS pattern 缺失时的 patch 兜底（`src/services/patch-applier.ts` `prepare`）。
- Safe modification: 调整锚点计数/签名时必须先对真实 binary 跑 `pnpm pattern:gen <version> --from-extracted` 实证；守卫触发即人工核对，属预期 fail loud 设计。
- Test coverage: `tests/core/pattern-discovery.test.ts` 用构造 fixture，不覆盖真实 binary 结构突变场景。

**bytecode 锚点与 silence 操作码的 per-version 实证维护：**
- Files: `src/core/bytecode-anchor-discovery.ts`、`src/core/silence-guard-discovery.ts`、`scripts/plugin-silence-gen.ts`
- Why fragile: 锚点由 pattern-gen 按「版本 × 平台」生成且仅对已实证组合存在（`versions.json` 的 `bytecodePlatforms` 标注）；silence 的指令骨架 `[0x52,0x07,0x11,0x06,0x6a,0x12]` 是 v2.1.285 实测值，且 CC 的 bun 是内部 fork、禁用 bytecode dump，「跨版本漂移无法预测」（源码注释原文）。每个 CC 新版本都需要人工跑 watch-patch 流程重新生成+实证。
- Safe modification: 任何发现器改动都要求 binary 级 patch+verify 实证后才写入 pattern（现有流程已强制）；发现器内所有不确定路径 throw 不降级（已实现）。
- Test coverage: `tests/core/bytecode-anchor-discovery.test.ts` 的 golden test 为 `describe.skipIf(!binaryExists)`——依赖本地真实 binary，CI 上不执行。

**recordPatchedCombo 与 binary 产物的一致性窗口：**
- Files: `src/services/patch-applier.ts`（execute 末尾 `recordPatchedCombo`）、`src/services/config.ts`
- Why fragile: binary 已写入并验证成功后，若 `versions.json` 读改写失败（文件损坏见技术债条目），命令 exit 1 但 patched binary 已存在。状态分裂：`status`/`migration` 看不到该 combo，`~/.cc-expand/bin/` 里却有产物。
- Safe modification: 失败重试 patch 即自愈（幂等覆盖产物）；改动记录顺序（先记后写 binary）反而引入「记录了但产物缺失」的更差状态，维持现状 + 修复配置层容错即可。

**patch 成功后无条件覆盖 channel.json 为 local：**
- Files: `src/cli/commands/patch.ts`（`saveChannel({ channel: 'local', ... })`）、`src/services/channel-config.ts`
- Why fragile: 用户原渠道是 brew/npm-global 时，一次 patch 后 channel.json 永久指向 local（快照版本）。用户随后用 brew 升级 CC，系统 binary 已是新版本，而 ccx 的 active version 仍停旧版——`status` 按 active version 报告（CONTEXT.md 明确的语义），状态与系统真实状态脱节；`migration` 的默认源版本也取自 channel。
- Safe modification: 这是保证 shell 快捷方式版本校验基准的有意设计；改动需同步 `status` 增加「系统版本 ≠ active 版本」的提示（对照 DiscoveryService 的 PATH 探测），而非改写 channel 语义。

## 扩展上限

**pattern/shard 生产链路为单人运维流：**
- Current capacity: pattern 覆盖版本列表见 OSS `versions.json`（`src/services/pattern.ts` 消费）；生成依赖 macOS 主机跑 `pnpm pattern:gen <version>`（多平台 binary 下载解压 + 锚点实证在本机平台）+ watch-patch 技能流程。
- Limit: CC 发版节奏快时 pattern 滞后窗口存在；滞后窗口内 2.1.246+ 版本会落入「discovery 兜底文本替换成功 + `bytecodeAnchorMissing` 警告（运行时实际不生效）」状态（`src/services/patch-applier.ts`、`src/cli/commands/patch.ts` `buildPatchWarnings`）。bytecode 锚点没有本地兜底（锚点只能由实证生成）。
- Scaling path: 短期靠警告文案引导用户等待；长期考虑 CI 化 pattern 生产（GitHub Actions 多平台 runner 实证），或按 ADR 0003 的「metavariable 结构化匹配」降低 per-version 维护成本。

**OSS bucket 单点：**
- Current capacity: 阿里云 oss-cn-shanghai，公共读（`https://cc-expand.oss-cn-shanghai.aliyuncs.com/patterns/`），客户端直连 fetch。
- Limit: bucket 不可用时 pattern 拉取失败，但链路有韧性：ETag 本地缓存（`~/.cc-expand/cache/patterns/`）+ 5xx 降级缓存 + pattern 缺失时本地 discovery 兜底（pre-bytecode 版本可用，bytecode 版本受限，见上）。
- Scaling path: 如需多区域/多 CDN，`PatternService.baseUrl` 已可注入，改造面小。

## 风险依赖

**上游 npm 包结构假设（@anthropic-ai/claude-code）：**
- Risk: `PackageService.install` 假设 wrapper 包 + `optionalDependencies` 平台包 + tarball 内 `bin/claude(.exe)` 布局（`src/services/package.ts`）。上游改分发方式（如放弃 npm 仅 native installer）即断链。
- Impact: `ccx install`/`patch`/`migration` 全链路不可用。
- Migration plan: 无官方替代源；届时需按新分发方式重写下载层（接口已收敛在 `PackageService`，改动面可控）。

**claude-discovery 手工路径表：**
- Risk: `src/services/claude-discovery.ts` 维护 50+ 条安装路径 glob（源自 tweakcc 社区经验，注释明示），包管理器目录约定演进会漂移。
- Impact: 兜底扫描漏检；有 PATH 探测兜底（`DiscoveryService`），实际漏检概率低。
- Migration plan: 保持「PATH 优先、路径表兜底」的次序即可，无需主动扩充。

**运行时依赖面（低风险）：**
- dependencies 仅 `cac`/`semver`/`tar`/`@inquirer/*`/`picocolors`（`package.json`），无重依赖；`ali-oss` 在 devDependencies 仅上传脚本用。注意 `src/utils/version.ts` 手写 `isVersionGreater`（正则取数字逐位比较）与 `semver` 包并存两套比较逻辑——预发布标签（如 `2.1.250-beta`）在手写版被当 `2.1.250` 处理，update-check 用 semver 包语义，二者边界场景结论可能不一致。

## 缺失的关键能力

**restore 语义重定义（见「已知问题」）：** 现有命令名保留但行为失效，用户按错误建议操作会困惑。

**plugins add 无版本锁定：** `owner/repo` 不支持 `@ref`（ADR 0003 列为未来扩展），无法 pin 到 commit/tag，作者 repo 变更即透传到用户下次 patch。

**Windows 真机验证缺失：** `docs/qa/2026-06-10-windows-compatibility-analysis.md` 列出的 6 个问题在代码层已修（`src/services/package.ts` 的 `npm.cmd` + `shell: true`、`src/services/patch-applier.ts` `getPatchedBinaryName` 的 `.exe`、`src/services/shell-codegen.ts` 的 win32 分支），但该文档的验证 checklist 未有自动化回归，CI 与 e2e 均在 macOS 执行；多平台仅做到 binary 下载矩阵（`scripts/platform-artifacts.ts`）与字节级锚点跨平台同构假设，runtime 级 Windows 验证靠用户报告。

## 测试覆盖缺口

**CI 跳过项：**
- `tests/integration/cli.test.ts`（`it.skip`，status 命令需可响应 `--version` 的真实 claude binary，CI 无）。
- `tests/core/bytecode-anchor-discovery.test.ts`（`describe.skipIf(!binaryExists)` 的 golden test，依赖本地真实 binary）。
- 影响：status 命令与锚点发现的真实 binary 路径只能本机验证。

**scripts 层：** 见技术债「scripts 目录大部分无测试」。

**已知 flaky（`docs/reports/260930/silence-unrecognized-model.md` 记录）：**
- worktree 长路径下 pager 测试 5s 超时（`--testTimeout 20000` 可过，非代码回归）；`prebuild` 内 DiscoveryService 5s 超时偶发。
- Files: `tests/cli/pager.test.ts`、`package.json`（prebuild 脚本）

**配置状态机端到端缺失：** channel.json 覆盖时序（patch → saveChannel）、versions.json 并发写、plugins.json 损坏恢复路径均无测试；上述「技术债」条目修复时应同步补 `tests/services/` 对应用例。

---

*关注点审计：2026-10-02*
