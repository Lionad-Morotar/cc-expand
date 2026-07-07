/**
 * 版本检查服务:对比 npm latest 与本地已处理版本,决定是否需要生成新 pattern
 * 纯逻辑无 IO——npm 查询与本地 versions.json 读取由调用方注入,便于单元测试
 */
import { execFile } from 'node:child_process'
import { getNpmCommand, getNpmExecOptions } from './package.js'

/**
 * 查询 npm 上某包的最新版本（默认 @anthropic-ai/claude-code；查 cc-expand 自身时传 'cc-expand'）。
 *
 * 走 npm 命令（npm view），因此自动使用用户配置的 registry——这是关键：
 * self-update 的更新检查与实际安装必须走同一 registry，否则镜像同步窗口内会误报"有更新却装不上"。
 *
 * 用 execFile 的 timeout 选项：超时自动 kill 子进程，保证 status/list 命令
 * 输出完成后 Node 进程能立即退出（不挂起）。失败/超时/解析失败均返回 undefined，
 * 调用方按"无法判断最新版"处理，绝不破坏主流程。
 *
 * 与 PackageService.resolveVersion 的区别：后者失败时返回字面 'latest'（30s 子进程未 kill），
 * 本函数失败返回 undefined 并 kill 子进程，适合被动检测场景。
 */
export async function queryLatestVersion(
  timeoutMs = 4000,
  execFileImpl: typeof execFile = execFile,
  packageName: string = '@anthropic-ai/claude-code',
  distTag: string = 'latest'
): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFileImpl(
      getNpmCommand(),
      ['view', `${packageName}@${distTag}`, 'version', '--json'],
      { timeout: timeoutMs, ...getNpmExecOptions() },
      (error: Error | null, stdout: string) => {
        if (error) {
          resolve(undefined)
          return
        }
        const trimmed = stdout.trim()
        try {
          const parsed = JSON.parse(trimmed)
          if (typeof parsed === 'string' && /^\d+\.\d+\.\d+/.test(parsed)) {
            resolve(parsed)
            return
          }
        } catch {
          // 非 JSON，走 fallback
        }
        const fallback = trimmed.replace(/^["']|["']$/g, '')
        resolve(/^\d+\.\d+\.\d+/.test(fallback) ? fallback : undefined)
      }
    )
  })
}

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
