# Workflows

为 Claude Code 新版本生成 pattern shard 的步骤。核心逻辑已固化为脚本（`src/core/pattern-discovery.ts` 等），子代理只需调用命令；仅当脚本因结构突变 exit 非 0 时才需人工介入。

## 前置

无需持续监听进程。`pattern:upload` 提供事件驱动的一次性上传；`watch:patterns` 持续监听在会话后台不可靠（被 SIGTERM 杀掉，exit 143），仅作可选补充。

## 主流程

```bash
pnpm pattern:gen <version>     # 生成 patterns/{version}.json + 更新 versions.json
pnpm pattern:upload <version>  # 一次性上传 shard + versions.json 到 OSS
```

`pattern:gen` = 文本锚点发现 + patch 模拟 + bytecode 锚点自动生成与 binary 级模拟实证（仅 2.1.246+）：

1. 下载各平台 tarball（`@anthropic-ai/claude-code-{platform}@<version>`）并解压
2. PatternDiscovery：对每个平台二进制发现 6 个上下文窗口锚点（贪婪多字段，每条 count==1）
3. desc 启发式归类
4. patch 模拟（替换 200000→256000，验证 0 残留）
5. bytecode 锚点自动生成与实证（仅 2.1.246+）：以 200000/32000/128000 语义主项为输入，从目标模块 bytecode 常量池发现字节锚点（伴生扩展至全 binary 唯一），再对副本做 binary 级 patch→verify 实证，实证不过不配锚点
6. 写 patterns/{version}.json + 更新 patterns/versions.json（bytecodePlatforms 仅列实证平台）

`pattern:upload` 复用 PatternUploader（内容 hash 去重 + 持久化缓存 + 指数退避重试），上传 patterns/{version}.json 与 patterns/versions.json。

## 验证

```bash
pnpm pattern:verify-oss <version>   # 确认 shard 与 versions.json 已上传且内容一致(MD5)
npx vitest run tests/cli             # 针对性单测（加超时）
```

可选回归：`pnpm pattern:verify [version...]`，对 zRefs 已解压版本断言 PatternDiscovery 产出与现网 shard patch 等价（200000 字节同位置）。

## 人工兜底：pattern:gen 失败时

脚本抛 `PATTERN_DISCOVERY_FAILED` 表示二进制结构突变（=200000 锚点数≠5，或 exceeds200k 阈值 count≠1）。诊断步骤：

1. 在二进制上搜索锚点：`rg -a -o '[A-Za-z0-9_$]+=200000' <binary> | sort | uniq -c`，核对数量与变量名
2. 检查 `>200000:!1}` 是否仍存在且唯一
3. 判断是否出现新模式（第 7 个锚点）或旧模式消失
4. 若结构确实变化，调整 PatternDiscovery 的不变量（EXPECTED_ANCHOR_COUNT）或手动生成 shard

## 人工兜底：bytecode 锚点失败时

2.1.246+ 的 pattern:gen 输出 `⚠ <平台> bytecode 锚点失败` 警告（或「锚点降级: 未找到 200000/32000/128000 语义主项」）表示该平台未产出 bytecode 锚点，仅文本 pattern，运行时可能不生效。诊断步骤：

1. 用 `tsx zRefs/parse-graph.mjs <binary-path> <segment-offset>` 手工定位复核：binary 位于 `zRefs/claude-codes/extracted/v<version>/<os>-<arch>/package/<binary>`（如 `zRefs/claude-codes/extracted/v2.1.250/darwin-arm64/package/claude`；少数历史布局无 `package/` 一级，findBinary 兼容两种），`<segment-offset>` 为 `__BUN` 段 fileoff（otool 读取）
2. 注意 pattern:gen 成功后会清理 `extracted/v<x>/` 与 `tarballs/` 中发布超 7 天的缓存——事后回顾诊断时 binary 常已被删，先确认目录仍存在；已清理则重新 `npm pack` 下载，或生成时改用 `--from-extracted` 保留
3. 确认属锚点布局漂移（Bun 编译器常量去重/布局变化）而非签名误判后，上报 cc-expand 维护者
4. 锚点发现是 fail loud 的：唯一性硬约束下任何不确定性直接 throw，拒绝产出锚点而非产出错误锚点；实证事实参照——2.1.250 五平台（darwin-arm64/darwin-x64/linux-arm64/linux-x64/win32-x64）已全部自动产出锚点

## 已知版本结构差异

| 版本范围 | 差异 |
|---|---|
| 2.1.161–168 | 仅 3 平台（darwin-arm64/x64, win32-x64），无 Linux 包 |
| 2.1.169+ | 5 平台（含 linux-arm64/x64） |
| 2.1.178 | `other context limit` 伴生字段从 `N=3,v=3` 突变为 `20000,32000`；MODEL 与 other 共享 `ct=200000,qZ_=20000` 物理段（贪婪算法天然处理重叠） |
| 2.1.246+ | JS 常量内联 bytecode 常量池，运行时执行常量池内联字节，仅文本替换不生效，需 bytecode 锚点；锚点布局跨版本可能漂移，唯一性硬约束兜底（拒绝产出锚点而非错 patch） |
| 各版本 | exceeds200k 阈值偶需变量前缀才唯一（如 `K)>200000:!1}`），PatternDiscovery 规范化为裸 `>200000:!1}`（9 版本验证 count==1） |

## desc 归类说明

PatternDiscovery 不产 desc（语义归类脆弱）；pattern:gen 启发式归类：

- teamMemorySync（伴生 1536）
- MAX_TOOL_RESULTS_PER_MESSAGE（伴生 50）
- MODEL_CONTEXT_WINDOW_DEFAULT（独立 =20000）
- exceeds200k threshold（>200000）
- skill tool budget 与 other context limit 难靠伴生数值区分，兜底 context-window-limit

patch 引擎只用 search + sourceValue，不依赖 desc，故归类误判不影响 patch 功能，仅影响可读性。
