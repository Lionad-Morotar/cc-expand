/**
 * 发现服务
 * 扫描系统寻找 Claude Code 二进制安装位置
 */
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { findAllInstallations } from './claude-discovery.js'
import { CcxError, ErrorCode } from '../types/index.js'

export interface DiscoveryOptions {
  /** NPX 缓存目录列表 */
  npxCacheDirs?: string[]
  /** PATH 环境变量，默认 process.env.PATH */
  pathEnv?: string
}

const DEFAULT_NPX_DIRS = [
  join(process.env.HOME || '~', '.npm', '_npx')
]

export class DiscoveryService {
  private options: DiscoveryOptions

  constructor(options: DiscoveryOptions = {}) {
    this.options = options
  }

  /**
   * 查找 Claude Code 二进制文件
   * 搜索顺序：PATH → NPX 缓存
   * @returns 二进制文件绝对路径
   */
  async findClaudeBinary(): Promise<string> {
    // 1. 检查 PATH
    const pathBinary = this.findInPath()
    if (pathBinary) {
      return pathBinary
    }

    // 2. 检查 NPX 缓存
    const npxDirs = this.options.npxCacheDirs ?? DEFAULT_NPX_DIRS
    for (const npxDir of npxDirs) {
      const npxBinary = this.findInNpxCache(npxDir)
      if (npxBinary) {
        return npxBinary
      }
    }

    // 3. 使用 tweakcc 的硬编码搜索路径表兜底
    // 这张表覆盖了 npm/pnpm/yarn/bun/volta/fnm/nvm/nodenv/nvs/asdf/mise
    // 以及 macOS/Linux/Windows 的常见安装目录，还有原生安装路径。
    // 只取 native binary：npm-based 的 path 指向 cli.js，直接 execFile 会失败。
    const installations = await findAllInstallations()
    const native = installations.find(i => i.kind === 'native')
    if (native) {
      return native.path
    }

    throw new CcxError(
      ErrorCode.BINARY_NOT_FOUND,
      'Claude Code binary not found',
      'Install with: npm install -g @anthropic-ai/claude-code'
    )
  }

  /**
   * 获取二进制版本号
   * @param binaryPath 二进制路径
   * @returns 版本号字符串（如 "2.1.161"），解析失败返回 "unknown"
   */
  async getBinaryVersion(binaryPath: string): Promise<string> {
    return new Promise((resolve) => {
      const child = execFile(binaryPath, ['--version'], {
        timeout: 5000
      }, (error: Error | null, stdout: string) => {
        if (error) {
          resolve('unknown')
          return
        }
        const output = stdout.trim()
        const match = output.match(/(\d+\.\d+\.\d+)/)
        resolve(match?.[1] ?? 'unknown')
      })

      // 强制超时
      setTimeout(() => {
        child.kill()
        resolve('unknown')
      }, 6000)
    })
  }

  private findInPath(): string | null {
    const pathEnv = this.options.pathEnv ?? process.env.PATH ?? ''
    const separators = process.platform === 'win32' ? ';' : ':'

    for (const dir of pathEnv.split(separators)) {
      const candidate = join(dir.trim(), 'claude')
      if (this.isExecutable(candidate)) {
        return candidate
      }
    }

    return null
  }

  private findInNpxCache(npxDir: string): string | null {
    if (!existsSync(npxDir)) {
      return null
    }

    const expectedPath = join(
      '@anthropic-ai',
      'claude-code',
      'bin',
      process.platform === 'win32' ? 'claude.exe' : 'claude'
    )

    for (const entry of readdirSync(npxDir)) {
      const candidate = join(npxDir, entry, 'node_modules', expectedPath)
      if (this.isExecutable(candidate)) {
        return candidate
      }
    }

    return null
  }

  private isExecutable(filePath: string): boolean {
    try {
      const stats = statSync(filePath)
      return stats.isFile()
    } catch {
      return false
    }
  }
}
