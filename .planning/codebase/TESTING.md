# 测试规范（Testing Patterns）

**分析日期：** 2026-10-02

## 测试框架

**Runner：**
- Vitest `^2.0.0`（`package.json` devDependencies）
- 配置：`vitest.config.ts` —— 全部关键设置在 11 行内：

```typescript
export default defineConfig({
  test: {
    globals: true,              // 全局注入 describe/it/expect，但测试文件仍显式 import（见下）
    environment: 'happy-dom',   // 全局 DOM 环境（website banner 接口测试所需）
    pool: 'forks',              // 进程池隔离——binary patch 测试不改进程状态，必需
    exclude: [...configDefaults.exclude, 'tests/website/**', 'zRefs/**'],
  },
})
```

**约定：尽管 `globals: true`，每个测试文件仍显式 `import { describe, it, expect } from 'vitest'`**（全部 58 个测试文件实证一致），新增测试跟随此写法。

**Assertion Library：** Vitest 内置 `expect`。

**无 lint/覆盖率门禁：** 无 coverage 配置（`.gitignore` 预留 `coverage/` 但无脚本）；正确性门禁是 `pnpm vitest run` + `pnpm tsc --noEmit` + `pnpm build` 三关（TDD 文档验收标准实证）。

## 运行命令

```bash
pnpm test                # vitest watch 模式（开发时）
pnpm vitest run          # 全量单测一次跑完（TDD 验收命令）
pnpm test:unit           # vitest run tests/cli —— 仅 CLI 层单测
pnpm test:e2e            # pnpm build && vitest run tests/integration —— e2e，内置 build 前置
pnpm build               # tsup 构建；其 prebuild 钩子自动跑 vitest run --exclude tests/integration
cd packages/plugin-context-expand && pnpm test   # 子包测试（vitest run，作用域限子包）
```

**e2e 环境要求（硬前置）：** `tests/integration/cli.test.ts` 用 `execFileSync('node', [CLI_PATH])` 直接执行 `dist/cli.js`（`tests/integration/cli.test.ts:7`），**`dist/` 不存在时该文件必然失败**。单独跑 e2e 文件前必须先 `pnpm build`（或直接用 `pnpm test:e2e` 自动串行）。

**构建门禁链：** `pnpm build` 会先触发 `prebuild`（全量单测，排除 `tests/integration`），测试不过则构建被阻断。

**目录排除说明：** `tests/website/**`（website 是独立部署产物，不在 npm 包测试范围）与 `zRefs/**`（调试参考目录）被根配置排除；`packages/plugin-context-expand/tests/` 不在排除列表，根 `pnpm vitest run` 会一并执行。

**视觉回归（vitest 体系外）：** `scripts/visual-regression.ts`，playwright + pixelmatch 截图对比，参考图 `zRefs/banner.png`，产物 `packages/website/.output/public`（需先 `pnpm build:website`）。

## 测试目录划分

测试镜像 `src/` 分层，放根目录 `tests/`（非就地 co-located）：

```text
tests/
├── cli/                  # CLI 层单测（进程内，不依赖 dist）
│   ├── commands/         # 15 个命令各一个 .test.ts，与 src/cli/commands/ 一一对应
│   ├── i18n.test.ts / pager.test.ts / renderer.test.ts / result.test.ts
│   ├── update-check-runner.test.ts / version-line.test.ts
├── core/                 # 核心引擎单测（纯 buffer 算法）
│   ├── patch-engine.test.ts / bytecode-patch-engine.test.ts / verifier.test.ts
│   ├── binary-sections.test.ts / pattern-discovery.test.ts
│   ├── bytecode-anchor-discovery.test.ts / silence-guard-discovery.test.ts
│   ├── standalone-graph.test.ts
│   └── helpers/binary-fixtures.ts    # 共享二进制 fixture 工厂（见下）
├── services/             # 服务层单测（16 个），与 src/services/ 一一对应
├── utils/                # 纯函数单测（5 个）
├── scripts/              # 运维脚本单测（pattern-uploader.test.ts）
├── integration/          # e2e（见「单测/e2e 界线」）
└── website/              # 被 vitest 排除（website 独立部署）
```

**新增测试放哪：** 给 `src/<layer>/<name>.ts` 写测试 → `tests/<layer>/<name>.test.ts`；给 `scripts/<name>.ts` 写 → `tests/scripts/<name>.test.ts`；CLI 命令 → `tests/cli/commands/<name>.test.ts`。

## 单测 / e2e 界线

| 维度 | 单测（tests/cli、core、services、utils、scripts） | e2e（tests/integration） |
|---|---|---|
| 运行方式 | vitest 进程内直接 import src | `execFileSync` 起子进程跑 `dist/cli.js` |
| build 前置 | 无 | **必须 `pnpm build`**（`test:e2e` 已内置） |
| 隔离手段 | `mkdtempSync` 临时目录 + `process.env.HOME` 覆盖 | 同左，另覆盖 `XDG_CONFIG_HOME`（`tests/integration/cli.test.ts:124`） |
| 网络 | 一律 mock（注入 resolver / fakeExec / stub fetch） | 只测本地可判定行为（help/version/错误码/退出码），不真实 patch 系统 binary |

**注意：`tests/integration/` 三个文件里只有 `cli.test.ts` 依赖 dist 产物**；`plugin-patch.test.ts` 与 `silence-plugin.test.ts` 虽在 integration 目录，实际是进程内端到端（直接 import src，配 stub fetch + 假 binary），不需要 build。它们放在 integration 是因为覆盖「manifest 注册 → shard 装载 → patch 执行 → 字节断言」全链路。

**e2e 断言风格：** 输出内容包含断言 + 退出码断言（BSD 码，如 `error.status).toBe(64)`，`tests/integration/cli.test.ts:42`）；需要失败场景时用 try/catch 包 `execFileSync` 捕 `error.stdout + error.stderr`。

## 测试结构

**Suite 组织：** 外层 describe 按类/模块名，内层 describe 按方法名，it 描述行为（英文为主，中文行为描述亦可，见 `tests/services/latest-checker.test.ts:60`）：

```typescript
// tests/services/backup.test.ts
describe('BackupService', () => {
  describe('backup()', () => {
    it('should copy binary to backup directory', async () => { ... })
  })
  describe('restore()', () => { ... })
})
```

**夹具生命周期：** `beforeEach` 建临时目录 + 写假 binary，`afterEach` 恢复环境 + `rmSync(recursive)` 清理：

```typescript
beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'cc-expand-test-'))   // 前缀带模块名便于辨认
  process.env.HOME = tempDir
})
afterEach(() => {
  process.env.HOME = originalHome        // 全局状态必须恢复
  rmSync(tempDir, { recursive: true, force: true })
})
```

**Arrange / Act / Assert：** 关键用例带三段式注释（中英混用均可，实证 `tests/core/patch-engine.test.ts:12`、`tests/scripts/pattern-uploader.test.ts:37` 中文版）。

**全局状态污染防护：** 改了模块级状态必须在 afterEach 还原——i18n 的 `setLocale('en')`（`tests/cli/i18n.test.ts:16`）、`vi.unstubAllGlobals()`（`tests/integration/silence-plugin.test.ts:44`）。

**错误断言两种模式：**
- 返回错误对象型（core 引擎）：`expect(result.error?.code).toBe(ErrorCode.PATTERN_NOT_FOUND)`
- 抛错型（service）：try/catch 捕获后断言 `caught` 实例与 `code`（`tests/services/backup.test.ts:59`），或 `toThrow`（全库 38 处）

## Mock 约定（本仓库最重要约定）

**禁用 `vi.mock` 模块级 mock（全库 0 处使用）。** 可测性靠源码的依赖注入 + 手写 mock 对象：

```typescript
// 手写 mock + vi.fn() + as unknown as 断言（tests/cli/commands/status.test.ts:25）
const mockDiscovery = {
  findClaudeBinary: vi.fn().mockResolvedValue('/path/to/claude'),
  getBinaryVersion: vi.fn().mockResolvedValue('2.1.170')
}
const result = await statusCommand({
  discoveryService: mockDiscovery as any,
  configService: mockConfig as any,
  latestResolver: async () => '2.1.170'   // 注入 resolver 避免真实网络
})
```

**回调式依赖注入：** 低层 API（execFile）以函数参数注入，fake 实现直接同步回调（`tests/services/latest-checker.test.ts:35`）：

```typescript
function fakeExec(stdout: string, error: Error | null = null) {
  return (_cmd: unknown, _args: unknown, _opts: unknown, cb: ExecCb) => cb(error, stdout)
}
await queryLatestVersion(4000, fakeExec('"2.1.178"') as any)
```

**fetch stub 仅限 shard 装载场景：** `vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: ... }))`，用后 `vi.unstubAllGlobals()`（`tests/integration/silence-plugin.test.ts:49`）。

**不使用 fake timers**（全库 0 处）：超时/轮询逻辑通过注入实现来测，不走 `vi.useFakeTimers`。

**What to mock：** 文件系统外的副作用全部 mock——网络、execFile、OSS put；文件系统用真实临时目录（不 mock node:fs）。
**What NOT to mock：** 被测类本身、core 引擎的 Buffer 操作、真实 fixture 文件。

## Fixtures 与工厂

**共享二进制 fixture：** `tests/core/helpers/binary-fixtures.ts` 手工构造最小合法 Mach-O / ELF / PE binary 与 StandaloneModuleGraph payload（不依赖真实 Claude Code binary），工厂函数 `makeXxx` 命名：

- `makeStandaloneGraph(modules, options)` → `{ payload, spans }`，`spans` 暴露各模块期望偏移供断言
- `makeMachO(sectionData)` / `makeELF(sectionData)` / `makePE(sectionData)` / `wrapSectionData(payload)`

**内联假 binary：** 简单场景直接字符串/Buffer 拼接，锚点常量提为模块级 SCREAMING_CASE：

```typescript
// tests/services/patch-applier.test.ts:10
const BC_ANCHOR_HEX = '{{tokens}}007d0000 00f40100 40420f00'.replace(/\s/g, '')
function fakeBinary(token = 200000): Buffer { /* 文本锚点 + bytecode 槽位拼接 */ }
```

**平台自适应夹具：** 涉及平台键的 shard 数据按当前主机生成（`[process.platform]: { [process.arch]: [...] }`，`tests/integration/silence-plugin.test.ts:32`），避免硬编码平台导致跨平台失败。

**真实数据转 fixture：** 来自真实 Claude Code 版本的锚点用 `\u00XX` 转义写入（含 `>=0x80` 高位字节），兼作 latin1 链路实证（`tests/integration/silence-plugin.test.ts:20`）。

**公共执行链封装：** 多用例共享的 prepare→execute 流程提为局部 helper（`runExecute()`，`tests/services/patch-applier.test.ts:26`），不要抽到全局除非跨文件复用。

## 测试类型全景

- **单元测试：** 51 个文件，进程内，秒级。utils/core 全覆盖，services/cli 近 1:1（60 个 src 文件 vs 58 个测试文件）
- **进程内端到端：** `tests/integration/plugin-patch.test.ts`、`silence-plugin.test.ts`——跨模块全链路（manifest → shard → patch → 字节断言）
- **CLI e2e：** `tests/integration/cli.test.ts`——子进程跑构建产物，断言 stdout/stderr 与退出码
- **视觉回归：** `scripts/visual-regression.ts`（vitest 外，playwright + pixelmatch）
- **不存在的类型：** 无浏览器 E2E 框架（playwright 仅用于截图对比）、无覆盖率门禁、无 CI 流水线（无 `.github/`）

## 常见模式速查

**异步测试：** 直接 `async/await`，it 回调声明 `async`（`tests/services/backup.test.ts:25`）。

**行为驱动的 it 命名：** 描述可观察行为而非实现（`'returns needWork=false when latest is already processed locally'`）。

**用例编号注释：** 少数文件用行号注释标记用例意图（`// B13: ...`，`tests/services/latest-checker.test.ts:6`）——历史产物，新测试不效仿，用清晰的 it 描述即可。

**Vitest workspace：** 不存在（无 `vitest.workspace.*`）；子包用自己的 `package.json` script（`vitest run`）独立跑。

---

*测试分析：2026-10-02*
