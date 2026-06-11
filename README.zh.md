<p align="center">
  <img src="https://mgear-image.oss-cn-shanghai.aliyuncs.com/image/other/20260610223551529.webp" width="800" alt="cc-expand logo">
</p>

<h1 align="center">cc-expand</h1>

<p align="center">
  <span>把你的 CC 可用上下文窗口扩大 60%，甚至更多</span>
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh.md">中文</a>
</p>

---

**压缩是性能下降的主要原因之一，使用 cc-expand 让你的 CC 上下文窗口突破 200K 的限制，推迟自动压缩的时机**

当使用某些模型（只支持 256K 上下文）时，Claude Code 原生 200K 的限制会成为瓶颈。`cc-expand` 通过修改 Claude Code 二进制中的硬编码常量，将上下文窗口大小提升到目标值。

> **提示：** CC 的环境变量允许设置 `COMPACT_WINDOW`，但不能高于硬编码默认值。所以提高 target 可以推迟压缩时机。例如，我日常使用的 Kimi-K2.6 支持 256k，所以我会把 target 设为 270000 以便将压缩时机从约 17k 提升至 23k

| 使用前 | 使用后 |
|--------|--------|
| 200K 限制，约 110K 可用上下文 | 270K 限制，约 180K 可用上下文 |
| ![](https://mgear-image.oss-cn-shanghai.aliyuncs.com/image/other/20260610211249243.png) | ![](https://mgear-image.oss-cn-shanghai.aliyuncs.com/image/other/20260610211422491.png) |

## 安装

让 AI agent 执行这句：

```plaintext
帮我扩展 Claude Code 的上下文窗口到 270k，使用 cc-expand（npx -y cc-expand@latest）
```

或可以**手动安装**：

```bash
# use npm
npm install -g cc-expand
# or npx
npx cc-expand <command>
```

## 特性

* 支持 Mac、Windows 双平台
* 功能兼容，允许设置任意上下文大小，无需牺牲自动压缩特性，所以无论是扩大还是缩小上下文窗口都支持

## 用法

| 命令 | 说明 |
|------|------|
| `cc-expand install [version]` | 从 npm 下载 Claude Code 到 `~/.cc-expand/packages/` |
| `cc-expand patch [options]` | 从本地包复制 binary，patch 后保存到 `~/.cc-expand/bin/` |
| `cc-expand run [tokens]` | 启动已 patch 的 Claude Code binary |
| `cc-expand setup` | 安装 shell 快捷方式（`cc`、`c` alias，以便快速打开已经 patch 的 claude code） |
| `cc-expand restore` | 从备份恢复原始 binary |
| `cc-expand verify` | 验证 binary 是否已被 patch |
| `cc-expand status` | 显示版本和 patch 状态 |
| `cc-expand supports` | 列出支持的 Claude Code 版本 |
| `cc-expand --version` | 列出 cc-expand 的版本 |

* install version option: `latest` or `v2.1.170`
* patch options:
  ```
  -t, --target <number>   目标上下文窗口大小（默认：256000）
  -v, --version <semver>  要 patch 的 Claude Code 版本（如 2.1.170）
  -y, --yes               跳过确认提示
  ```

## 支持的 CC 版本

| 版本 | darwin-arm64 | darwin-x64 | win32-x64 | linux-arm64 | linux-x64 |
|------|:------------:|:----------:|:---------:|:-----------:|:---------:|
| 2.1.161 | ✅ | — | — | — | — |
| 2.1.162 | ✅ | — | — | — | — |
| 2.1.163 | ✅ | — | — | — | — |
| 2.1.169 | ✅ | ✅ | ✅ | — | — |
| 2.1.170 | ✅ | ✅ | ✅ | — | — |
| 2.1.172 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 2.1.173 | ✅ | ✅ | ✅ | ✅ | ✅ |

> ⚠️ cc-expand 自身版本号对应 `claude --version`。运行 `cc-expand supports` 查看动态更新的支持 cc-expand 的 CC 版本列表。

**版本更新机制**

Pattern 数据托管在阿里云 OSS 上，运行 cc-expand 时按需拉取，并缓存在本地 `~/.cc-expand/cache/patterns/`，通过 ETag 条件请求减少流量消耗。

每半小时我的 claw 会自动执行项目内 `watch-patch` 技能，发现新版 Claude Code、提取混淆变量名，并将 pattern 分片上传到 OSS。你**无需更新 npm 包**即可获得新版本支持 —— pattern 上传 OSS 后立即生效。

但我的 claw 在许多情况会宕机。如果遇到使用的版本比 cc-expand 版本号更新的情况，请暂时使用旧版 CC（如 `npx @anthropic-ai/claude-code@2.1.148`）。

进阶用户也可以选择让你的 Agent：

```plaintext
我需要更新版 CC 的上下文窗口大小，但 cc-expand 尚不支持的我使用的版本。
你需要拉取本项目源码，阅读 `<project-root>/.claude/skills/watch-patch` 了解算法过程并 patch。
最终将我的 CC 设置为 270k 上下文大小。
```

## 支持我

请 Star 以支持我开发更多有趣的应用。

## 许可证

MIT © Lionad Morotar
