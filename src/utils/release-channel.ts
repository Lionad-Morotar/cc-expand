import semver from 'semver'

/**
 * 从语义化版本号解析 release 通道（对应 npm dist-tag）。
 *
 * 为什么用 prerelease 首标识：npm dist-tag 约定与 semver prerelease 标识一致
 * （alpha/beta/rc）。stable 无 prerelease → latest。非标准 prerelease（数字标识、
 * 或非合法 dist-tag 字符）无法映射 → 降级 latest，调用方按 stable 通道处理，
 * 避免构造出 npm 不认的 dist-tag。
 */
export function getReleaseChannel(version: string): string {
  const pre = semver.prerelease(version)?.[0]
  if (typeof pre === 'string' && /^[a-z][a-z0-9-]*$/.test(pre)) {
    return pre
  }
  return 'latest'
}
