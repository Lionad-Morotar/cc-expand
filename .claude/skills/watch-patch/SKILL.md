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
* patch-steps: 如何针对新版本生成 pattern 的步骤 `<project-root>/.claude/skills/watch-patch/references/patch-steps.md`（核心已脚本化：`pnpm pattern:gen <version>` + `pnpm pattern:upload <version>`）

## Workflow

0. **环境检查**
  0.1 确认 CronList 的状态（是否包含重复或过期的计时器）
  0.2 上传由 `pnpm pattern:upload` 事件驱动，无需 `watch:patterns` 持续监听（该进程在会话后台会被 SIGTERM 杀掉，exit 143，不可靠）
1. **interval**：每小时运行 `pnpm pattern:latest-check`，解析输出 JSON `{ latest, processed, needWork }`：
  1.1 `needWork=false`（pattern 已含 latest）则忽略，等待下一次扫描
  1.2 `needWork=true`（pattern 缺 latest）则准备开始任务，允许越过版本执行（比如 latest v2.1.180 而 pattern 只包含 v2.1.160 那么直接从 180 开始）
  1.3 无需暂停 interval，创建后台子代理并告知它执行 patch-steps 完成生成（而你自己需要维持干净的 interval monitor 上下文）
2. **立即开始 20 分钟计时，等待子代理执行任务**
  2.1 若 20 分钟内未完成，则杀掉该子代理，并执行 `popup "watch-patch 超时" "子代理处理新版本 {X.Y.Z} 超过 20 分钟，已被中止，请手动处理"` 提醒我，你自己进入暂停状态（不要再创建新的 cron）
3. 子代理向你返回当前处理的版本号，可能会包含工作过程，而你无需验证
  3.1 清空 20 分钟计时
4. 你执行 `popup "cc-expand" "已生成并上传 patterns/{X.Y.Z}.json，测试通过"` 提醒我
5. 等待下一轮 interval 定时提醒

## 注意事项

- 你和我的交互格式必须非常简单以便保证长上下文的可用性能
- **无需 push**：patterns 通过 OSS 动态拉取，更新分片文件后用户即可获取最新 pattern，不需要发布 npm 包，也不需要提交或推送到 git
- **看门狗计时**：若用 CronCreate one-shot，cron 表达式必须用**当前日期**计算月/日（如 `56 9 16 6 *`），跨日跨月会失效；优先用 ScheduleWakeup（相对秒数）更稳健
- 子代理只需依次调 `pnpm pattern:gen <version>` 与 `pnpm pattern:upload <version>`，生成+上传逻辑已固化（详见 patch-steps.md），不再需要临场编写搜索脚本，但如果测试失败，仍然需要你来接入，并对脚本做出调整
