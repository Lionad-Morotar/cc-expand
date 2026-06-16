/**
 * 隐式更新检查运行器
 *
 * 在 CLI 入口启动检查 promise（与命令并行），命令后 await（带硬超时），
 * 发现新版时通过 hintWriter 打印提示。排除 run 命令（exec 接管进程）。
 *
 * 从 cli/index.ts 抽出，使检查逻辑可独立测试，不依赖 cac 路由。
 */
import type { UpdateInfo } from '../services/update-check.js'
import { UpdateCheckService } from '../services/update-check.js'
import type { UserConfigService } from '../services/user-config.js'
import { t } from './i18n.js'

const DEFAULT_HINT_TIMEOUT_MS = 3000

/** 不应触发隐式检查的命令
 *  - run：exec 接管进程，promise 被遗弃
 *  - self-update：本身就是更新入口，成功后再提示"有更新"自相矛盾 */
const EXCLUDED_COMMANDS = new Set<string>(['run', 'self-update'])

/**
 * 判断是否应为该命令触发隐式更新检查。
 * 排除 run 命令，且尊重用户的 autoUpdateCheck 偏好。
 */
export function shouldRunUpdateCheck(
  commandName: string | undefined,
  userConfig: Pick<UserConfigService, 'get'>,
): boolean {
  if (!commandName) return false
  if (EXCLUDED_COMMANDS.has(commandName)) return false
  return userConfig.get('autoUpdateCheck')
}

/**
 * 启动更新检查，返回 promise（与命令并行执行）。
 * 失败静默（catch → null），不抛出。
 */
export function startUpdateCheck(currentVersion: string): Promise<UpdateInfo | null> {
  const service = new UpdateCheckService({ currentVersion })
  return service.check().catch(() => null)
}

/**
 * await 检查 promise（带硬超时防卡死），发现新版时调用 hintWriter 打印提示。
 *
 * @param checkPromise startUpdateCheck 返回的 promise
 * @param hintWriter 提示输出函数（cli/index.ts 注入 console.error）
 * @param timeoutMs 硬超时（测试注入用），默认 3 秒
 */
export async function awaitUpdateCheckHint(
  checkPromise: Promise<UpdateInfo | null>,
  hintWriter: (line: string) => void,
  timeoutMs: number = DEFAULT_HINT_TIMEOUT_MS,
): Promise<void> {
  const info = await Promise.race([
    checkPromise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ])
  if (info?.hasUpdate) {
    hintWriter(
      t('update.hint.available', { current: info.currentVersion, latest: info.latestVersion }),
    )
  }
}
