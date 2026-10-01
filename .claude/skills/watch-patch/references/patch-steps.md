# Workflows

为 Claude Code 新版本生成 pattern shard 的步骤。核心逻辑已固化为脚本（`src/core/pattern-discovery.ts` 等），子代理只需调用命令；
仅当脚本因结构突变 exit 非 0 时才需人工介入。

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
5. bytecode 锚点自动生成与实证（仅 2.1.246+）：以 200000/32000/128000 语义主项为输入，从目标模块 bytecode 常量池发现字节锚点（伴生扩展至全 binary 唯一），
   再对副本做 binary 级 patch→verify 实证，实证不过不配锚点
6. 写 patterns/{version}.json + 更新 patterns/versions.json（bytecodePlatforms 仅列实证平台）

`pattern:upload` 复用 PatternUploader（内容 hash 去重 + 持久化缓存 + 指数退避重试），上传 patterns/{version}.json 与 patterns/versions.json。

## 主流程（续）：silence 插件 shard

token pattern 完成后顺带产出 silence-unrecognized-model 插件的 per-version shard（消音 unrecognized_model 告警的第一方插件）：

```bash
pnpm plugin:gen-silence <version>     # 生成 plugin-shards/silence-unrecognized-model/{version}.json + versions.json
pnpm plugin:upload-silence <version>  # 上传到 OSS plugins/silence-unrecognized-model/ 前缀
```

`plugin:gen-silence` = 指令骨架扫描 + runtime 探活判别：

1. 复用 pattern:gen 已下载解压的平台 binary（也可 `--from-extracted <dir>` 离线跑）
2. silence-guard-discovery：模块 signature（`unrecognized-model-signal:`）定位 → bytecode 内搜 guard 指令骨架
   （`52 07 11 06 6a 12`，操作码为实测锚）→ 上下文扩展至全 binary 唯一，产出 literal patch 候选
3. 本机平台 runtime 探活：先验证探针环境（未 patch 副本必须出现告警），再逐候选 patch 副本跑 CLI 探针，
   命中判据双证（告警消失且应答正常）；探针超时/无应答 fail loud
4. 其余平台按锚字节序列对齐（各平台 blob 布局不同构，blob 内偏移不可对齐；锚字节跨平台一致且唯一，2.1.285 五平台实证）
5. patch 模拟实证后写 shard（只落 PatchItem 契约字段）

探活探针用 `ANTHROPIC_MODEL=glm-5.3`（非白名单模型触发告警），每次探针真实调一次 API，全流程最多约 10 次小请求。

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

## 人工兜底：silence shard 生成失败时

`plugin:gen-silence` 的 throw 都是 fail loud，两类信号：

1. `signature 未命中` / `无指令骨架，操作码或常量池布局已漂移`：CC 的 bun fork 改了指令编码或常量池布局。
   需重新逆向（差分编译方法论：bun 1.4.2 `--compile --bytecode` 对照 + 操作数骨架搜索 + runtime 消音判别），
   更新 src/core/silence-guard-discovery.ts 的骨架常量后重跑
2. `全部 N 个候选探活未命中` / `告警消失但 CLI 无应答`：告警发射器不在同形候选内，或 patch 破坏执行。
   先用未 patch binary 复核告警仍可复现（探针环境有效），再人工逐候选定位

## 人工兜底：bytecode 锚点失败时

2.1.246+ 的 pattern:gen 输出 `⚠ <平台> bytecode 锚点失败` 警告（或「锚点降级: 未找到 200000/32000/128000 语义主项」）表示该平台未产出 bytecode 锚点，
仅文本 pattern，运行时可能不生效。诊断步骤：

1. 用 `tsx zRefs/parse-graph.mjs <binary-path> <segment-offset>` 手工定位复核：
   binary 位于 `zRefs/claude-codes/extracted/v<version>/<os>-<arch>/package/<binary>`（
   如 `zRefs/claude-codes/extracted/v2.1.250/darwin-arm64/package/claude`；少数历史布局无 `package/` 一级，findBinary 兼容两种），
   `<segment-offset>` 为 `__BUN` 段 fileoff（otool 读取）
2. 注意 pattern:gen 成功后会清理 `extracted/v<x>/` 与 `tarballs/` 中发布超 7 天的缓存——事后回顾诊断时 binary 常已被删，先确认目录仍存在；已清理则重新 `npm pack` 下载，
   或生成时改用 `--from-extracted` 保留
3. 确认属锚点布局漂移（Bun 编译器常量去重/布局变化）而非签名误判后，上报 cc-expand 维护者
4. 锚点发现是 fail loud 的：唯一性硬约束下任何不确定性直接 throw，拒绝产出锚点而非产出错误锚点；实证事实参照——2.1.250 五平台（
   darwin-arm64/darwin-x64/linux-arm64/linux-x64/win32-x64）已全部自动产出锚点

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
