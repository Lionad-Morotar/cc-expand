/**
 * InstallMethodDetector — 安装方式检测深度模块
 *
 * 三级检测链（优先级从高到低）：
 *   1. 用户配置 installMethod（显式声明，最高优先级）
 *   2. npm_config_user_agent 环境变量（包管理器运行时设置）
 *   3. argv[1] 路径模式（目前仅识别 npx 的 _npx 缓存目录）
 *
 * npm/pnpm 全局目录的路径模式多变且不可靠，暂不通过路径识别，
 * 交给配置声明或交互式询问兜底。
 */
import type { InstallMethod } from '../types/index.js'
import { UserConfigService } from './user-config.js'

export interface InstallMethodDetectorOptions {
  /** 用户配置服务（注入用），默认新建实例 */
  configService?: UserConfigService
  /** process.argv[1]（注入用），默认真实值 */
  argv1?: string
  /** 环境变量（注入用），默认 process.env */
  env?: NodeJS.ProcessEnv
}

export class InstallMethodDetector {
  private readonly configService: UserConfigService
  private readonly argv1: string
  private readonly env: NodeJS.ProcessEnv

  constructor(options?: InstallMethodDetectorOptions) {
    this.configService = options?.configService ?? new UserConfigService()
    this.argv1 = options?.argv1 ?? process.argv[1] ?? ''
    this.env = options?.env ?? process.env
  }

  /**
   * 检测 cc-expand 自身的安装方式。
   * @returns InstallMethod；所有信号缺失时返回 'unknown'
   */
  async detect(): Promise<InstallMethod> {
    // 1. 配置声明优先（用户显式声明的最高可信度）
    const declared = this.configService.get('installMethod')
    if (declared && declared !== 'unknown') {
      return declared
    }

    // 2. npm_config_user_agent 环境变量
    const fromEnv = this.detectFromUserAgent()
    if (fromEnv) return fromEnv

    // 3. argv[1] 路径模式（仅识别 npx）
    const fromPath = this.detectFromPath()
    if (fromPath) return fromPath

    return 'unknown'
  }

  /** 从 npm_config_user_agent 解析包管理器 */
  private detectFromUserAgent(): InstallMethod | null {
    const ua = this.env.npm_config_user_agent
    if (!ua) return null
    if (ua.startsWith('pnpm')) return 'pnpm'
    if (ua.startsWith('yarn')) return 'yarn'
    if (ua.startsWith('npm')) return 'npm'
    return null
  }

  /** 从 argv[1] 路径识别；目前仅识别 npx 缓存目录 */
  private detectFromPath(): InstallMethod | null {
    if (this.argv1.includes('_npx')) return 'npx'
    return null
  }
}
