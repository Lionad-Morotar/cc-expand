import { describe, it, expect } from 'vitest'
import { LatestChecker, queryLatestVersion } from '../../src/services/latest-checker.js'

describe('LatestChecker', () => {
  describe('check()', () => {
    // B13: latest 已在本地已处理列表中 → 无需工作
    it('returns needWork=false when latest is already processed locally', () => {
      const result = new LatestChecker().check('2.1.178', ['2.1.177', '2.1.178'])

      expect(result.latest).toBe('2.1.178')
      expect(result.needWork).toBe(false)
      expect(result.processed).toEqual(['2.1.177', '2.1.178'])
    })

    // B14: latest 不在本地 → 需要生成 pattern
    it('returns needWork=true when latest is missing from local versions', () => {
      const result = new LatestChecker().check('2.1.179', ['2.1.177', '2.1.178'])

      expect(result.needWork).toBe(true)
    })

    // B15: 跨版本跃迁(local 最高远低于 latest)仍正确识别需要工作
    it('returns needWork=true for a version jump (latest far ahead of local)', () => {
      const result = new LatestChecker().check('2.1.180', ['2.1.160', '2.1.161'])

      expect(result.needWork).toBe(true)
      expect(result.processed).toEqual(['2.1.160', '2.1.161'])
    })
  })
})

describe('queryLatestVersion', () => {
  // fake execFile：(cmd, args, opts, cb) => cb(error, stdout)
  type ExecCb = (error: Error | null, stdout: string) => void
  function fakeExec(stdout: string, error: Error | null = null) {
    return (_cmd: unknown, _args: unknown, _opts: unknown, cb: ExecCb) =>
      cb(error, stdout)
  }

  it('returns parsed version from npm JSON string output', async () => {
    const v = await queryLatestVersion(4000, fakeExec('"2.1.178"') as any)
    expect(v).toBe('2.1.178')
  })

  it('returns version from plain (non-JSON) semver output', async () => {
    const v = await queryLatestVersion(4000, fakeExec('2.1.178\n') as any)
    expect(v).toBe('2.1.178')
  })

  it('returns undefined on exec error (timeout/network)', async () => {
    const v = await queryLatestVersion(4000, fakeExec('', new Error('timed out')) as any)
    expect(v).toBeUndefined()
  })

  it('returns undefined for non-semver garbage output', async () => {
    const v = await queryLatestVersion(4000, fakeExec('garbage') as any)
    expect(v).toBeUndefined()
  })

  it('支持指定 packageName（如 cc-expand 自身），args 含对应包名', async () => {
    let capturedArgs: unknown
    const spyExec = (_cmd: unknown, args: unknown, _opts: unknown, cb: ExecCb) => {
      capturedArgs = args
      cb(null, '"0.3.5"')
    }
    const v = await queryLatestVersion(4000, spyExec as any, 'cc-expand')
    expect(v).toBe('0.3.5')
    expect((capturedArgs as readonly string[]).join(' ')).toContain('cc-expand@latest')
  })

  it('支持 distTag（alpha 通道），args 含 cc-expand@alpha', async () => {
    let capturedArgs: unknown
    const spyExec = (_cmd: unknown, args: unknown, _opts: unknown, cb: ExecCb) => {
      capturedArgs = args
      cb(null, '"0.4.0-alpha.2"')
    }
    const v = await queryLatestVersion(4000, spyExec as any, 'cc-expand', 'alpha')
    expect(v).toBe('0.4.0-alpha.2')
    expect((capturedArgs as readonly string[]).join(' ')).toContain('cc-expand@alpha')
  })
})
