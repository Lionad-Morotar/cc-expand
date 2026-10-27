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
swift .agents/skills/watch-patch/scripts/stickies_release_rtf.swift /tmp/sticky_<version>.json
```

4. **探测现有便签**：读 `process "Stickies"` 的 windows（未运行则视为无）

5. **GUI 新建粘贴**：粘贴走「编辑」菜单项，不要用 Cmd+V

```applescript
tell application "Stickies" to activate
delay 1.5
tell application "System Events"
    tell process "Stickies"
        set frontmost to true
        delay 1.0
        keystroke "n" using command down
        delay 2.0
        click menu item "粘贴" of menu "编辑" of menu bar item "编辑" of menu bar 1
        delay 2.5
    end tell
end tell
```

四处与「直觉写法」不同，都是踩过的坑：

* `set frontmost to true` 必须有。只 `activate` 时进程并非 frontmost，其后的键盘事件
  落到当前前台应用而非便签，便签留空（实证：同一脚本加这一行才成功）
* 粘贴点菜单项而非 `keystroke "v"`。keystroke 依赖键盘焦点落在文本区，多窗口或焦点
  未就绪时静默失败；菜单项由 Accessibility 直接派发动作，不依赖焦点
* 不要点「颜色」菜单兜底（旧步骤有过）。新便签默认就是黄色，点颜色菜单会把焦点从文本区
  移走，其后的 Cmd+V 落到别处
* 便签留空时退出或关闭会被自动丢弃，故「窗口数=1」不能当成功判据，只说明窗口建出来了

6. **定位定尺寸**：window 1 = 最新便签。已有便签时跟随：位置 = (该便签 x, 最低便签底部 y + 20)；
   尺寸不跟随，固定用默认值。无已有便签时 `position {60, 100}`

```applescript
tell application "System Events"
    tell process "Stickies"
        set size of window 1 to {470, 800}
        set position of window 1 to {60, 100}
    end tell
end tell
```

15~25 条精选内容按 470 宽需约 800 高才能不滚动显示完；沿用旧值 380×460 会把长条目
挤成窄条并在右下角截断（实证）。Stickies 会记住上次尺寸，故新便签常以旧尺寸出现，
此步显式设置不可省。

7. **落盘核验**：读文件判定，不要截图

截图会抢焦点打断用户手头工作（`7afce42` 移除此步的理由），但便签正文在粘贴瞬间
就已写入磁盘，读文件即可判定成没成，全程不碰 GUI：

```bash
D=~/Library/Containers/com.apple.Stickies/Data/Library/Stickies
NEWEST=$(ls -td "$D"/*.rtfd 2>/dev/null | head -1)
[ -n "$NEWEST" ] && [ -s "$NEWEST/TXT.rtf" ] && echo "OK $NEWEST" || echo "PASTE FAILED"
```

判定用「是否有新建的 .rtfd 且 TXT.rtf 非空」，不要用窗口数（见陷阱节首条）。
失败则重跑第 3 步重写剪贴板、重新粘贴一次；连续两次失败才报警告放行。

**非空不足以判定内容完整**。实测空白误报过 454 字节的 TXT.rtf（窗口建出但只贴进
了残片），而 15~25 条的完整内容约 7.5KB。要更严格的判据就比字节数量级：
第 3 步脚本会回显 `flat RTF bytes=N`，落盘 TXT.rtf 的字节数应与 N 同量级
（实测 7539 对 7539，完全相等）。差一个数量级即视为未贴全，重贴。

## 陷阱

* Stickies 无 AppleScript 对象模型（`make new note` 报 -2710，bundle 内无 .sdef），
  内容只能靠剪贴板经 GUI 灌入；窗口控制走 System Events
* 粘贴失败是静默的：便签建出来但内容是空的或只有残片，关窗后 rtfd 一并消失，
  事后只看得到「窗口没了」。窗口数只证明窗口建出来了，不能当成功判据；
  内容判据是 rtfd 落盘的字节数（见第 7 步）
* 便签正文存于 `~/Library/Containers/com.apple.Stickies/Data/Library/Stickies/<UUID>.rtfd/TXT.rtf`，
  粘贴瞬间即写入，不等退出。`.SavedStickiesState` 只存窗口元数据（Frame / StickyColor /
  UUID 等），不含正文，别去那里找内容
* rtfd 随便签窗口关闭被删除，所以第 7 步核验必须在贴完、关窗之前做。事后想复核内容
  只能靠截图或重贴，这也是该核验值得做的原因
* 关闭便签要 `keystroke "w"` 或 raise 后关，System Events 的 `close window` 不支持（报 -1708）
* 无窗口时 Cmd+N 不生效（无处接收按键），Stickies 完全关掉后需重开应用拿回默认窗口
* Stickies 可能钳制窗口坐标（如 y 强制贴菜单栏下沿），位置设置未完全生效不视为失败，不重试
* 多版本连跳（如 2.1.160 → 2.1.180 直接处理）只贴 latest 一张
