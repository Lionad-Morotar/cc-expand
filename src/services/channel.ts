/**
 * 渠道检测服务
 * 扫描系统上所有可用的 Claude Code 安装渠道
 */

import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export interface ChannelInfo {
  /** 渠道标识名 */
  name: string
  /** 显示名称 */
  displayName: string
  /** 二进制文件绝对路径 */
  path: string
  /** 版本号 */
  version: string
  /** 是否在 PATH 中 */
  isInPath: boolean
  /** 优先级数字（越小越高） */
  priority: number
}

export interface ChannelDiscoveryOptions {
  /** NPX 缓存目录列表 */
  npxCacheDirs?: string[]
  /** PATH 环境变量，默认 process.env.PATH */
  pathEnv?: string
}

const DEFAULT_NPX_DIRS = [
  join(process.env.HOME || '~', '.npm', '_npx'),
]

export class ChannelDiscoveryService {
  private options: ChannelDiscoveryOptions

  constructor(options: ChannelDiscoveryOptions = {}) {
    this.options = options
  }

  /**
   * 检测所有可用的 Claude Code 安装渠道
   */
  async detectChannels(): Promise<ChannelInfo[]> {
    const channels: ChannelInfo[] = []
    const seenPaths = new Set<string>()

    // 1. 检测 PATH 中的 claude
    const pathBinary = this.findInPath()
    if (pathBinary) {
      const version = await this.getBinaryVersion(pathBinary)
      const name = this.guessChannelFromPath(pathBinary)
      channels.push({
        name,
        displayName: this.getDisplayName(name),
        path: pathBinary,
        version,
        isInPath: true,
        priority: this.getPriority(name, true),
      })
      seenPaths.add(pathBinary)
    }

    // 2. 检测 NPX 缓存
    const npxDirs = this.options.npxCacheDirs ?? DEFAULT_NPX_DIRS
    for (const npxDir of npxDirs) {
      const npxBinary = this.findInNpxCache(npxDir)
      if (npxBinary && !seenPaths.has(npxBinary)) {
        const version = await this.getBinaryVersion(npxBinary)
        channels.push({
          name: 'npx',
          displayName: this.getDisplayName('npx'),
          path: npxBinary,
          version,
          isInPath: pathBinary === npxBinary,
          priority: this.getPriority('npx', pathBinary === npxBinary),
        })
        seenPaths.add(npxBinary)
      }
    }

    return channels.sort((a, b) => a.priority - b.priority)
  }

  /** 在 PATH 中查找 claude 二进制 */
  private findInPath(): string | null {
    const pathEnv = this.options.pathEnv ?? process.env.PATH ?? ''
    const separators = process.platform === 'win32' ? ';' : ':'

    for (const dir of pathEnv.split(separators)) {
      const candidate = join(dir.trim(), 'claude')
      if (existsSync(candidate)) {
        return candidate
      }
    }

    return null
  }

  /** 在 NPX 缓存中查找 claude 二进制 */
  private findInNpxCache(npxDir: string): string | null {
    if (!existsSync(npxDir)) {
      return null
    }

    const expectedPath = join(
      '@anthropic-ai',
      'claude-code',
      'bin',
      'claude',
    )

    for (const entry of readdirSync(npxDir)) {
      const candidate = join(npxDir, entry, 'node_modules', expectedPath)
      if (existsSync(candidate)) {
        return candidate
      }
    }

    return null
  }

  /** 获取二进制版本号 */
  private async getBinaryVersion(binaryPath: string): Promise<string> {
    return new Promise((resolve) => {
      execFile(
        binaryPath,
        ['--version'],
        { timeout: 5000 },
        (error: Error | null, stdout: string) => {
          if (error) {
            resolve('unknown')
            return
          }
          const match = stdout.trim().match(/(\d+\.\d+\.\d+)/)
          resolve(match?.[1] ?? 'unknown')
        },
      )
    })
  }

  /** 根据路径猜测渠道 */
  private guessChannelFromPath(path: string): string {
    if (path.includes('homebrew') || path.includes('Cellar')) return 'brew'
    if (path.includes('_npx')) return 'npx'
    return 'direct'
  }

  /** 获取显示名称 */
  private getDisplayName(name: string): string {
    const names: Record<string, string> = {
      brew: 'Homebrew',
      npx: 'NPX (npm exec)',
      'npm-global': 'npm global',
      'pnpm-global': 'pnpm global',
      direct: 'Direct (PATH)',
    }
    return names[name] ?? name
  }

  /** 计算优先级 */
  private getPriority(name: string, isInPath: boolean): number {
    const basePriorities: Record<string, number> = {
      brew: 1,
      npx: 2,
      'npm-global': 3,
      'pnpm-global': 4,
      direct: 5,
    }
    return (basePriorities[name] ?? 99) + (isInPath ? 0 : 10)
  }
}
