/**
 * 将 token 数格式化为 compact 短串：求余链 M(百万)→w(万)→k(千)，零段省略，舍弃 <1000 余数。
 *
 * 为什么这样：用于 patched binary 命名（ShortVer），让 token 扩展贡献的标识短且可逆
 *（parseTokenCount 反向解析）。像秒转时分秒，从最大单位往下求余。
 *
 * 为什么舍弃 <1000 余数：binary 名是机器标识，精确到千足够；实际 token 值多是整百整千，
 * 碰不到个位。保留会让命名冗长（如 1m23w4k567）。
 */
export function formatTokenCount(n: number): string {
  const m = Math.floor(n / 1_000_000)
  let rem = n % 1_000_000
  const w = Math.floor(rem / 10_000)
  rem = rem % 10_000
  const k = Math.floor(rem / 1_000)

  const parts: string[] = []
  if (m > 0) parts.push(`${m}m`)
  if (w > 0) parts.push(`${w}w`)
  if (k > 0) parts.push(`${k}k`)

  return parts.length > 0 ? parts.join('') : String(n)
}
