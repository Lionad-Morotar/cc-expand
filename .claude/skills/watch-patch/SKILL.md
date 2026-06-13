---
name: watch-patch
description: 定时检索 Claude Code 新包，Patch 并发版
---

当 Claude Code 发布新版本时，自动发现新的混淆变量名并更新分片 pattern 文件。

## Context

* CC：Claude Code
* pattern: `<project-root>/patterns/*.json`（分片格式，按版本独立文件，如 `2.1.180.json`）
* pattern-index: `<project-root>/patterns/versions.json`（版本索引，如 `{ "version": "2.1.161", "platforms": [ "darwin-arm64" ]}`）
* watch-patch: 即本技能，`<project-root>/.claude/skills/watch-patch/SKILL.md`
* patch-steps: 如何针对新版本的 patch、verify、release 等步骤 `<project-root>/.claude/skills/watch-patch/references/patch-steps.md`

## Workflow

0. 确保 `pnpm watch:patterns` 已在后台运行（首次执行需启动，持续监听 patterns/ 目录并自动上传变更到 OSS）
1. **interval**：每半小时使用 `pnpm view @anthropic-ai/claude-code` 获取 latest 的 CC 版本：
  1.1 pattern 包含当前版本则忽略，等待下一次扫描
  1.2 不包含则准备开始任务，允许越过版本执行，比如 latest v2.1.180 而 pattern 只包含 v2.1.160 那么直接从 180 开始
  1.3 无需暂停 interval，创建通用子代理并告知它读取执行 patch-steps 完成所有步骤（而你自己需要维持干净的 interval monitor 上下文）
2. **立即开始 20 分钟计时，等待子代理执行任务**
  2.1 若 20 分钟内未完成，则杀掉该子代理，并执行 `popup "watch-patch 超时" "子代理处理新版本 {X.Y.Z} 超过 20 分钟，已被中止，请手动处理"` 提醒我，你自己进入暂停状态（不要再创建新的 cron）
3. 子代理向你返回当前处理的版本号，可能会包含工作过程，而你无需验证
  3.1 清空 20 分钟计时
4. 你执行 `popup "cc-expand" "已生成并上传 patterns/{X.Y.Z}.json，测试通过"` 提醒我
5. 等待下一轮 interval 定时提醒

## 注意事项

- 你和我的交互格式必须非常简单以便保证长上下文的可用性能
- 无需 push**：patterns 通过 OSS 动态拉取，更新分片文件后用户即可获取最新 pattern，不需要发布 npm 包，也不需要提交或推送到 git
