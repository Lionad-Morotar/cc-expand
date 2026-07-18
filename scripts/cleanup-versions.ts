#!/usr/bin/env node
/**
 * 清理 zRefs/claude-codes 里超过 N 天的 Claude Code 版本缓存。
 *
 * 为什么用 npm 发布时间而不是文件 mtime：watch-patch / 手动批量下载会让一批
 * 版本的 mtime 全部相同（同一天落盘），mtime 无法区分"版本年龄"。npm registry
 * 的发布时间是唯一可靠的权威源，故取它作为"一周以前"的判定依据。
 *
 * 三类产物：extracted/v<x>/、tarballs/v<x>/、tarballs/*.tgz（扁平旧残留）。
 * 这些都是可重建的派生缓存——pattern 已在 OSS，binary 可重新 npm pack——故激进
 * 清理（只留一周）零风险。
 *
 * 用法:
 *   pnpm pattern:cleanup                       清理 >7 天的（默认执行）
 *   pnpm pattern:cleanup --dry-run             仅预览
 *   pnpm pattern:cleanup --max-age-days 14     自定义阈值
 *   pnpm pattern:cleanup --work-dir <dir>      自定义根目录
 *
 * pattern-gen 在成功生成后自动调用本模块的 cleanupVersions（见 pattern-gen.ts 末尾）。
 */
import { execSync, spawnSync } from 'node:child_process'
import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const DEFAULT_MAX_AGE_DAYS = 7

export interface CleanupResult {
  deletedPaths: string[]
  reclaimedKB: number
}

/** 拉取 npm 全语义版本发布时间：'2.1.214' -> epoch ms */
function fetchNpmVersionTimes(): Record<string, number> {
  const out = spawnSync('npm', ['view', '@anthropic-ai/claude-code', 'time', '--json'], {
    encoding: 'utf-8',
  })
  if (out.status !== 0) {
    throw new Error(`npm view time 失败: ${out.stderr}`)
  }
  const time = JSON.parse(out.stdout) as Record<string, string>
  const result: Record<string, number> = {}
  for (const [k, v] of Object.entries(time)) {
    if (/^\d+\.\d+\.\d+$/.test(k)) {
      const ms = Date.parse(v)
      if (!Number.isNaN(ms)) result[k] = ms
    }
  }
  return result
}

const semverCmp = (a: string, b: string): number => {
  const [a1, a2, a3] = a.split('.').map(Number)
  const [b1, b2, b3] = b.split('.').map(Number)
  return a1 - b1 || a2 - b2 || a3 - b3
}

interface Target {
  path: string
  ver: string | undefined
}

function scanVerDirs(workDir: string, sub: string): Target[] {
  const base = join(workDir, sub)
  try {
    return readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^v\d/.test(d.name))
      .map((d) => ({ path: join(base, d.name), ver: d.name.slice(1) }))
  } catch {
    return []
  }
}

function scanFlatTgz(workDir: string): Target[] {
  const base = join(workDir, 'tarballs')
  try {
    return readdirSync(base)
      .filter((f) => f.endsWith('.tgz'))
      .map((f) => ({ path: join(base, f), ver: (f.match(/(\d+\.\d+\.\d+)/) || [])[1] }))
  } catch {
    return []
  }
}

function dirKB(p: string): number {
  try {
    return parseInt(execSync(`command du -sk "${p}"`, { encoding: 'utf8' }), 10)
  } catch {
    return 0
  }
}

type Decision = 'delete' | 'keep' | 'unknown'
function decide(ver: string | undefined, times: Record<string, number>, threshold: number): Decision {
  // npm 查不到的版本（太新或非语义版本）一律保留，绝不盲删
  if (!ver) return 'unknown'
  const t = times[ver]
  if (t == null) return 'unknown'
  return t < threshold ? 'delete' : 'keep'
}

/**
 * 清理 workDir 下超过 maxAgeDays 的 CC 版本缓存。
 * dryRun=true 仅报告不删。返回已删路径与回收 KB。
 */
export function cleanupVersions(
  workDir: string,
  maxAgeDays = DEFAULT_MAX_AGE_DAYS,
  dryRun = false,
): CleanupResult {
  const threshold = Date.now() - maxAgeDays * 86_400_000
  const times = fetchNpmVersionTimes()
  const targets = [
    ...scanVerDirs(workDir, 'extracted'),
    ...scanVerDirs(workDir, 'tarballs'),
    ...scanFlatTgz(workDir),
  ]

  // 按版本聚合（同版本 extracted + tarballs + 扁平 tgz 合并显示）
  const byVer = new Map<string, { decision: Decision; paths: string[]; kb: number }>()
  for (const t of targets) {
    const decision = decide(t.ver, times, threshold)
    const key = t.ver ?? '????'
    const e = byVer.get(key) ?? { decision, paths: [], kb: 0 }
    e.paths.push(t.path)
    e.kb += dirKB(t.path)
    byVer.set(key, e)
  }

  const rows = [...byVer.entries()]
    .map(([ver, r]) => ({ ver, ...r }))
    .sort((a, b) => semverCmp(a.ver, b.ver))

  const deletedPaths: string[] = []
  let reclaimedKB = 0
  for (const r of rows) {
    if (r.decision === 'delete') {
      deletedPaths.push(...r.paths)
      reclaimedKB += r.kb
      if (!dryRun) {
        for (const p of r.paths) rmSync(p, { recursive: true, force: true })
      }
    }
  }

  // 详细输出：有删除项时列每版本一行，无则安静
  const tag = dryRun ? '[dry-run]' : '[cleaned]'
  if (deletedPaths.length > 0) {
    for (const r of rows) {
      if (r.decision !== 'delete') continue
      const date = times[r.ver] ? new Date(times[r.ver]).toISOString().slice(0, 10) : '????'
      console.log(`  ${tag} v${r.ver} ${date} ${(r.kb / 1024).toFixed(0)}MB ×${r.paths.length}`)
    }
  }
  const gb = (reclaimedKB / 1024 / 1024).toFixed(1)
  console.log(`${tag} 阈值 ${new Date(threshold).toISOString().slice(0, 10)} 前 | 删 ${deletedPaths.length} 路径 | ≈${gb}GB${dryRun ? '（dry-run 未删）' : ''}`)
  return { deletedPaths, reclaimedKB }
}

function flag(rest: string[], name: string): string | null {
  const idx = rest.indexOf(name)
  return idx >= 0 ? (rest[idx + 1] ?? null) : null
}

function main(): void {
  const rest = process.argv.slice(2)
  const dryRun = rest.includes('--dry-run')
  const maxAgeDays = Number(flag(rest, '--max-age-days') ?? DEFAULT_MAX_AGE_DAYS)
  const workDir = flag(rest, '--work-dir') ?? join(process.cwd(), 'zRefs/claude-codes')
  cleanupVersions(workDir, maxAgeDays, dryRun)
}

// 直接运行走 CLI；被 import 时只暴露函数（不在 pattern-gen 里误触发 main）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
