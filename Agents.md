# Agents.md

cc-expand 通过插件化二进制 patch 扩展 Claude Code 能力：最常见用途是突破原生 200K 上下文窗口上限以延迟自动压缩（也可反向压低 1M 模型的上限以停留在性能最优区间）。跨平台 CLI（bin 双注册 `ccx` / `cc-expand`），pattern 经 OSS 动态分发，新版本 Claude Code 通常无需重装 npm 包；pnpm workspace 含 Nuxt 4 官网子包（packages/website）。

* 现实层你有无限时间和资源，不要因上下文压缩简化任务执行

## 项目上下文

| 文档                                                       | 说明                       |
| ---------------------------------------------------------- | -------------------------- |
| [CONTEXT.md](./CONTEXT.md)                                 | 领域术语表与 ADR 布局      |
| [Plugin 作者指南](./docs/plugin-authoring.md)              | 插件编写与发布指南         |
| [原始设计稿](./docs/design/2026-06-05-cc-expand-design.md) | 项目起源设计（/office-hours） |
| [工程深度规划](./docs/design/2026-06-05-eng-plan.md)       | 初期工程规划（已批准）     |
| [STACK.md](./.planning/codebase/STACK.md)                  | 技术栈、开发命令、部署流程 |
| [STRUCTURE.md](./.planning/codebase/STRUCTURE.md)          | 目录结构、命名规范         |
| [ARCHITECTURE.md](./.planning/codebase/ARCHITECTURE.md)    | 架构模式、术语表           |
| [C4 架构模型](./.planning/c4/)                             | LikeC4 架构模型（npx likec4 start 本地查看） |
| [CONVENTIONS.md](./.planning/codebase/CONVENTIONS.md)      | 代码风格、开发约定         |
| [TESTING.md](./.planning/codebase/TESTING.md)              | 测试规范                   |
| [INTEGRATIONS.md](./.planning/codebase/INTEGRATIONS.md)    | 外部服务、环境变量         |
| [PAGES.md](./.planning/codebase/PAGES.md)                  | 页面与入口清单（前端/CLI） |
| [CONCERNS.md](./.planning/codebase/CONCERNS.md)            | 技术债务、注意事项         |

你可以自行读取项目上下文文档，更新时也优先更新相关文档。
