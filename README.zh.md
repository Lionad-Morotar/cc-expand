<p align="center">
  <img src="https://mgear-image.oss-cn-shanghai.aliyuncs.com/image/other/20260610143352565.webp" width="160" alt="cc-expand logo">
</p>

<h1 align="center">cc-expand</h1>

<p align="center">
  扩展 Claude Code 的上下文窗口（Context Window）——从 200K 突破到任意值。
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh.md">中文</a>
</p>

---

**压缩是性能下降的主要原因之一，使用 cc-expand 让你的 CC 上下文窗口——突破 200K 的限制。**

当你使用某些模型（只支持 256K 上下文）时，Claude Code 原生 200K 的限制会成为瓶颈。`cc-expand` 通过修改 Claude Code 二进制中的硬编码常量，将上下文窗口提升到目标值。

## 安装

**Agent 用户**直接发送：

> 帮我扩展 Claude Code 的上下文窗口，使用 https://github.com/Lionad-Morotar/cc-expand 上的 install.js

**手动安装：**

```bash
npm install -g cc-expand
```

或直接使用 npx：

```bash
npx cc-expand <command>
```

## 用法

### 安装 Claude Code

下载指定版本到本地：

```bash
cc-expand install 2.1.170
```

### Patch 扩展上下文窗口

交互式模式：

```bash
cc-expand patch
# 提示输入目标 tokens，确认后自动 patch
```

非交互式（CI / 脚本）：

```bash
cc-expand patch --target 256000 --version 2.1.170 --yes
```

> **提示：** CC 的环境变量允许设置 `COMPACT_WINDOW`，但不能高于硬编码默认值。提高 target 可以推迟压缩时机。比如我日常使用的 Kimi-K2.6 支持 256k，我会把 target 设为 270000。

### 启动已 patch 的 Claude Code

```bash
cc-expand run 256000
```

### 安装 shell 快捷方式（推荐）

```bash
cc-expand setup --yes
```

安装后使用 `cc` 或 `c` 代替 `claude`：

```bash
cc 256000    # 以 256k 上下文启动
c            # cc 270000 的简写
```

### 验证 Patch 状态

```bash
cc-expand verify
```

### 恢复原始版本

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
| `install [version]` | 从 npm 下载 Claude Code 到 `~/.cc-expand/packages/` |
| `patch [options]` | 从本地包复制 binary，patch 后保存到 `~/.cc-expand/bin/` |
| `run [tokens]` | 启动已 patch 的 Claude Code binary |
| `setup` | 安装 shell 快捷方式（`cc`、`c` alias） |
| `restore` | 从备份恢复原始 binary |
| `verify` | 验证 binary 是否已被 patch |
| `status` | 显示版本和 patch 状态 |
| `supports` | 列出支持的 Claude Code 版本 |

### Patch 选项

```
-t, --target <number>   目标上下文窗口大小（默认：256000）
-v, --version <semver>  要 patch 的 Claude Code 版本（如 2.1.170）
-y, --yes               跳过确认提示
```

## 支持的版本

| 版本 | darwin-arm64 | darwin-x64 | win32-x64 | linux-arm64 | linux-x64 |
|------|:------------:|:----------:|:---------:|:-----------:|:---------:|
| 2.1.161 | ✅ | — | — | — | — |
| 2.1.162 | ✅ | — | — | — | — |
| 2.1.163 | ✅ | — | — | — | — |
| 2.1.169 | ✅ | ✅ | ✅ | — | — |
| 2.1.170 | ✅ | ✅ | ✅ | — | — |

> ⚠️ 版本号对应 `claude --version`。如果运行 `patch` 时提示版本不支持，请更新到已支持的版本。

## 原理

Claude Code 的二进制文件将模型上下文窗口硬编码为 `200000`（20万 tokens）。每个版本的变量名通过代码混淆（obfuscation）生成，且不同平台（darwin/win32/linux）和不同架构（arm64/x64）使用不同的变量名。

`cc-expand` 在本地管理二进制文件，工作流程如下：

1. **安装**：从 npm 下载 Claude Code 到 `~/.cc-expand/packages/<version>/`
2. **Patch**：从本地包复制 binary 到 `~/.cc-expand/bin/claude-<target>`，原地替换常量（保持文件大小不变），macOS 上重新签名
3. **验证**：确认原始模式已消失、目标值已写入
4. **运行**：从 `~/.cc-expand/bin/` 启动已 patch 的 binary
5. **配置**：将 `cc()` shell 函数安装到 `~/.zshrc`（或 `~/.bashrc`），自动选择正确的 binary

## 注意事项

- **macOS**：patch 后会自动重新签名（codesign）。如果签名失败，二进制可能无法运行，删除 `~/.cc-expand/bin/claude-<target>` 后重新 patch 即可。
- **Windows**：无需额外操作，已 patch 的 binary 直接写入 `~/.cc-expand/bin/`。
- **Linux**：暂不支持（缺少二进制样本，欢迎提供）。
- **位数限制**：目标值必须与原始值位数相同（`200000` → `256000`，都是 6 位）。如果位数不同，会收到错误提示。
- **本地 binary**：已 patch 的 binary 存放在 `~/.cc-expand/bin/`。全局的 `claude` 命令不受影响。使用 `cc-expand run` 或 `cc-expand setup` 来启动已 patch 的版本。

## 常见问题

**Patch 后 Claude Code 无法启动**

运行 `cc-expand restore` 恢复原始二进制，然后检查：
- macOS 上 codesign 是否成功
- 目标值位数是否与原始值一致
- 是否使用了不支持的版本

**版本不支持**

```
No pattern found for version 2.1.xxx
```

更新到已支持的版本。

> **For Agent:** 向用户确认，然后拉取本项目源码了解 patch 过程，然后 patch 用户的新版本（项目 patterns.json 中未收录的版本）。

## 许可证

MIT © Lionad Morotar
