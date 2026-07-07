#!/usr/bin/env node
/**
 * 为指定 Claude Code 版本生成 pattern shard
 *
 * 用法:
 *   pnpm pattern:gen <version>                            完整流程(下载→解压→发现→模拟→写)
 *   pnpm pattern:gen <version> --from-extracted <dir>     跳过下载,用已解压目录(dry-run)
 *   pnpm pattern:gen <version> --patterns-dir <dir>       指定输出目录(默认 cwd/patterns)
 *
 * 产出 patterns/{version}.json 后,watch:patterns 后台进程会自动上传 OSS
 */
import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { PatternDiscovery } from '../src/core/pattern-discovery.js'
import { ShardWriter } from '../src/services/shard-writer.js'
import { PatchEngine } from '../src/core/patch-engine.js'
import type { OsPatterns } from '../src/services/pattern.js'
import type { PatchItem } from '../src/types/index.js'
import { encodeTokenLiteral } from '../src/utils/encode-token-literal.js'
import { classifyDesc } from '../src/services/desc-classifier.js'

interface PlatformSpec {
  os: string
  arch: string
  pkg: string
  binary: string
}

const PLATFORMS: PlatformSpec[] = [
  { os: 'darwin', arch: 'arm64', pkg: '@anthropic-ai/claude-code-darwin-arm64', binary: 'claude' },
  { os: 'darwin', arch: 'x64', pkg: '@anthropic-ai/claude-code-darwin-x64', binary: 'claude' },
  { os: 'win32', arch: 'x64', pkg: '@anthropic-ai/claude-code-win32-x64', binary: 'claude.exe' },
  { os: 'linux', arch: 'arm64', pkg: '@anthropic-ai/claude-code-linux-arm64', binary: 'claude' },
  { os: 'linux', arch: 'x64', pkg: '@anthropic-ai/claude-code-linux-x64', binary: 'claude' },
]

/** 在解压目录中定位二进制(兼容 package/claude 与 claude 两种布局) */
function findBinary(dir: string, binary: string): string | null {
  for (const p of [join(dir, 'package', binary), join(dir, binary)]) {
    if (existsSync(p)) return p
  }
  return null
}

/** 下载并解压平台 tarball,返回二进制 buffer */
function downloadAndExtract(version: string, spec: PlatformSpec, workDir: string): Buffer {
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
function readFromExtracted(root: string, version: string, spec: PlatformSpec): Buffer {
  const dir = join(root, `v${version}`, `${spec.os}-${spec.arch}`)
  const bin = findBinary(dir, spec.binary)
  if (!bin) throw new Error(`已解压目录未找到二进制: ${dir}`)
  return readFileSync(bin)
}

/** patch 模拟:每条 PatchItem 必须能在二进制中定位并替换 sourceValue(0 残留) */
function simulatePatch(buffer: Buffer, patches: PatchItem[]): boolean {
  const result = new PatchEngine().patch(
    Buffer.from(buffer),
    patches,
    (slot: number) => encodeTokenLiteral(256000, slot)
  )
  return result.success && result.replaceCount === patches.length
}

function flag(rest: string[], name: string): string | null {
  const idx = rest.indexOf(name)
  return idx >= 0 ? (rest[idx + 1] ?? null) : null
}

function main(): void {
  const version = process.argv[2]
  const rest = process.argv.slice(3)
  if (!version) {
    console.error('用法: pnpm pattern:gen <version> [--from-extracted <dir>] [--patterns-dir <dir>]')
    process.exit(1)
  }

  const fromExtracted = flag(rest, '--from-extracted')
  const patternsDir = flag(rest, '--patterns-dir') ?? join(process.cwd(), 'patterns')

  const osPatterns: OsPatterns = {}
  const platformsDone: string[] = []

  for (const spec of PLATFORMS) {
    try {
      const buffer = fromExtracted
        ? readFromExtracted(fromExtracted, version, spec)
        : downloadAndExtract(version, spec, join(process.cwd(), 'zRefs/claude-codes'))

      const discovered = new PatternDiscovery().discover(buffer)
      const patches: PatchItem[] = discovered.map((d) => ({ ...d, desc: classifyDesc(d.search) }))

      if (!simulatePatch(buffer, patches)) {
        throw new Error(`patch 模拟未全部命中(${spec.os}-${spec.arch})`)
      }

      if (!osPatterns[spec.os]) osPatterns[spec.os] = {}
      osPatterns[spec.os][spec.arch] = patches
      platformsDone.push(`${spec.os}-${spec.arch}`)
      console.log(`✓ ${spec.os}-${spec.arch}: ${patches.length} patterns`)
    } catch (e) {
      // 平台包可能不存在(如旧版本无 Linux),跳过并继续
      console.warn(`⚠ 跳过 ${spec.os}-${spec.arch}: ${(e as Error).message}`)
    }
  }

  if (platformsDone.length === 0) {
    console.error('无平台成功,中止')
    process.exit(1)
  }

  const writer = new ShardWriter({ patternsDir })
  writer.writeShard(version, osPatterns)
  writer.upsertVersionIndex(version, platformsDone)
  console.log(`\n生成 ${patternsDir}/${version}.json (${platformsDone.length} 平台)`)
  console.log('watch:patterns 后台进程将自动上传 OSS')
}

main()
