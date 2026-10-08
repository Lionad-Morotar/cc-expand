# 页面与入口清单

<!-- refreshed: 261002 -->

数据来源：CLI 族从 `src/cli/index.ts` 的 cac 命令注册（`command()` 签名 × `src/cli/i18n.ts` 中文描述）静态提取；前端族从 `packages/website/app/pages/` 文件系统路由目录枚举。两处任一变动（新增命令/页面、改签名）后本清单即过期，需同步刷新。

## 命令总览（CLI：`ccx` / `cc-expand`）

bin 双注册（`cc-expand` 与 `ccx` 同指 `dist/cli.js`），子命令等价。更新类命令（`self-update`）之外均可经 `npx -y cc-expand` 直跑。

| 命令 | 实现文件 | 说明 |
| ---- | -------- | ---- |
| `config <subcommand> [key] [value]` | `src/cli/commands/config.ts` | 管理用户偏好设置 |
| `status` | `src/cli/commands/status.ts` | 显示当前 patch 状态 |
| `supports` | `src/cli/commands/supports.ts` | 列出支持的 Claude Code 版本（`--all`） |
| `install [version]` | `src/cli/commands/install.ts` | 通过 npm 下载 Claude Code |
| `setup` | `src/cli/commands/setup.ts` | 安装 shell 快捷方式（cc、c），`-y` 跳确认 |
| `restore` | `src/cli/commands/restore.ts` | 恢复原始 binary |
| `verify` | `src/cli/commands/verify.ts` | 检查 patch 状态 |
| `run [combo]` | `src/cli/commands/run.ts` | 启动已 patch 的 Claude Code（`--print-binary`）；精确 combo 缺失时回落唯一插件变体 |
| `patch [action] [version] [combo]` | `src/cli/commands/patch.ts` | Patch 或取消 patch 本地 Claude Code binary（`-t <count>`、`-y`） |
| `migration [version\|latest]` | `src/cli/commands/migration.ts` | 将现有 patch 迁移到目标版本（`--from`、`--dry-run`） |
| `list` | `src/cli/commands/list.ts` | 列出已安装和已 patch 的版本（`--patched`、`--all`） |
| `self-update [channel]` | `src/cli/commands/self-update.ts` | 更新 cc-expand 自身到最新 npm 版本或显式通道/版本 |
| `plugins [sub] [name]` | `src/cli/commands/plugins.ts` | 管理插件（`list\|enable\|disable\|remove\|add`） |

## 命令明细

### config（`src/cli/commands/config.ts`）

| 子命令 | 用法 | 说明 |
| ------ | ---- | ---- |
| `get` | `ccx config get [key]` | 读取配置项 |
| `set` | `ccx config set <key> <value>` | 写入配置项（autoMaintain / autoUpdateCheck / locale / installMethod / updateCheckInterval） |
| `lang` | `ccx config lang <locale>` | 切换界面语言 |

### patch（`src/cli/commands/patch.ts`）

| 动作 | 用法 | 说明 |
| ---- | ---- | ---- |
| apply（默认） | `ccx patch [version] [combo]` | 应用 patch，`-t/--target` 指定目标上下文数 |
| remove | `ccx patch remove` | 移除 patch（实现：`src/cli/commands/patch-remove.ts`） |

### plugins（`src/cli/commands/plugins.ts`）

| 子命令 | 用法 | 说明 |
| ------ | ---- | ---- |
| `list` | `ccx plugins list` | 列出可用插件（含内置插件） |
| `enable` / `disable` | `ccx plugins enable <name>` | 启用/停用插件 |
| `remove` | `ccx plugins remove <name>` | 移除插件 |
| `add` | `ccx plugins add <source>` | 安装插件 |

## 前端入口（packages/website，Nuxt 4）

| 路由 | 视图文件 |
| ---- | -------- |
| `/` | `packages/website/app/pages/index.vue` |

单页站点（官网首页，Three.js banner），无更多路由；`dev:website` 本地开发、`build:website` 静态生成。
