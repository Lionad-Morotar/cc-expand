---
name: watch-patch
description: 定时检索 Claude Code 新包，Patch 并发版
---

当 Claude Code 发布新版本时，自动发现新的混淆变量名并更新分片 pattern 文件。

## Context

* CC：Claude Code
* pattern: `<project-root>/patterns/*.json`（分片格式，按版本独立文件，如 `2.1.180.json`）
* pattern-index: `<project-root>/patterns/versions.json`（版本索引，如 `{ "version": "2.1.161", "platforms": [ "darwin-arm64" ]}`）
* bytecodePlatforms: `versions.json` 每版本的 bytecode 锚点已实证平台列表（如 `["darwin-arm64"]`）；仅实证平台在列；2.1.246 之前版本该字段为 `[]` 或缺失（pattern:gen 对任意版本无条件写入，空数组属正常而非数据异常）
* watch-patch: 即本技能，`<project-root>/.claude/skills/watch-patch/SKILL.md`
* patch-steps: 如何针对新版本生成 pattern 的步骤 `<project-root>/.claude/skills/watch-patch/references/patch-steps.md`（核心已脚本化：`pnpm pattern:gen <version>` 内含文本锚点发现 + patch 模拟 + bytecode 锚点自动生成与实证（仅 ≥2.1.246 的 bytecode 版本），`pnpm pattern:upload <version>` 上传）
* backoff level（退避级别）：轮询间隔档位 L0=30min / L1=60min / L2=120min / L3=240min（上限，4h）；`needWork=false` 升级（+1 封顶 L3），`needWork=true` 重置回 L0

## Workflow

0. **解析入参与环境检查**
  0.1 从调用参数读取 `backoff=Lk`；用户手动启动（无参数）视为 `L0`
  0.2 `CronList` 检查残留的 watch-patch one-shot，重复或过期则先 `CronDelete`，保证同一时刻仅一条接力链
  0.3 上传由 `pnpm pattern:upload` 事件驱动，无需 `watch:patterns` 持续监听（后台进程会被 SIGTERM 杀掉，exit 143，不可靠）
1. **版本检查**：运行 `pnpm pattern:latest-check`，解析 JSON `{ latest, processed, needWork }`
   - `needWork=true`（pattern 缺 latest）→ 执行第 2 步，且**下一轮级别重置为 L0**
   - `needWork=false`（已是最新）→ 跳过第 2 步，**下一轮级别升级为 min(Lk+1, L3)**
2. **处理新版本**（仅 needWork=true）：创建后台子代理执行 patch-steps，允许越过版本（如 latest 2.1.180 而本地仅 2.1.160，直接从 180 起）；主会话维持干净上下文，不接管子代理工作
3. **20 分钟看门狗**（仅 needWork=true）：用 `CronCreate` one-shot 计时
   3.1 超时未完成 → 杀子代理 + `osascript -e 'display dialog "子代理处理 {X.Y.Z} 超 20 分钟已中止，请手动处理" with title "watch-patch 超时" buttons {"OK"} default button 1'`，进入暂停（不再排程下一轮）
   3.2 子代理返回版本号 → 清看门狗 + `osascript -e 'display notification "已生成并上传 patterns/{X.Y.Z}.json" with title "cc-expand"'`
4. **排程下一轮**（除非第 3.1 已暂停）：按"下一轮级别"查退避间隔表得 N 分钟，`CronCreate` 一个 one-shot（`recurring:false`），目标时刻 = 现在 + N，prompt 写 `/watch-patch backoff=L<下一轮级别>`

### 退避间隔表

| 级别 | 间隔 N | 进入条件 |
|---|---|---|
| L0 | 30 分钟 | 首次启动 / 刚处理完新版本（重置） |
| L1 | 60 分钟 | L0 检查无新版本 |
| L2 | 120 分钟 | L1 检查无新版本 |
| L3 | 240 分钟 | L2 检查无新版本；之后保持上限（4h） |

### one-shot cron 时刻计算

cron 用本地时间 5 字段；`date -v+NM` 自动处理跨日跨月跨年，dow 固定 `*`（避免与 dom 产生 OR 语义）：

```bash
# N = 间隔分钟数（30 / 60 / 120 / 240）
echo "$(date -v+${N}M '+%M %H %d %m') *"
# 例：此刻 13:04 +30min → "34 13 06 08 *"
```

## 注意事项

- 你和我的交互格式必须非常简单以便保证长上下文的可用性能
- **无需 push**：patterns 通过 OSS 动态拉取，更新分片文件后用户即可获取最新 pattern，不需要发布 npm 包，也不需要提交或推送到 git
- **退避链自包含**：退避级别编码在 cron 的 prompt（`backoff=Lk`）里接力传递，无需外部状态文件；session-only cron 随会话退出而消失，链路自然终止，下次手动 `/watch-patch` 重启即可
- **one-shot 时刻**：必须用 `date -v+NM` 推算绝对时刻（自动处理跨日跨月跨年），dow 固定 `*`；切勿用 `ScheduleWakeup`（仅 /loop dynamic 会话可用）
- **通知可靠性**：直接内联 `osascript`，不依赖 zsh 函数 `popup`（非交互 shell 不加载它）；完成用 `display notification`（非阻塞），超时告警用 `display dialog`（强提醒）
- 子代理只需依次调 `pnpm pattern:gen <version>`（已内含 bytecode 锚点自动生成与实证，仅 ≥2.1.246 的 bytecode 版本）与 `pnpm pattern:upload <version>`，生成+上传逻辑已固化（详见 patch-steps.md），不再需要临场编写搜索脚本，但如果测试失败，仍然需要你来接入，并对脚本做出调整
