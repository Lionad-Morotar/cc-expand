/**
 * cc-expand list — 列出已安装和已 patch 的版本
 */
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { t } from '../i18n.js'
import { type CommandResult } from '../result.js'

export interface ListData {
  versions: Array<{
    version: string
    installed: boolean
    patched: boolean
    targets?: number[]
    binaryPath?: string
    patchedAt?: string
  }>
}

export interface ListOptions {
  homeDir?: string
  patchedOnly?: boolean
}

function compareSemverDesc(a: string, b: string): number {
  const parse = (v: string) => v.split('.').map((n) => parseInt(n, 10))
  const aa = parse(a)
  const bb = parse(b)
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    const x = aa[i] ?? 0
    const y = bb[i] ?? 0
    if (x !== y) return y - x
  }
  return 0
}

export async function listCommand(
  args: string[] = [],
  options?: ListOptions,
): Promise<CommandResult<ListData>> {
  const patchedOnly = options?.patchedOnly ?? args.includes('--patched')
  const homeDir = options?.homeDir ?? homedir()
  const packagesDir = join(homeDir, '.cc-expand', 'packages')
  const versionsJsonPath = join(homeDir, '.cc-expand', 'versions.json')

  const patchedVersions: Record<string, { targets: number[]; patchedAt: string }> = {}
  if (existsSync(versionsJsonPath)) {
    const raw = readFileSync(versionsJsonPath, 'utf-8')
    const parsed = JSON.parse(raw) as { patchedVersions?: typeof patchedVersions }
    if (parsed.patchedVersions) {
      Object.assign(patchedVersions, parsed.patchedVersions)
    }
  }

  const installedVersions = new Set<string>()
  if (existsSync(packagesDir)) {
    for (const entry of readdirSync(packagesDir)) {
      const binPath = join(packagesDir, entry, 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude')
      if (existsSync(binPath)) {
        installedVersions.add(entry)
      }
    }
  }

  const allVersions = new Set([...installedVersions, ...Object.keys(patchedVersions)])
  const versions = Array.from(allVersions)
    .map((version) => {
      const patchedInfo = patchedVersions[version]
      const installed = installedVersions.has(version)
      const binaryPath = installed
        ? join(packagesDir, version, 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude')
        : undefined
      return {
        version,
        installed,
        patched: !!patchedInfo,
        targets: patchedInfo?.targets,
        binaryPath,
        patchedAt: patchedInfo?.patchedAt,
      }
    })
    .filter((v) => !patchedOnly || v.patched)
    .sort((a, b) => compareSemverDesc(a.version, b.version))

  return {
    success: true,
    command: 'list',
    summary: t('command.list.summary', { count: versions.length }),
    data: { versions },
  }
}
