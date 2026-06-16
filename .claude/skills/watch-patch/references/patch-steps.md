# Workflows

为 Claude Code 新版本生成 pattern shard 的步骤。核心逻辑已固化为脚本（`src/core/pattern-discovery.ts` 等），子代理只需调用命令；仅当脚本因结构突变 exit 非 0 时才需人工介入。

## 前置

确保 `pnpm watch:patterns` 后台进程运行（监听 patterns/ 目录，自动上传变更到 OSS）。

## 主流程：一条命令

```bash
pnpm pattern:gen <version>
```

脚本自动完成：

1. 下载各平台 tarball（`@anthropic-ai/claude-code-{platform}@<version>`）并解压
2. PatternDiscovery：对每个平台二进制发现 6 个上下文窗口锚点（贪婪多字段，每条 count==1）
3. desc 启发式归类
4. patch 模拟（替换 200000→256000，验证 0 残留）
5. 写 patterns/{version}.json + 更新 patterns/versions.json

产出后 watch:patterns 自动上传 OSS。

## 验证

```bash
pnpm pattern:verify-oss <version>   # 确认 shard 与 versions.json 已上传且内容一致(MD5)
npx vitest run                       # 全量测试
```

可选回归：`pnpm pattern:verify [version...]`，对 zRefs 已解压版本断言 PatternDiscovery 产出与现网 shard patch 等价（200000 字节同位置）。

## 人工兜底：pattern:gen 失败时

脚本抛 `PATTERN_DISCOVERY_FAILED` 表示二进制结构突变（=200000 锚点数≠5，或 exceeds200k 阈值 count≠1）。诊断步骤：

1. 在二进制上搜索锚点：`rg -a -o '[A-Za-z0-9_$]+=200000' <binary> | sort | uniq -c`，核对数量与变量名
2. 检查 `>200000:!1}` 是否仍存在且唯一
3. 判断是否出现新模式（第 7 个锚点）或旧模式消失
4. 若结构确实变化，调整 PatternDiscovery 的不变量（EXPECTED_ANCHOR_COUNT）或手动生成 shard

## 已知版本结构差异

| 版本范围 | 差异 |
|---|---|
| 2.1.161–168 | 仅 3 平台（darwin-arm64/x64, win32-x64），无 Linux 包 |
| 2.1.169+ | 5 平台（含 linux-arm64/x64） |
| 2.1.178 | `other context limit` 伴生字段从 `N=3,v=3` 突变为 `20000,32000`；MODEL 与 other 共享 `ct=200000,qZ_=20000` 物理段（贪婪算法天然处理重叠） |
| 各版本 | exceeds200k 阈值偶需变量前缀才唯一（如 `K)>200000:!1}`），PatternDiscovery 规范化为裸 `>200000:!1}`（9 版本验证 count==1） |

## desc 归类说明

PatternDiscovery 不产 desc（语义归类脆弱）；pattern:gen 启发式归类：

- teamMemorySync（伴生 1536）
- MAX_TOOL_RESULTS_PER_MESSAGE（伴生 50）
- MODEL_CONTEXT_WINDOW_DEFAULT（独立 =20000）
- exceeds200k threshold（>200000）
- skill tool budget 与 other context limit 难靠伴生数值区分，兜底 context-window-limit

patch 引擎只用 search + sourceValue，不依赖 desc，故归类误判不影响 patch 功能，仅影响可读性。
