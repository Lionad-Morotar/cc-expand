# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-06-13

### Added

- 新增 `config` 命令：管理用户偏好，支持 `get`、`set`、`lang` 子命令
- 新增 `list` 命令：列出已安装和已 patch 的 Claude Code 版本，支持 `--patched` 过滤
- CLI 输出渲染器：支持 `--json` 结构化输出、`--no-color` 关闭颜色、`--quiet` 安静模式
- 国际化（i18n）支持：新增 `--locale`/`-l` 全局参数（`en` 或 `zh`）
- 新增 BSD 风格退出码映射（`EX_USAGE`、`EX_DATAERR`、`EX_NOINPUT` 等）
- 新增 `UserConfigService`：XDG 兼容的用户配置管理（`~/.config/cc-expand/config.json`）

### Changed

- CLI 路由迁移至 `cac`，所有命令统一返回结构化 `CommandResult` 对象
- `status`、`supports`、`install`、`setup`、`restore`、`verify`、`run`、`patch` 命令全部改为结果对象输出
- 集成测试扩展为对 `dist/cli.js` 的端到端测试

### Fixed

- 非 TTY 环境和 `NO_COLOR`/`TERM=dumb` 现在会正确禁用 ANSI 颜色
- `--yes` 标志不再被全局错误处理误拦截

## [0.2.1] - 2026-06-12

### Fixed

- Windows 平台 `install` / `patch` 命令调用 `npm.cmd` 时出现 `spawn EINVAL` 的问题，通过为 Windows 启用 `shell: true` 修复

## [0.2.0] - 2026-06-11

### Added

- `PatternService`：支持从阿里云 OSS 远程获取 patch 模式，带 ETag 缓存
- `watch-patterns` 脚本：自动检测新 Claude Code 版本并上传模式到 OSS
- `install` 命令支持 `v` 前缀版本号（如 `v2.1.173`）
- `utils/version`：集中式版本号归一化工具

### Changed

- `ConfigService` 重构为异步 API，模式解析委托给 `PatternService`
- CLI 命令适配异步 `ConfigService` API

### Fixed

- `watch-patterns` 适配 chokidar v5 目录监听 API

## [0.1.2] - 2026-06-11

### Added

- 支持 Claude Code v2.1.173（darwin-arm64、darwin-x64、win32-x64、linux-arm64、linux-x64）

## [0.1.1] - 2026-06-11

### Added

- 支持 Claude Code v2.1.172（darwin-arm64、darwin-x64、win32-x64、linux-arm64、linux-x64）

## [0.1.0] - 2026-06-10

### Added

- CLI 输出格式化器（支持成功/错误/信息/警告等带 emoji 的富文本输出）
- Shell profile 自动检测器（自动识别 .zshrc / .bashrc / PowerShell $PROFILE）
- `install`、`supports`、`setup`、`patch` 命令支持富文本输出
- `restore`、`status`、`verify` 命令支持富文本输出

### Changed

- 移除 `install.js`，改为直接通过 CLI 进行安装和配置

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
