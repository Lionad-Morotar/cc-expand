/**
 * 平台 binary 获取与 patch 模拟的共享工具：pattern 生成（token 锚点）与
 * plugin shard 生成（literal 锚点）两条流水线共用，避免平台表与下载解压逻辑双份漂移。
 */
import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { PatchEngine } from '../src/core/patch-engine.js'
import type { PatchItem } from '../src/types/index.js'
import { encodeTokenLiteral } from '../src/utils/encode-token-literal.js'

export interface PlatformSpec {
  os: string
  arch: string
  pkg: string
  binary: string
}

export const PLATFORMS: PlatformSpec[] = [
  { os: 'darwin', arch: 'arm64', pkg: '@anthropic-ai/claude-code-darwin-arm64', binary: 'claude' },
  { os: 'darwin', arch: 'x64', pkg: '@anthropic-ai/claude-code-darwin-x64', binary: 'claude' },
  { os: 'win32', arch: 'x64', pkg: '@anthropic-ai/claude-code-win32-x64', binary: 'claude.exe' },
  { os: 'linux', arch: 'arm64', pkg: '@anthropic-ai/claude-code-linux-arm64', binary: 'claude' },
  { os: 'linux', arch: 'x64', pkg: '@anthropic-ai/claude-code-linux-x64', binary: 'claude' },
]

/** 在解压目录中定位二进制(兼容 package/claude 与 claude 两种布局) */
export function findBinary(dir: string, binary: string): string | null {
  for (const p of [join(dir, 'package', binary), join(dir, binary)]) {
    if (existsSync(p)) return p
  }
  return null
}

/** 下载并解压平台 tarball,返回二进制 buffer */
export function downloadAndExtract(version: string, spec: PlatformSpec, workDir: string): Buffer {
  const tgzDir = join(workDir, 'tarballs', `v${version}`)
  const extractDir = join(workDir, 'extracted', `v${version}`, `${spec.os}-${spec.arch}`)
  mkdirSync(tgzDir, { recursive: true })

  const pack = spawnSync('npm', ['pack', `${spec.pkg}@${version}`, '--pack-destination', tgzDir], {
    encoding: 'utf-8',
  })
  if (pack.status !== 0) {
    throw new Error(`npm pack 失败 ${spec.pkg}@${version}: ${pack.stderr}`)
  }
  const tgzName = pack.stdout.trim().split('\n').pop() as string
  const tgzPath = join(tgzDir, tgzName)

  rmSync(extractDir, { recursive: true, force: true })
  mkdirSync(extractDir, { recursive: true })
  const untar = spawnSync('tar', ['-xzf', tgzPath, '-C', extractDir])
  if (untar.status !== 0) {
    throw new Error(`tar 解压失败 ${tgzPath}: ${untar.stderr}`)
  }

  const bin = findBinary(extractDir, spec.binary)
  if (!bin) throw new Error(`解压后未找到二进制: ${spec.binary}`)
  return readFileSync(bin)
}

/** 从已解压目录读二进制(dry-run,跳过下载) */
export function readFromExtracted(root: string, version: string, spec: PlatformSpec): Buffer {
  const dir = join(root, `v${version}`, `${spec.os}-${spec.arch}`)
  const bin = findBinary(dir, spec.binary)
  if (!bin) throw new Error(`已解压目录未找到二进制: ${dir}`)
  return readFileSync(bin)
}

/** patch 模拟:每条 PatchItem 必须能在二进制中定位并替换 sourceValue(0 残留)。
 *  literal-target patch（plugin shard）与 token patch（pattern）同样适用：
 *  引擎对有 target 的 item 走 literal 分支，不经过 token generator */
export function simulatePatch(buffer: Buffer, patches: PatchItem[]): boolean {
  const result = new PatchEngine().patch(
    Buffer.from(buffer),
    patches,
    (slot: number) => encodeTokenLiteral(256000, slot)
  )
  return result.success && result.replaceCount === patches.length
}

/** 顺序解析 --flag value（生成器脚本共用的轻量参数读取） */
export function flag(rest: string[], name: string): string | null {
  const idx = rest.indexOf(name)
  return idx >= 0 ? (rest[idx + 1] ?? null) : null
}
