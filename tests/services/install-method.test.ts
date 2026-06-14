/**
 * TDD Slice C: InstallMethodDetector — 安装方式检测深度模块
 *
 * 三级检测链：配置声明 → npm_config_user_agent → argv[1] 路径模式。
 * 通过 configService / argv1 / env 依赖注入隔离外部依赖。
 */
import { describe, it, expect, vi } from 'vitest'
import { InstallMethodDetector } from '../../src/services/install-method.js'
import type { UserConfigService } from '../../src/services/user-config.js'

describe('InstallMethodDetector', () => {
  function makeConfigService(installMethod: string): UserConfigService {
    return { get: vi.fn().mockReturnValue(installMethod) } as unknown as UserConfigService
  }

  it('配置声明 installMethod（非 unknown）时优先返回配置值', async () => {
    const detector = new InstallMethodDetector({
      configService: makeConfigService('pnpm'),
      env: { npm_config_user_agent: 'npm/10.0.0' },
      argv1: '/usr/local/lib/node_modules/cc-expand/dist/cli.js',
    })
    expect(await detector.detect()).toBe('pnpm')
  })

  it('env npm_config_user_agent 含 npm 时识别为 npm', async () => {
    const detector = new InstallMethodDetector({
      configService: makeConfigService('unknown'),
      env: { npm_config_user_agent: 'npm/10.2.0 node/20.0.0' },
    })
    expect(await detector.detect()).toBe('npm')
  })

  it('env npm_config_user_agent 含 pnpm 时识别为 pnpm', async () => {
    const detector = new InstallMethodDetector({
      configService: makeConfigService('unknown'),
      env: { npm_config_user_agent: 'pnpm/8.15.0' },
    })
    expect(await detector.detect()).toBe('pnpm')
  })

  it('env npm_config_user_agent 含 yarn 时识别为 yarn', async () => {
    const detector = new InstallMethodDetector({
      configService: makeConfigService('unknown'),
      env: { npm_config_user_agent: 'yarn/1.22.0' },
    })
    expect(await detector.detect()).toBe('yarn')
  })

  it('argv[1] 路径含 _npx 时识别为 npx', async () => {
    const detector = new InstallMethodDetector({
      configService: makeConfigService('unknown'),
      env: {},
      argv1: '/Users/foo/.npm/_npx/abc123/node_modules/cc-expand/dist/cli.js',
    })
    expect(await detector.detect()).toBe('npx')
  })

  it('所有信号缺失时返回 unknown', async () => {
    const detector = new InstallMethodDetector({
      configService: makeConfigService('unknown'),
      env: {},
      argv1: '/some/unknown/path/dist/cli.js',
    })
    expect(await detector.detect()).toBe('unknown')
  })
})
