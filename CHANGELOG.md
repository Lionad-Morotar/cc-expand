# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.4] - 2026-06-10

### Added

- Windows 平台支持：PowerShell 函数生成、`.exe` 二进制文件处理、`npm.cmd` 调用适配
- CLI 全局 `--version` 标志
- `install` 命令支持 `latest` 标签自动解析为最新 semver 版本
- `install.js` Windows 环境适配（npm 命令和配置文件路径提示）

### Changed

- 重写 README 文档，优化 Agent 驱动的模式发现说明和压缩性能影响提示

## [0.0.3] - 2026-06-10

### Changed

- `install.sh` 重构为跨平台的 `install.js`，支持非 TTY 环境安全运行
- `setup` / `patch` 命令的交互式提示改为按需动态导入，避免 stdin 监听器残留导致 publish 时进程 hang

### Fixed

- 修复 `npm publish` 时 `prepublishOnly` 中的 `vitest --run` 卡死问题

## [0.0.2] - 2026-06-10

### Added

- `install.sh` 一键安装脚本，支持自动检测平台并安装 Claude Code

### Fixed

- 修复 `recordPatchedVersion` 中 `patchedVersions` 可能为 `undefined` 时的崩溃问题
- 优化 README 中一键安装脚本的说明文档

## [0.0.1] - 2026-06-10

### Added

- 首次发布
- `install` 命令：下载并安装指定版本的 Claude Code 本地二进制文件
- `setup` 命令：生成渠道无关的 Shell 包装函数，自动路由到本地二进制文件
- `supports` 命令：列出所有支持的平台和版本
- `patch` 命令：对本地二进制文件进行上下文窗口扩容 patch
- `run` 命令：启动已 patch 的本地二进制文件
- 本地二进制架构：将 Claude Code 管理在 `~/.cc-expand/` 目录下，避免触碰系统二进制文件
- 渠道发现服务：自动检测 brew、npx、direct 等安装渠道并按优先级排序
- 渠道配置持久化：记录用户选择的安装渠道
- 跨平台模式支持：根据 OS/arch 自动匹配对应的 patch 模式
- 平台特定二进制提取：从 npm 包中解析并提取平台原生二进制文件
- 内置 Claude Code 版本模式数据库（v2.1.169 / v2.1.170）
