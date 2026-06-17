# Patch 必须等长替换 Mach-O，大目标用数值字面量等长编码

被 patch 的 Claude Code `claude` 是 ~215MB 的 Mach-O 64-bit native executable（Bun standalone，明文 minified JS 嵌在 `__DATA` 段）。Mach-O 用绝对 file offset 硬编码每个 segment 与 code signature 的位置——任何改变文件长度的 patch 都会让 load command 的偏移表与物理数据脱节，codesign 判 `invalid or unsupported format for signature`，运行时 macOS AMFI 在 `exec` 阶段直接 SIGKILL(137)。因此 PatchEngine 只能做**字节级等长原地覆盖**。

当目标 token 值的十进制字面量超过源槽位宽度（每个 patch item 的 `sourceValue.length`，当前 = 6）时，不改变文件长度，而是生成一个更短、运行时严格等值的合法 JS 数值字面量（科学计数法如 `1e6`、十六进制如 `0xf4240`），用空格右 pad 到等长后写入。

## Considered Options

- **等长数值编码（采纳）**：候选 {十进制字面量, 科学计数法（去 `e+` 的 `+`）, 十六进制} 取最短，空格 pad 到 `slotWidth`。支持 `1000000 → 1e6`、`2000000 → 2e6`、`1500000 → 1.5e6` 等；三者均超 `slotWidth` 时（如 `1234567`）抛 `INVALID_TARGET`。
- **拼接重写改长度（否决）**：变长 → codesign 失败 → SIGKILL(137)。2026-06-16 三对照实验确证。
- **限制目标 ≤ 999999（否决）**：阉割 100w 功能，治标不治本。

## Consequences

- PatchEngine 写入仍保持 `buffer.write` 等长覆盖；只替换「生成写入值」的函数为编码器。
- Verifier 必须改用「编码后字面量出现」校验，而非 `targetTokens.toString()`，否则对 `1e6` 编码的 binary 误判失败。
- 实验脚本与真实 binary 证据存于 `zRefs/claude-code/exp-patch.cjs`（gitignored）。
