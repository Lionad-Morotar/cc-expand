# cc-expand

扩展 Claude Code 的上下文窗口（Context Window）——从 200K 突破到任意值。

当你使用国内模型代理（只支持 250K 上下文）时，Claude Code 原生 200K 的限制会成为瓶颈。`cc-expand` 通过修改 Claude Code 二进制中的硬编码常量，将上下文窗口提升到目标值。

## 安装

```bash
npm install -g cc-expand
```

或直接使用 npx（无需安装）：

```bash
npx cc-expand <command>
```

## 用法

### 交互式 Patch

```bash
cc-expand patch
# 提示输入目标 tokens，确认后自动 patch
```

### 非交互式 Patch（CI / 脚本）

```bash
cc-expand patch --target 250000 --yes
```

### 验证 Patch 状态

```bash
cc-expand verify
```

### 恢复到原始版本

```bash
cc-expand restore
```

### 查看状态

```bash
cc-expand status
```

## CLI 命令

| 命令 | 说明 |
|------|------|
| `patch [options]` | Patch Claude Code 二进制 |
| `restore` | 从备份恢复原始二进制 |
| `verify` | 验证当前二进制是否已被 patch |
| `status` | 显示 Claude Code 版本和 patch 状态 |

### Patch 选项

```
-t, --target <number>   目标上下文窗口大小（默认：250000）
-y, --yes               跳过确认提示
```

## 支持的版本

| 版本 | darwin-arm64 | darwin-x64 | win32-x64 | linux-arm64 | linux-x64 |
|------|:------------:|:----------:|:---------:|:-----------:|:---------:|
| 2.1.161 | ✅ | — | — | — | — |
| 2.1.162 | ✅ | — | — | — | — |
| 2.1.163 | ✅ | — | — | — | — |
| 2.1.169 | ✅ | ✅ | ✅ | — | — |

> ⚠️ 版本号对应 Claude Code CLI 版本（`claude --version`）。如果运行 `patch` 时提示版本不支持，请更新到已支持的版本，或提交 issue 请求添加新版本。

## 原理

Claude Code 的二进制文件将模型上下文窗口硬编码为 `200000`（20万 tokens）。每个版本的变量名通过代码混淆（obfuscation）生成，且不同平台（darwin/win32/linux）和不同架构（arm64/x64）使用不同的变量名。

`cc-expand` 的工作流程：

1. **发现**：自动定位 Claude Code 二进制（`/usr/local/bin/claude` 或 npm 全局安装路径）
2. **识别版本**：读取 `claude --version` 确定版本号
3. **匹配模式**：根据 `版本 + 平台 + 架构` 查找预置的 patch 模式
4. **备份**：将原始二进制复制到 `~/.cc-expand/backups/`
5. **Patch**：在二进制中定位目标常量并原地替换（保持文件大小不变）
6. **重签名**：macOS 上执行 `codesign --sign - --force --deep`
7. **验证**：确认原始模式已消失、目标值已写入
8. **回滚**：验证失败时自动从备份恢复

## 注意事项

- **macOS**：patch 后会自动重新签名（codesign）。如果签名失败，二进制可能无法运行，此时可用 `restore` 恢复。
- **Windows**：无需额外操作，直接替换 `claude.exe` 即可。
- **Linux**：暂不支持（缺少二进制样本，欢迎提供）。
- **位数限制**：目标值必须与原始值位数相同（200000 → 250000，都是 6 位）。如果位数不同，会收到错误提示。

## 常见问题

### Patch 后 Claude Code 无法启动

运行 `cc-expand restore` 恢复原始二进制，然后检查：

- macOS 上 codesign 是否成功
- 目标值位数是否与原始值一致
- 是否使用了不支持的版本

### 版本不支持

```
No pattern found for version 2.1.xxx
```

这意味着当前 Claude Code 版本的常量名尚未被收录。你可以：

1. 更新 Claude Code 到已支持的版本
2. 参考源码中的 `src/data/patterns.json`，自行发现新模式后提交 PR

### 如何发现新模式

对于已知版本但新平台/架构：

```bash
# 在二进制中搜索 200000 的上下文
grep -ao '.{0,25}200000.{0,15}' /path/to/claude | grep '=200000'
```

## 许可证

MIT © Lionad Morotar
