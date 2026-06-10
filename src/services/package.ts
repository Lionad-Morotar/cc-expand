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

export class PackageService {
  constructor(private packagesDir: string) {}

  /**
   * 安装指定版本的 Claude Code
   * @param version 版本号，如 "2.1.170" 或 "latest"
   * @returns 安装目录路径（包含 bin/claude）
   */
  async install(version: string): Promise<string> {
    const targetDir = join(this.packagesDir, version)
    const binaryPath = join(targetDir, 'bin', 'claude')

    // 如果已安装，直接返回
    if (existsSync(binaryPath)) {
      return targetDir
    }

    mkdirSync(targetDir, { recursive: true })

    // 1. 下载 wrapper 包
    const wrapperDir = join(targetDir, '.wrapper')
    mkdirSync(wrapperDir, { recursive: true })
    const wrapperTarball = await this.downloadWrapper(version, wrapperDir)

    try {
      await extract({
        file: wrapperTarball,
        cwd: wrapperDir,
        strip: 1,
      })

      // 2. 读取 optionalDependencies，找到平台特定包
      const pkgJson = JSON.parse(
        readFileSync(join(wrapperDir, 'package.json'), 'utf-8'),
      )
      const platform = `${process.platform}-${process.arch}`
      const platformPkgName = `@anthropic-ai/claude-code-${platform}`
      const platformVersion = pkgJson.optionalDependencies?.[platformPkgName]

      if (!platformVersion) {
        throw new Error(`Unsupported platform: ${platform}`)
      }

      // 3. 下载平台特定包
      const platformDir = join(targetDir, '.platform')
      mkdirSync(platformDir, { recursive: true })
      const platformTarball = await this.downloadPackage(
        platformPkgName,
        platformVersion,
        platformDir,
      )

      try {
        await extract({
          file: platformTarball,
          cwd: platformDir,
          strip: 1,
        })

        // 4. 复制 binary 到目标位置
        const sourceBinary = join(platformDir, 'claude')
        if (!existsSync(sourceBinary)) {
          throw new Error(`Binary not found in platform package: ${sourceBinary}`)
        }

        mkdirSync(join(targetDir, 'bin'), { recursive: true })
        copyFileSync(sourceBinary, binaryPath)
        chmodSync(binaryPath, 0o755)
      } finally {
        rmSync(platformDir, { recursive: true, force: true })
        rmSync(platformTarball, { force: true })
      }
    } finally {
      rmSync(wrapperDir, { recursive: true, force: true })
      rmSync(wrapperTarball, { force: true })
    }

    return targetDir
  }

  /** 检查指定版本是否已安装 */
  isInstalled(version: string): boolean {
    return existsSync(join(this.packagesDir, version, 'bin', 'claude'))
  }

  /** 获取已安装版本的 binary 路径 */
  getBinaryPath(version: string): string {
    return join(this.packagesDir, version, 'bin', 'claude')
  }

  private async downloadWrapper(version: string, destDir: string): Promise<string> {
    return this.downloadPackage('@anthropic-ai/claude-code', version, destDir)
  }

  private async downloadPackage(
    name: string,
    version: string,
    destDir: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        'npm',
        ['pack', `${name}@${version}`, '--pack-destination', destDir],
        { timeout: 300000 },
        (error: Error | null, stdout: string) => {
          if (error) {
            reject(error)
            return
          }
          const lines = stdout.trim().split('\n')
          const tarballName = lines[lines.length - 1].trim()
          resolve(join(destDir, tarballName))
        },
      )
    })
  }
}
