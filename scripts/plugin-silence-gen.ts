#!/usr/bin/env node
/**
 * 为指定 Claude Code 版本生成 silence-unrecognized-model 插件的 shard
 *
 * 用法:
 *   pnpm plugin:gen-silence <version>                        完整流程(下载→发现→探活→写)
 *   pnpm plugin:gen-silence <version> --from-extracted <dir> 跳过下载,用已解压目录
 *   pnpm plugin:gen-silence <version> --no-probe             跳过 runtime 探活(仅单候选时允许)
 *   pnpm plugin:gen-silence <version> --shards-dir <dir>     指定输出目录
 *
 * 判别链路：模块 signature 定位 + 指令骨架扫描给出结构候选；候选中哪个是告警发射器
 * Yre 在字节层面同形不可判，须在本机平台做 runtime 探活（patch 副本→跑探针→查
 * stderr 告警消失）选定；其余平台按锚字节序列对齐——各平台 blob 布局不同构
 * （模块顺序与常量池互异，blob 内偏移不可作对齐键），但 guard 指令序列本身一致，
 * Yre 锚在其他平台全 binary 恰好唯一出现（v2.1.285 五平台实证）。
 *
 * 产出 plugin-shards/silence-unrecognized-model/{version}.json + versions.json，
 * 上传 OSS 由 scripts/oss-upload.ts --prefix 单独执行
 */
import { mkdtempSync, rmSync, copyFileSync, chmodSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { discoverSilenceGuardCandidates, type SilenceGuardCandidate } from '../src/core/silence-guard-discovery.js'
import { ShardWriter } from '../src/services/shard-writer.js'
import type { OsPatterns } from '../src/services/pattern.js'
import { PLATFORMS, downloadAndExtract, readFromExtracted, simulatePatch, flag, findBinary } from './platform-artifacts.js'

/** 探针用非白名单模型：任何 CC 不认识的模型名都会触发 unrecognized_model 告警 */
const PROBE_MODEL = 'glm-5.3'
/** 探针超时：探活跑完整 CLI 启动 + 一次 API 往返，留足冷启动余量 */
const PROBE_TIMEOUT_MS = 120_000
const WARN_MARKER = 'unrecognized_model'

interface PlatformResult {
  spec: (typeof PLATFORMS)[number]
  candidates: SilenceGuardCandidate[]
}

/** 探针观察：告警是否出现 + CLI 是否正常应答（二次确认用） */
interface ProbeObservation {
  warned: boolean
  replied: boolean
}

/**
 * 跑探针：stderr 是否含告警标记 + stdout 是否有实际回复。
 * 探针自身失败（超时被杀、无法 spawn）必须 throw 而非返回 false——
 * 失败探针的 stderr 为空或截断，会被误读为「告警已消除」，在无效观察下
 * 选出的候选会直接进 shard。exit code 不作判据（API 层失败时告警判定仍有效）
 */
function probeBinary(binPath: string): ProbeObservation {
  const r = spawnSync(binPath, ['-p', 'reply with exactly: pong'], {
    env: { ...process.env, ANTHROPIC_MODEL: PROBE_MODEL },
    encoding: 'buffer',
    timeout: PROBE_TIMEOUT_MS,
  })
  if (r.error || (r.status === null && r.signal)) {
    throw new Error(`探针执行失败（${r.error?.message ?? `signal ${String(r.signal)}`}），无法判定告警状态，拒绝在无效观察下选定候选`)
  }
  return {
    warned: (r.stderr?.toString('utf8') ?? '').includes(WARN_MARKER),
    replied: (r.stdout?.toString('utf8') ?? '').includes('pong')
  }
}

/** darwin 上修改二进制后必须重签名（ad-hoc）才能执行 */
function adHocCodesign(binPath: string): void {
  if (process.platform !== 'darwin') return
  const r = spawnSync('codesign', ['--force', '--sign', '-', binPath], { encoding: 'utf8' })
  if (r.status !== 0) {
    throw new Error(`ad-hoc codesign 失败 ${binPath}: ${r.stderr}`)
  }
}

/**
 * runtime 探活选 Yre：先验证探针环境有效（未 patch 副本必须告警），再逐候选
 * patch 副本探针；告警消失即命中。未命中恢复字节继续，全部未命中 throw。
 * 副本用完即删，原 binary 文件不被触碰。
 */
function selectYreByProbe(binPath: string, candidates: SilenceGuardCandidate[]): SilenceGuardCandidate {
  const workDir = mkdtempSync(join(tmpdir(), 'ccx-silence-probe-'))
  try {
    const copyPath = join(workDir, 'claude')
    copyFileSync(binPath, copyPath)
    chmodSync(copyPath, 0o755)
    adHocCodesign(copyPath)

    const original = readFileSync(copyPath)
    if (!probeBinary(copyPath).warned) {
      throw new Error(
        `探针环境无效：未 patch 副本未出现 ${WARN_MARKER} 告警（检查 ANTHROPIC_MODEL=${PROBE_MODEL} 是否仍被识别或 API 不可用），拒绝在无效探针下选定锚点`,
      )
    }

    for (const c of candidates) {
      const buf = Buffer.from(original)
      buf.write('\u0004', c.offset, 'latin1')
      writeFileSync(copyPath, buf)
      adHocCodesign(copyPath)
      const observed = probeBinary(copyPath)
      // 恢复未 patch 形态，下一候选与收尾都从原始字节出发
      writeFileSync(copyPath, original)
      // 命中须双证：告警消失且 CLI 仍正常应答——「CLI 崩溃/无输出」不是消音
      if (!observed.warned && observed.replied) {
        console.log(`  探活命中: blob 内偏移 ${c.offsetInModule}（告警消失，应答正常）`)
        return c
      }
      if (!observed.warned && !observed.replied) {
        throw new Error(`候选 blob 内偏移 ${c.offsetInModule} 告警消失但 CLI 无应答，疑似 patch 破坏执行，须人工核查`)
      }
      console.log(`  探活未命中: blob 内偏移 ${c.offsetInModule}，恢复后继续`)
    }
    throw new Error(`全部 ${candidates.length} 个候选探活未命中，告警发射器不在候选内，须人工重研究`)
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

function main(): void {
  const version = process.argv[2]
  const rest = process.argv.slice(3)
  if (!version) {
    console.error('用法: pnpm plugin:gen-silence <version> [--from-extracted <dir>] [--no-probe] [--shards-dir <dir>]')
    process.exit(1)
  }

  const fromExtracted = flag(rest, '--from-extracted')
  const noProbe = rest.includes('--no-probe')
  const shardsDir = flag(rest, '--shards-dir')
    ?? join(process.cwd(), 'plugin-shards', 'silence-unrecognized-model')
  const workDir = join(process.cwd(), 'zRefs/claude-codes')
  // 两种获取路径的解压布局同构（downloadAndExtract 也写到 extracted/v<version>/<os-arch>）
  const extractRoot = fromExtracted ?? join(workDir, 'extracted')

  /** 定位某平台解压后的 binary 文件路径（兼容 package/ 与平铺两种布局） */
  const resolveBin = (spec: (typeof PLATFORMS)[number]): string => {
    const bin = findBinary(join(extractRoot, `v${version}`, `${spec.os}-${spec.arch}`), spec.binary)
    if (!bin) throw new Error(`未找到 ${spec.os}-${spec.arch} 的解压 binary`)
    return bin
  }

  const results: PlatformResult[] = []
  for (const spec of PLATFORMS) {
    try {
      const buffer = fromExtracted
        ? readFromExtracted(fromExtracted, version, spec)
        : downloadAndExtract(version, spec, workDir)
      const candidates = discoverSilenceGuardCandidates(buffer)
      results.push({ spec, candidates })
      console.log(`✓ ${spec.os}-${spec.arch}: ${candidates.length} 个候选`)
    } catch (e) {
      console.warn(`⚠ 跳过 ${spec.os}-${spec.arch}: ${(e as Error).message}`)
    }
  }
  if (results.length === 0) {
    console.error('无平台成功,中止')
    process.exit(1)
  }

  // 本机平台探活选定 Yre 锚；其余平台按锚字节序列对齐（见文件头注释）
  const native = results.find(r => r.spec.os === process.platform && r.spec.arch === process.arch)
  let yreAnchor: string | null = null
  if (native) {
    if (native.candidates.length > 1 && noProbe) {
      console.error(`本机平台 ${native.spec.os}-${native.spec.arch} 有 ${native.candidates.length} 个候选且 --no-probe，结构不可判别，中止`)
      process.exit(1)
    }
    if (!noProbe) {
      console.log(`探活选择 Yre（本机 ${native.spec.os}-${native.spec.arch}）...`)
      const yre = selectYreByProbe(resolveBin(native.spec), native.candidates)
      yreAnchor = yre.search
    } else if (native.candidates.length === 1) {
      yreAnchor = native.candidates[0].search
      console.log('单候选且 --no-probe，直接采用（跳过探活）')
    }
  } else {
    console.warn('⚠ 本机平台不在成功列表中，无法探活')
  }

  if (yreAnchor === null) {
    console.error('未获得 Yre 选定（探针失败或本机平台缺席），中止')
    process.exit(1)
  }

  // 各平台按锚字节对齐选定候选，组装 shard
  const osPatterns: OsPatterns = {}
  const platformsDone: string[] = []
  for (const r of results) {
    const chosen = r.candidates.find(c => c.search === yreAnchor)
    if (!chosen) {
      throw new Error(
        `${r.spec.os}-${r.spec.arch} 无与 Yre 锚字节一致的候选：guard 指令序列跨平台不同构，须人工重研究`,
      )
    }
    const buffer = readFileSync(resolveBin(r.spec))
    if (!simulatePatch(buffer, [chosen])) {
      throw new Error(`${r.spec.os}-${r.spec.arch} 选定候选 patch 模拟未命中`)
    }
    if (!osPatterns[r.spec.os]) osPatterns[r.spec.os] = {}
    // shard 只落 PatchItem 契约字段：offset/offsetInModule 是发现与探活的内部
    // 状态（文件偏移因平台布局而异，进 shard 只会产生跨平台误导）
    osPatterns[r.spec.os][r.spec.arch] = [{
      search: chosen.search,
      sourceValue: chosen.sourceValue,
      target: chosen.target,
      desc: chosen.desc
    }]
    platformsDone.push(`${r.spec.os}-${r.spec.arch}`)
  }

  const writer = new ShardWriter({ patternsDir: shardsDir })
  writer.writeShard(version, osPatterns)
  writer.upsertVersionIndex(version, platformsDone)
  console.log(`\n生成 ${shardsDir}/${version}.json (${platformsDone.length} 平台)`)
}

main()
