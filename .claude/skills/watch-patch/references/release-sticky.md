# 发布日志桌面便签

新版本 pattern 处理完成后（SKILL.md 第 3.2 步），把该版本的发布日志精选贴成一张**黄色**桌面便签。
本环节失败仅警告（输出原因继续排程），不影响退避链与看门狗。

## 内容精选纪律

条目保留完整句式：环境变量 / 命令 / 设置名原样照抄，作用描述完整，禁止压缩成短语。

* 正例：`CLAUDE_CODE_DISABLE_WEB_FETCH 环境变量，可关掉 WebFetch 工具`
* 反例：`CLAUDE_CODE_DISABLE_WEB_FETCH 关 WebFetch`

分组按 CHANGELOG 语义归并为「新增 / 变更 / 修复（重点）」三节；修复类只挑重点（影响面大或用户可感知的），
总数控制在 15~25 条，便签可滚动、不必求全。

## 步骤

1. **抓版本节**：从 CHANGELOG 提取 `## <version>` 到下一个 `## ` 之间的内容

```bash
curl -s https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md | python3 -c "
import sys, re
data = sys.stdin.read()
m = re.search(r'^## <version>\$.*?(?=^## )', data, flags=re.M | re.S)
print(m.group(0) if m else 'NOT_FOUND')
"
```

返回 `NOT_FOUND`（changelog 尚未收录该版本）→ 跳过便签，仅警告。

2. **写 blocks JSON**：精选结果写成 `/tmp/sticky_<version>.json`，格式：

```json
[
  {"text": "Claude Code <version> 发布精选\n", "size": 18, "bold": true, "color": "title"},
  {"text": "npm latest · <日期>\n\n", "size": 11, "italic": true, "color": "sub"},
  {"text": "新增\n", "size": 14, "bold": true, "color": "head"},
  {"text": "• <完整句式条目>\n", "size": 12, "color": "black"}
]
```

字段缺省值：size=12、bold=false、italic=false、color=black；color 可选 title / sub / head / black / blue / green。

3. **生成剪贴板**（RTFD + RTF 双类型，Stickies 粘贴读 RTFD）：

```bash
swift .claude/skills/watch-patch/scripts/stickies_release_rtf.swift /tmp/sticky_<version>.json
```

4. **探测现有便签**：读 `process "Stickies"` 的 windows（未运行则视为无）

5. **GUI 新建粘贴**：新便签默认黄色，仍显式点一次「黄色」兜底

```applescript
tell application "Stickies" to activate
delay 1.0
tell application "System Events"
    tell process "Stickies"
        keystroke "n" using command down
        delay 0.8
        click menu item "黄色" of menu "颜色" of menu bar item "颜色" of menu bar 1
        delay 0.3
        keystroke "v" using command down
        delay 1.0
    end tell
end tell
```

6. **定位定尺寸**：window 1 = 最新便签。已有便签时跟随：尺寸 = 首个已有便签尺寸，位置 = (该便签 x, 最低便签底部 y + 20)；
   无已有便签时默认 `size {380, 460}`、`position {60, 100}`

```applescript
tell application "System Events"
    tell process "Stickies"
        set size of window 1 to {380, 460}
        set position of window 1 to {60, 100}
    end tell
end tell
```

7. **贴后验证**：`screencapture -R<x>,<y>,<w>,<h> /tmp/sticky_verify.png` 截图并 Read 确认内容已渲染；
   若空白则重跑第 3 步重写剪贴板，聚焦 window 1 后再 Cmd+V 一次（首次粘贴偶发不进）

## 陷阱

* Stickies 无 AppleScript 对象模型，内容只能靠剪贴板灌入；窗口控制走 System Events
* Cmd+V 偶尔不粘（窗口未就绪 / 焦点丢失），必须截图验证，空白就重贴
* 多版本连跳（如 2.1.160 → 2.1.180 直接处理）只贴 latest 一张
