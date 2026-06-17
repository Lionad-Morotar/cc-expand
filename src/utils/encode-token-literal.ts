/**
 * 将目标 token 数编码为「长度恰好等于 slotWidth、运行时严格等值」的合法 JS 数值字面量。
 *
 * 为什么需要：被 patch 的 Claude Code 是 Mach-O native binary，patch 必须等长替换
 * （见 docs/adr/0002-equal-length-binary-patch.md）。当目标值十进制字面量超过源槽位
 * 宽度时，用更短的等值字面量（科学计数法 / 十六进制）+ 空格右 pad 凑满槽位，
 * 避免改变文件长度（变长会触发 codesign 失败 → macOS SIGKILL）。
 *
 * 空格 pad 在本项目的所有 pattern 中都合法：数字后跟的字符仅为 `,` 或 `:`，
 * 空格作为分隔符不影响数值解析。
 *
 * @param target 目标 token 数（正整数）
 * @param slotWidth 源槽位字节数（= patch item 的 sourceValue.length）
 * @returns 长度 === slotWidth 的合法 JS 数值字面量，运行时严格 === target
 * @throws CcxError(INVALID_TARGET) 当 target 无法在 slotWidth 字节内精确编码
 */
import { CcxError, ErrorCode } from '../types/index.js'

export function encodeTokenLiteral(target: number, slotWidth: number): string {
  // 1. 优先十进制字面量：最可读、最可预测。fit 槽位就直接用（如 256000、300000、999999）
  const decimal = String(target)
  if (decimal.length <= slotWidth) {
    return decimal.padEnd(slotWidth, ' ')
  }

  // 2. 十进制超长 → 降级到更短的等值字面量（科学计数法 / 十六进制），取最短
  const candidates = [
    target.toExponential().replace(/e\+/, 'e'),
    '0x' + target.toString(16),
  ]
  const shortest = candidates.reduce((a, b) => (a.length <= b.length ? a : b))

  // 仍超槽位 → 无法等长编码，必须报错（写出超长串会破坏 Mach-O，见 ADR-0002）
  if (shortest.length > slotWidth) {
    throw new CcxError(
      ErrorCode.INVALID_TARGET,
      `Cannot encode target ${target} into ${slotWidth} bytes (shortest literal "${shortest}" is ${shortest.length} bytes)`,
      'Use a round value expressible in fewer bytes, e.g. 1000000 (1e6) or 2000000 (2e6)',
    )
  }

  return shortest.padEnd(slotWidth, ' ')
}
