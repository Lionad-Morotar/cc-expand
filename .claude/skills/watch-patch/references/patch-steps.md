# Workflows

1. 下载平台 tarball
  - 目标目录：`zRefs/claude-codes/tarballs/v{X.Y.Z}/`
  - 下载包：
    - `@anthropic-ai/claude-code@X.Y.Z`（wrapper）
    - `@anthropic-ai/claude-code-darwin-arm64@X.Y.Z`
    - `@anthropic-ai/claude-code-darwin-x64@X.Y.Z`
    - `@anthropic-ai/claude-code-win32-x64@X.Y.Z`
  - 如有 Linux 包，一并下载
2. 提取二进制
   - 创建目录：`<project-root>/zRefs/claude-codes/extracted/v{X.Y.Z}/{darwin-arm64,darwin-x64,win32-x64,wrapper}/`
   - `tar -xzf` 解压各 tarball 到对应目录
   - wrapper 包中可能包含冗余的 `bin/claude.exe`，删除之
3. 发现混淆变量名
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
4. 验证搜索字符串唯一性
   - 对每个候选 search 字符串执行 `data.count(search.encode())`
   - 必须严格等于 1，否则调整上下文长度重新构造
   - 注意：不同版本间 `other context limit` 结构可能变化（中间变量数量不同）
5. 模拟 patch 验证
   - 复制二进制到 bytearray
   - 按 `search.index(sourceValue)` 计算替换偏移
   - 写入目标值（如 `256000`）
   - 验证替换后原始 search 字符串不再出现（0 残留）
6. 创建分片 pattern 文件
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
7. 更新版本索引
   - 在 `patterns/versions.json` 中追加新条目：
     ```json
     { "version": "X.Y.Z", "platforms": ["darwin-arm64", "darwin-x64", "win32-x64", "linux-arm64", "linux-x64"] }
     ```
   - 保持 JSON 数组格式，注意逗号分隔
8. 验证 OSS 同步
   - `pnpm watch:patterns` 会自动检测到新增/变更的分片文件并上传到阿里云 OSS
   - 确认终端输出 `[UPLOAD] patterns/{X.Y.Z}.json` 和 `[UPLOAD] patterns/versions.json`
9. 运行全量测试
    - `npx vitest run` 验证 CLI 命令正常工作
