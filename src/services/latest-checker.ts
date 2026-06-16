/**
 * 版本检查服务:对比 npm latest 与本地已处理版本,决定是否需要生成新 pattern
 * 纯逻辑无 IO——npm 查询与本地 versions.json 读取由调用方注入,便于单元测试
 */

export interface LatestCheckResult {
  /** npm 上的最新版本 */
  latest: string
  /** 本地已处理的版本列表(回显,供主代理上下文) */
  processed: string[]
  /** latest 是否需要生成 pattern(不在本地已处理列表中) */
  needWork: boolean
}

export class LatestChecker {
  /**
   * 判定是否需要为新版本生成 pattern
   * 语义遵循 watch-patch SKILL.md:pattern 含当前版本则忽略,否则处理 latest
   * (允许越过中间版本,如 latest 2.1.180 而 local 最高 2.1.160,直接处理 180)
   */
  check(latest: string, localVersions: string[]): LatestCheckResult {
    const processed = [...localVersions]
    const needWork = !localVersions.includes(latest)
    return { latest, processed, needWork }
  }
}
