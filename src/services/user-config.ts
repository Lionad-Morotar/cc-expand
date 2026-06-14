/**
 * 用户偏好配置服务
 * 存储在 XDG-compliant 路径：~/.config/cc-expand/config.json
 * 用于 locale、autoMaintain 以及 self-update 相关偏好
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import type { InstallMethod } from '../types/index.js'

export interface UserPreferences {
  locale: 'en' | 'zh'
  autoMaintain: boolean
  /** cc-expand 自身的安装方式，供 self-update 决定更新命令（区别于 channel） */
  installMethod: InstallMethod
  /** 是否启用隐式更新检查（运行命令时后台提示新版） */
  autoUpdateCheck: boolean
  /** 更新检查的节流间隔（毫秒），默认 24 小时 */
  updateCheckInterval: number
}

const DEFAULT_PREFERENCES: UserPreferences = {
  locale: 'en',
  autoMaintain: true,
  installMethod: 'unknown',
  autoUpdateCheck: true,
  updateCheckInterval: 86_400_000,
}

export function getUserConfigPath(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME
  if (xdgConfigHome) {
    return join(xdgConfigHome, 'cc-expand', 'config.json')
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA
    if (appData) {
      return join(appData, 'cc-expand', 'config.json')
    }
  }

  return join(homedir(), '.config', 'cc-expand', 'config.json')
}

export interface UserConfigServiceOptions {
  configPath?: string
}

export class UserConfigService {
  private configPath: string

  constructor(options?: UserConfigServiceOptions) {
    this.configPath = options?.configPath ?? getUserConfigPath()
  }

  getConfigPath(): string {
    return this.configPath
  }

  load(): UserPreferences {
    if (!existsSync(this.configPath)) {
      return { ...DEFAULT_PREFERENCES }
    }

    const raw = readFileSync(this.configPath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<UserPreferences>
    return {
      locale: parsed.locale ?? DEFAULT_PREFERENCES.locale,
      autoMaintain: parsed.autoMaintain ?? DEFAULT_PREFERENCES.autoMaintain,
      installMethod: parsed.installMethod ?? DEFAULT_PREFERENCES.installMethod,
      autoUpdateCheck: parsed.autoUpdateCheck ?? DEFAULT_PREFERENCES.autoUpdateCheck,
      updateCheckInterval: parsed.updateCheckInterval ?? DEFAULT_PREFERENCES.updateCheckInterval,
    }
  }

  save(prefs: UserPreferences): void {
    const dir = dirname(this.configPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(this.configPath, JSON.stringify(prefs, null, 2))
  }

  get<K extends keyof UserPreferences>(key: K): UserPreferences[K] {
    return this.load()[key]
  }

  set<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]): void {
    const prefs = this.load()
    prefs[key] = value
    this.save(prefs)
  }
}
