/**
 * PackageService — 管理 Claude Code npm 包的下载和安装
 *
 * Claude Code 的 npm 包结构：
 * - @anthropic-ai/claude-code: wrapper 包（含 postinstall 脚本）
 * - @anthropic-ai/claude-code-{platform}-{arch}: 平台特定 binary 包
 *
 * 下载流程：
 * 1. npm pack wrapper 包 → 读取 package.json 获取 optionalDependencies
 * 2. 根据当前平台匹配对应的 optional dependency
 * 3. npm pack 平台特定包 → 解压提取 binary
 */

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, copyFileSync, chmodSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { extract } from 'tar'
import { normalizeVersion } from '../utils/version.js'

/** 验证版本号格式：semver 或 latest */
function validateVersion(version: string): void {
  const normalized = normalizeVersion(version)
  if (normalized === 'latest') return
  if (/^\d+\.\d+\.\d+/.test(normalized)) return
  throw new Error(
    `Invalid version format: ${version}. Expected semver (e.g. 2.1.170) or "latest"`
  )
}

/** 获取平台相关的 binary 文件名 */
function getBinaryName(): string {
  return process.platform === 'win32' ? 'claude.exe' : 'claude'
}

/** 获取平台相关的 npm 命令 */
export function getNpmCommand(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

/**
 * 获取平台相关的 execFile 选项
 *
 * Windows 上执行 .cmd 文件时，Node.js v18+ 默认会抛出 EINVAL，必须显式启用 shell。
 */
export function getNpmExecOptions(): { shell?: boolean } {
  return process.platform === 'win32' ? { shell: true } : {}
}

/** 安装结果 */
export interface InstallResult {
  /** 安装目录路径 */
  targetDir: string
  /** 解析后的实际版本号 */
  version: string
}

export class PackageService {
  constructor(
    private packagesDir: string,
    private execFileImpl: typeof execFile = execFile
  ) {}

  /**
   * 解析版本号，将 "latest" 转换为实际的 semver 版本
   * @param version 版本号，如 "2.1.170" 或 "latest"
   * @returns 解析后的版本号（失败时返回原值）
   */
  async resolveVersion(version: string): Promise<string> {
    const normalized = normalizeVersion(version)
    if (normalized !== 'latest') return normalized

    return new Promise((resolve) => {
      this.execFileImpl(
        getNpmCommand(),
        ['view', '@anthropic-ai/claude-code@latest', 'version', '--json'],
        { timeout: 30000, ...getNpmExecOptions() },
        (error: Error | null, stdout: string) => {
          if (error) {
            resolve(version)
            return
          }
          try {
            const resolved = JSON.parse(stdout.trim())
            if (typeof resolved === 'string' && /^\d+\.\d+\.\d+/.test(resolved)) {
              resolve(resolved)
              return
            }
          } catch {
            // Fallback: treat raw stdout as version
          }
          const fallback = stdout.trim().replace(/^["']|["']$/g, '')
          if (/^\d+\.\d+\.\d+/.test(fallback)) {
            resolve(fallback)
            return
          }
          resolve(version)
        }
      )
    })
  }

  /**
   * 安装指定版本的 Claude Code
   * @param version 版本号，如 "2.1.170" 或 "latest"
   * @returns 安装目录路径（包含 bin/claude）和解析后的实际版本号
   */
  async install(version: string): Promise<InstallResult> {
    validateVersion(version)

    const resolvedVersion = await this.resolveVersion(version)
    const targetDir = join(this.packagesDir, resolvedVersion)
    const binaryName = getBinaryName()
    const binaryPath = join(targetDir, 'bin', binaryName)

    // 如果已安装，直接返回
    if (existsSync(binaryPath)) {
      return { targetDir, version: resolvedVersion }
    }

    mkdirSync(targetDir, { recursive: true })

    // 1. 下载 wrapper 包（使用解析后的实际版本）
    const wrapperDir = join(targetDir, '.wrapper')
    mkdirSync(wrapperDir, { recursive: true })
    const wrapperTarball = await this.downloadWrapper(resolvedVersion, wrapperDir)

    try {
      await extract({
        file: wrapperTarball,
        cwd: wrapperDir,
        strip: 1
      })

      // 2. 读取 optionalDependencies，找到平台特定包
      const pkgJson = JSON.parse(
        readFileSync(join(wrapperDir, 'package.json'), 'utf-8')
      )
      const platform = `${process.platform}-${process.arch}`
      const platformPkgName = `@anthropic-ai/claude-code-${platform}`
      const platformVersion = pkgJson.optionalDependencies?.[platformPkgName]

      if (!platformVersion) {
        throw new Error(`Unsupported platform: ${platform}`)
      }

      // 3. 下载平台特定包（download 失败时也清理临时目录）
      const platformDir = join(targetDir, '.platform')
      let platformTarball: string | undefined

      try {
        mkdirSync(platformDir, { recursive: true })
        platformTarball = await this.downloadPackage(
          platformPkgName,
          platformVersion,
          platformDir
        )

        await extract({
          file: platformTarball,
          cwd: platformDir,
          strip: 1
        })

        // 4. 复制 binary 到目标位置（带竞态保护：再次检查是否已存在）
        const sourceBinary = join(platformDir, binaryName)
        if (!existsSync(sourceBinary)) {
          throw new Error(`Binary not found in platform package: ${sourceBinary}`)
        }

        mkdirSync(join(targetDir, 'bin'), { recursive: true })

        // 竞态条件保护：另一个并发进程可能已创建 binary
        if (!existsSync(binaryPath)) {
          copyFileSync(sourceBinary, binaryPath)
          chmodSync(binaryPath, 0o755)
        }
      } finally {
        rmSync(platformDir, { recursive: true, force: true })
        if (platformTarball) {
          rmSync(platformTarball, { force: true })
        }
      }
    } finally {
      rmSync(wrapperDir, { recursive: true, force: true })
      rmSync(wrapperTarball, { force: true })
    }

    return { targetDir, version: resolvedVersion }
  }

  /** 检查指定版本是否已安装 */
  isInstalled(version: string): boolean {
    return existsSync(join(this.packagesDir, version, 'bin', getBinaryName()))
  }

  /** 获取已安装版本的 binary 路径 */
  getBinaryPath(version: string): string {
    return join(this.packagesDir, version, 'bin', getBinaryName())
  }

  private async downloadWrapper(version: string, destDir: string): Promise<string> {
    return this.downloadPackage('@anthropic-ai/claude-code', version, destDir)
  }

  private async downloadPackage(
    name: string,
    version: string,
    destDir: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      this.execFileImpl(
        getNpmCommand(),
        ['pack', `${name}@${version}`, '--pack-destination', destDir, '--json'],
        { timeout: 300000, ...getNpmExecOptions() },
        (error: Error | null, stdout: string) => {
          if (error) {
            reject(error)
            return
          }
          try {
            const result = JSON.parse(stdout)
            const tarballName = Array.isArray(result)
              ? result[0]?.filename
              : result?.filename
            if (!tarballName) {
              reject(new Error('npm pack did not return tarball filename'))
              return
            }
            resolve(join(destDir, tarballName))
          } catch {
            // Fallback: parse last non-empty line from stdout
            const lines = stdout.trim().split('\n').filter(Boolean)
            const tarballName = lines[lines.length - 1]?.trim()
            if (!tarballName) {
              reject(new Error('Could not determine tarball name from npm pack output'))
              return
            }
            resolve(join(destDir, tarballName))
          }
        }
      )
    })
  }
}
