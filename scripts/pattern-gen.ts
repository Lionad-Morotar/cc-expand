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
import { join } from 'node:path'
import { PatternDiscovery } from '../src/core/pattern-discovery.js'
import { ShardWriter } from '../src/services/shard-writer.js'
import type { OsPatterns } from '../src/services/pattern.js'
import type { PatchItem } from '../src/types/index.js'
import { classifyDesc } from '../src/services/desc-classifier.js'
import { isBytecodeVersion } from '../src/utils/version.js'
import { discoverBytecodeAnchor } from '../src/core/bytecode-anchor-discovery.js'
import { cleanupVersions } from './cleanup-versions.js'
import { PLATFORMS, downloadAndExtract, readFromExtracted, simulatePatch, flag } from './platform-artifacts.js'

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
  const bytecodePlatforms: string[] = []
  const workDir = join(process.cwd(), 'zRefs/claude-codes')

  for (const spec of PLATFORMS) {
    try {
      const buffer = fromExtracted
        ? readFromExtracted(fromExtracted, version, spec)
        : downloadAndExtract(version, spec, workDir)

      const discovered = new PatternDiscovery().discover(buffer)
      const patches: PatchItem[] = discovered.map((d) => ({ ...d, desc: classifyDesc(d.search) }))

      if (!simulatePatch(buffer, patches)) {
        throw new Error(`patch 模拟未全部命中(${spec.os}-${spec.arch})`)
      }

      // bytecode 锚点（2.1.246+）：bytecode 编译后运行时走常量池内联字节，文本替换只改
      // 嵌入源文本，必须从 bytecode 常量池发现字节锚点。语义过滤选 vGe 主项
      // （200000 + 32000/128000 伴生，与手工实证同语义）；失败仅降级该平台不阻断
      // 文本 patches——实证不过不配锚点。
      if (isBytecodeVersion(version)) {
        const vge = discovered.find(
          (d) => d.sourceValue === '200000' && d.search.includes('32000') && d.search.includes('128000')
        )
        if (!vge) {
          console.warn(
            `⚠ ${spec.os}-${spec.arch} bytecode 锚点降级: 未找到 200000/32000/128000 语义主项（仅文本 pattern，运行时可能不生效）`
          )
        } else {
          try {
            const anchors = discoverBytecodeAnchor(buffer, vge.search, 200000)
            patches[0].bytecodePatterns = anchors
            bytecodePlatforms.push(`${spec.os}-${spec.arch}`)
            console.log(`  bytecode 锚点: ${anchors.join(', ')}`)
          } catch (e) {
            console.warn(
              `⚠ ${spec.os}-${spec.arch} bytecode 锚点失败: ${(e as Error).message}（仅文本 pattern，运行时可能不生效）`
            )
          }
        }
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
  writer.upsertVersionIndex(version, platformsDone, bytecodePlatforms)
  console.log(`\n生成 ${patternsDir}/${version}.json (${platformsDone.length} 平台)`)
  console.log('watch:patterns 后台进程将自动上传 OSS')

  // 真实下载路径下顺带清理 >7 天的旧版本缓存（pattern 已在 OSS，本地缓存可重建）；
  // --from-extracted 是调试 dry-run，跳过清理避免干扰
  if (!fromExtracted) {
    cleanupVersions(workDir)
  }
}

main()
