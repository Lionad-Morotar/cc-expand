# 编码约定（Coding Conventions）

**分析日期：** 2026-10-02

## 语言与类型规范

- TypeScript `strict: true`，target `ES2022`，module `NodeNext`（`tsconfig.json`；子包同款配置见 `packages/plugin-context-expand/tsconfig.json`）
- 源代码禁止 `any`；测试中允许 `as any` / `as unknown as XxxService` 用于注入手写 mock（实证：`tests/cli/commands/status.test.ts`）
- 类型导入两种写法并存，均可用：`import type { ConfigService } from '...'` 与内联 `import { ChannelConfig, type ChannelConfigData } from '...'`（`src/cli/commands/status.ts:11`）
- 相对导入必须带 `.js` 后缀（NodeNext 要求，源文件虽是 `.ts`，如 `from '../types/index.js'`）
- Node 内建模块一律用 `node:` 前缀：`node:fs`、`node:path`、`node:os`、`node:child_process`

## 代码风格

**无 lint/format 工具链：** 项目内不存在 `.eslintrc*`、`eslint.config.*`、`.prettierrc*`、`biome.json`。风格靠约定维持，正确性靠 `tsc --noEmit` 与测试保障（TDD 文档的验收标准即 `pnpm vitest run` + `pnpm tsc --noEmit` + `pnpm build` 三关，见 `docs/tdd/2026-06-26-cli-help-i18n.md`）。

实证出的统一风格（全库一致，新增代码必须跟随）：

- **无分号**（行尾不加分号）
- **单引号**字符串
- **2 空格缩进**
- **只用具名导出**：`export default` 在 `src/` 与 `scripts/` 中零使用
- 对象尾随逗号不强制（两种写法并存）

## 命名模式

**文件名：** 多词文件用 kebab-case，单词文件直接单词。

- 类文件去掉 Service/Engine 后缀取 kebab-case：`BackupService` → `src/services/backup.ts`；`PatchEngine` → `src/core/patch-engine.ts`
- 工具文件按功能命名：`src/utils/encode-token-literal.ts`、`src/utils/validate-target.ts`

**类：** PascalCase；业务服务加 `Service` 后缀（`DiscoveryService`、`ConfigService`、`PluginsManager`）；核心引擎加 `Engine` 后缀（`PatchEngine`、`BytecodePatchEngine`）

**函数：** 小驼峰；CLI 命令处理函数命名 `<name>Command`（`statusCommand`、`patchCommand`，见 `src/cli/commands/*.ts`）；私有辅助函数小驼峰（`buildMigrationHint`，`src/cli/commands/status.ts:52`）

**变量：** 小驼峰；常量 SCREAMING_CASE 仅用于模块级字面量（`EXIT_CODES`，`src/cli/result.ts:22`；测试夹具 `BC_ANCHOR_HEX`，`tests/services/patch-applier.test.ts:10`）

**类型：** interface/type PascalCase，不加 `I` 前缀（`PatchItem`、`CommandResult`、`OsPatterns`）

**测试文件：** 与被测文件同名 + `.test.ts`（`src/services/backup.ts` → `tests/services/backup.test.ts`）

## 注释规范

- **语言：** 注释一律中文；代码标识符、报错消息保持英文（抛给用户的 error message 是英文，如 `Backup not found for ...`，`src/services/backup.ts:37`）
- **文件头：** 每个文件一个 JSDoc 块说明职责（`src/cli/i18n.ts:1`「国际化（i18n）模块」）
- **Why 优先：** 注释解释隐含假设、折衷、unsound 之处，不复述代码。范例：`src/utils/version.ts:40`（解释为何少于两段判不更新）、`src/core/patch-engine.ts:16`（解释 latin1 截断为何必须 fail loud）、`src/cli/commands/status.ts:84`（解释为何 channel.json 损坏要吞掉）
- **函数 JSDoc：** 公开方法带 `@param` / `@returns` 中文说明（`src/services/backup.ts:10`）
- **接口字段：** 非自明字段逐个 JSDoc（`src/types/index.ts:23` bytecodePatterns 字段的三行说明）
- 禁止开发追踪标记（阶段号、编号引用）

## 架构分层约定

新增代码按层落位（层级间依赖方向：cli → services → core → utils/types）：

| 层 | 目录 | 职责 | 范例 |
|---|---|---|---|
| CLI | `src/cli/` | 命令解析（cac）、编排、渲染、i18n | `src/cli/commands/status.ts` |
| 服务 | `src/services/` | 业务逻辑（备份、发现、配置、插件管理） | `src/services/patch-applier.ts` |
| 核心 | `src/core/` | 纯算法引擎（无 IO，buffer 进 buffer 出） | `src/core/patch-engine.ts` |
| 工具 | `src/utils/` | 无状态纯函数 | `src/utils/version.ts` |
| 类型 | `src/types/` | 共享类型与错误码 | `src/types/index.ts` |

**命令返回结构化结果，不直接打印：** 命令函数返回 `CommandResult<T>`（`success/command/summary/data/next/warnings/error`，`src/cli/result.ts:6`），渲染统一交给 `src/cli/renderer.ts`，退出码经 `EXIT_CODES` 映射 BSD 风格（64/69/70/77）。

**错误约定：** 业务错误抛 `CcxError(code, message, suggestion)` 三参构造。`CcxError`/`ErrorCode` 的单一来源在子包 `packages/plugin-context-expand/src/ccx-error.ts`（ADR 0004），root 经 `src/types/index.ts` re-export 保持 `from '../types/index.js'` 导入路径不变——**新增错误码去子包加，不要在 root 另起一份**。引擎类 core 代码可返回 `{ success, error }` 结果对象而非抛错（`PatchEngine.patch()`）。

**依赖注入约定（最重要）：** 服务依赖经 options 参数注入，不在函数体内 new 死。范例 `src/cli/commands/status.ts:20`：

```typescript
export interface StatusOptions {
  discoveryService?: DiscoveryService
  configService?: ConfigService
  latestResolver?: (v: string) => Promise<string | undefined>  // 注入以避免网络
}
// 函数体内：const discovery = options?.discoveryService ?? new DiscoveryService()
```

为可测试性设计的注入点：网络类依赖一律抽象成可注入函数（`latestResolver`、`queryLatestVersion` 的 execFile 参数，`src/services/latest-checker.ts`）。

**核心引擎零业务知识：** `PatchEngine` 不认识 token 概念，等长替换字面量由调用方注入 `targetGenerator`（`src/core/patch-engine.ts:51`）。

## i18n 约定

- 所有用户可见文案（summary、error、warning、help）必须走 `t(key)`，键定义在 `src/cli/i18n.ts` 的 `I18nKey` 联合类型，en/zh 双份翻译
- 键命名空间：`command.<cmd>.<场景>`、`error.<cmd>.<场景>`、`warning.<场景>`、`help.command.*`、`help.global.*`
- 新增用户可见字符串时：先加键 → 补 en/zh 两份 → 代码里 `t()` 取值；help 的 Examples 保持英文命令示例不翻译

## 术语规范（强制）

`CONTEXT.md` 是项目强制术语表，写代码、注释、commit 前须对齐，重点区分：

- **channel**（CC 二进制安装渠道）≠ **install method**（cc-expand 自身的包管理器）——混用会让 self-update 执行错误命令
- **plugin**（管理/执行单元）≠ **pattern**（internal plugin 的 OSS 数据源）/ **shard**（installed plugin 的数据源）
- **update** 单独出现有三义（self-update / CC binary update / pattern update），表述时必须锁定

## 脚本与 pnpm script 命名

`package.json` scripts 遵循 `<域>:<动作>` 前缀约定：

```text
pattern:gen / pattern:upload / pattern:verify / pattern:verify-oss / pattern:latest-check / pattern:cleanup
plugin:gen-silence / plugin:upload-silence / plugin:verify-silence
dev:website / build:website        # 跨 workspace 子包
watch:patterns                      # 唯一 watch: 前缀（轮询守护）
test / test:unit / test:e2e / build / dev / release
```

运维脚本在 `scripts/`，用 `tsx` 直跑（无编译步骤），文件头部带中文用法注释（`scripts/pattern-gen.ts:1`）。脚本复用 `src/` 的服务类，不复制逻辑。

## 文档约定

- **ADR：** `docs/adr/NNNN-<slug>.md`，四位编号（现有 0001-0004）
- **TDD（技术设计文档）：** `docs/tdd/YYYY-MM-DD-<slug>.md`，按「DevGoal → 目标 → 验收标准 → 开发切片（Slice N）」组织，每个切片是完整可运行可测试的垂直切片，含对应测试改动（范例 `docs/tdd/2026-06-26-cli-help-i18n.md`）
- **计划/QA：** `docs/plans/`、`docs/qa/` 同样按日期前缀归档
- 文档语言中文；术语遵循 `CONTEXT.md`

## Git 约定

**Commit message：** Conventional Commits + 中文描述（实证 `git log`）：

```text
feat(core): patch 引擎与验证器按 latin1 单字节语义处理高位字节
fix(watch-patch): silence shard 生成默认复用解压缓存，上传后以 MD5 核验闭环
docs: CONTEXT.md 增补 Bytecode Pattern 术语
test: 补多合格候选与空 bytecode 区间 throw 护栏
refactor: extendToUnique 短路纯槽位扫描与三态计数
chore: 收敛 release 发布门禁链
release: v0.5.2
merge(flow-dev): <标题>（4 切片）
```

- 类型集：`feat / fix / docs / chore / test / refactor / release / merge`
- scope 可选：`core`、`plugin`、`watch-patch` 等；跨切面大改动可省 scope
- 分支模型 trunk-based（`develop` 日常开发，多切片经 `merge` no-ff 合入）

**版本与发布：** SemVer + Keep a Changelog（`CHANGELOG.md`，维护 `[Unreleased]` 区块；内部向变更加 `[internal]` 前缀）。发布走门禁链：`prebuild`（跑单测排除 e2e）→ `prerelease`（build）→ `release`（`pnpm publish` 锁官方 registry）。版本号默认不动，仅 release/patch 级自由调整；子包 `@cc-expand/plugin-context-expand` 用 alpha prerelease。

## 环境与构建

- Node `>=18.0.0`（`package.json` engines）；包管理器 pnpm（workspace 根 `pnpm-workspace.yaml`，子包 `packages/*`）
- 构建用 tsup（`tsup.config.ts`）：library 入口 `src/index.ts`（cjs+esm+dts），CLI 入口 `src/cli/index.ts`（cjs + shebang）；子包运行时代码 `noExternal` inline 进 dist（ADR 0003）——**新增 workspace 依赖若要进 dist，须加进 noExternal**
- 根目录存在 `.env` 与 `.npmrc`（凭证类文件，不要读取或提交其内容）

---

*约定分析：2026-10-02*
