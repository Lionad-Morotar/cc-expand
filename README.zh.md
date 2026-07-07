![cc-expand cover](./assets/cover-banner.png)

<h1 align="center">cc-expand</h1>

<p align="center">
  通过 plugin 化的 binary patch 扩展 Claude Code 能力
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh.md">中文</a>
</p>

---

cc-expand 通过 patch Claude Code 二进制中的硬编码常量来改变其行为。

## 扩大上下文窗口

最常见的用途是扩大上下文窗口上限，从而推迟自动压缩时机：

1. **突破 200K 上下文窗口限制**：当模型支持 256K 时，Claude Code 原生 200K 上限会成为瓶颈。
2. **把 1M 模型限制在更小区间**：模型在 256k、512k 之后性能下降明显，可以按需压低上限以保持在最佳性能区间。

| 使用前 | 使用后 |
|--------|--------|
| 200K 限制，约 110K 可用上下文 | 270K 限制，约 180K 可用上下文 |
| ![](https://mgear-image.oss-cn-shanghai.aliyuncs.com/image/other/20260610211249243.png) | ![](https://mgear-image.oss-cn-shanghai.aliyuncs.com/image/other/20260610211422491.png) |

另外，长上下文场景下模型性能会下降。图片引用自 mimo-v2.5 pro blog。

![](https://mgear-image.oss-cn-shanghai.aliyuncs.com/image/other/20260614013032076.png)

## 安装

让 AI agent 执行：

```plaintext
帮我扩展 Claude Code 的上下文窗口到 270k，使用 cc-expand（npx -y cc-expand@latest）
```

或手动安装：

```bash
npm install -g cc-expand
# 或
npx cc-expand <command>
```

## 特性

- 跨平台：macOS、Windows、Linux
- 可上下调整上下文窗口，不牺牲自动压缩机制
- 支持第三方 plugin，扩展更多 binary 修改能力
- 通过 Pattern 文件动态更新，以便兼容 Claude Code 的多版本

## 用法

| 命令 | 说明 |
|------|------|
| `ccx install [version]` | 从 npm 下载 Claude Code 到 `~/.cc-expand/packages/` |
| `ccx patch <version>` | patch binary 并保存到 `~/.cc-expand/bin/` |
| `ccx patch remove <version> [combo]` | 移除已 patch 的 binary |
| `ccx run [combo]` | 启动已 patch 的 Claude Code binary |
| `ccx setup` | 安装 `cc`/`c` shell 快捷方式 |
| `ccx restore` | 从备份恢复原始 binary |
| `ccx verify` | 验证 binary 是否已被 patch |
| `ccx status` | 显示版本和 patch 状态 |
| `ccx supports` | 列出支持的 Claude Code 版本 |
| `ccx --version` | 显示 cc-expand 版本 |

- install 版本：`latest` 或 `2.1.170`
- token 数量支持纯数字、`k`（千）、`w`（万）：`256000`、`270k`、`27w` 均表示 270000 tokens
- patch 选项：
  ```
  -t, --target <count>    目标上下文窗口大小（默认：256000）
  -y, --yes               跳过确认并覆盖 shell 快捷方式
  ```
- `patch` 成功后会自动维护 `cc`/`c` 快捷方式。
- `run` 支持 combo，例如 `ccx run 270k`、`ccx run 27w-flow`。

## 支持的 Claude Code 版本

支持版本由阿里云 OSS 上的 pattern 分片动态决定。运行：

```bash
ccx supports
```

即可查看当前平台实时支持列表。pattern 会缓存在 `~/.cc-expand/cache/patterns/`，通过 ETag 条件请求减少流量。

新版 Claude Code 发布后，`watch-patch` 技能会自动发现其混淆常量并上传新 pattern。通常情况下，你**无需更新 cc-expand npm 包**即可获得新版本支持。

如果当前 CC 版本尚未支持，可以临时使用旧版（如 `npx @anthropic-ai/claude-code@2.1.197`），或基于项目源码运行 `watch-patch` 技能/agent 生成本地 pattern。

## 其他功能？

cc-expand 把每一次 binary 改动抽象为 plugin。

context window expansion 扩展只是内置 plugin 之一，你还可以安装第三方 plugin 来修改 Claude Code 的其他行为。

```bash
ccx plugins add owner/repo        # 安装 plugin
ccx plugins list                  # 查看已安装 plugin
ccx plugins enable/disable <name> # 启用/禁用
ccx plugins remove <name>         # 移除
```

启用多个 plugin 后，`ccx patch` 会一次性应用所有改动，binary 名称会编码 plugin 集合，例如 `claude-27w-flow`。

想自己写 plugin？请看 [Plugin 作者指南](docs/plugin-authoring.md)。

## 支持我

请 Star 以支持我开发更多有趣的应用。

MIT © Lionad Morotar
