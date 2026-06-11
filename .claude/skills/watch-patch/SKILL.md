---
name: watch-patch
description: 定时检索 Claude Code 新包，Patch 并发版
---

当 Claude Code 发布新版本时，自动发现新的混淆变量名并更新分片 pattern 文件。

## Context

* CC：Claude Code
* pattern: `<project-root>/patterns/*.json`（分片格式，按版本独立文件）
* pattern-index: `<project-root>/patterns/versions.json`（版本索引）
* watch-patch: 即本技能，`<project-root>/.claude/skills/watch-patch/SKILL.md`

## Workflow

0. 确保 `pnpm watch:patterns` 已在后台运行（首次执行需启动，持续监听 patterns/ 目录并自动上传变更到 OSS）
1. **interval**：每半小时使用 `pnpm view @anthropic-ai/claude-code` 获取 latest 的 CC 版本：
  1.1 pattern 包含当前版本则忽略，等待下一次扫描
  1.2 不包含则准备开始任务，允许越过版本执行，比如 latest v2.1.180 而 pattern 只包含 v2.1.160 那么直接从 180 开始
  1.3 暂停 interval，并创建通用子代理读取 `watch-patch` 技能并完成下列所有步骤（而你自己需要维持干净的 interval monitor 上下文）
2. 下载平台 tarball
  - 目标目录：`zRefs/claude-codes/tarballs/v{X.Y.Z}/`
  - 下载包：
    - `@anthropic-ai/claude-code@X.Y.Z`（wrapper）
    - `@anthropic-ai/claude-code-darwin-arm64@X.Y.Z`
    - `@anthropic-ai/claude-code-darwin-x64@X.Y.Z`
    - `@anthropic-ai/claude-code-win32-x64@X.Y.Z`
  - 如有 Linux 包，一并下载
3. 提取二进制
   - 创建目录：`<project-root>/zRefs/claude-codes/extracted/v{X.Y.Z}/{darwin-arm64,darwin-x64,win32-x64,wrapper}/`
   - `tar -xzf` 解压各 tarball 到对应目录
   - wrapper 包中可能包含冗余的 `bin/claude.exe`，删除之
4. 发现混淆变量名
   - 一般而言对每个平台二进制运行以下代码
     ```python
     for m in re.finditer(b'200000', data):
         ctx = data[m.start()-50 : m.end()+25].decode('latin-1')
         if ctx[ctx.find('200000')-1] == '=':
             print(ctx)
     ```
   - 通常发现 6 个模式：
     - MODEL_CONTEXT_WINDOW_DEFAULT（含 `=200000,=20000`）
     - teamMemorySync
     - MAX_TOOL_RESULTS_PER_MESSAGE
     - skill tool budget
     - other context limit
     - exceeds200k threshold（`>200000:!1}`）
5. 验证搜索字符串唯一性
   - 对每个候选 search 字符串执行 `data.count(search.encode())`
   - 必须严格等于 1，否则调整上下文长度重新构造
   - 注意：不同版本间 `other context limit` 结构可能变化（中间变量数量不同）
6. 模拟 patch 验证
   - 复制二进制到 bytearray
   - 按 `search.index(sourceValue)` 计算替换偏移
   - 写入目标值（如 `256000`）
   - 验证替换后原始 search 字符串不再出现（0 残留）
7. 创建分片 pattern 文件
   - 新建 `patterns/{X.Y.Z}.json`（无 `v` 前缀），内容为 shard 格式：
     ```json
     {
       "darwin": {
         "arm64": [{ "search": "...", "desc": "...", "sourceValue": "200000" }],
         "x64": [...]
       },
       "win32": { "x64": [...] },
       "linux": { "arm64": [...], "x64": [...] }
     }
     ```
   - **Shard 格式扁平化了 `platforms` 层级**（旧格式有 `platforms → os → arch`，新格式直接 `os → arch`）
8. 更新版本索引
   - 在 `patterns/versions.json` 中追加新条目：
     ```json
     { "version": "X.Y.Z", "platforms": ["darwin-arm64", "darwin-x64", "win32-x64", "linux-arm64", "linux-x64"] }
     ```
   - 保持 JSON 数组格式，注意逗号分隔
9. 验证 OSS 同步
   - `pnpm watch:patterns` 会自动检测到新增/变更的分片文件并上传到阿里云 OSS
   - 确认终端输出 `[UPLOAD] patterns/{X.Y.Z}.json` 和 `[UPLOAD] patterns/versions.json`
10. 运行全量测试
    - `npx vitest run` 验证 CLI 命令正常工作
11. 子代理向你返回当前处理的版本号
12. 恢复 interval


## 注意事项

- **分片格式 vs 旧格式**：`patterns/v{X.Y.Z}.json` 直接是 `{ os: { arch: [...] } }`，不再包裹 `platforms` 层级
- `pnpm watch:patterns` 必须在后台运行，否则分片文件变更不会同步到 OSS
- 代码混淆变量名每次发布都会变化，同一版本的不同平台也互不相同
- 目标值位数必须与原始值相同（`200000` → `256000`，6 位）
- 当版本跨度较大时，常量周围的上下文结构可能改变，不能机械复制上一版本的 search 字符串
- **无需发版**：patterns 通过 OSS 动态拉取，更新分片文件后用户即可获取最新 pattern，不需要发布 npm 包
