/**
 * 渠道配置管理
 * 读写 ~/.cc-expand/channel.json
 */

import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { CONFIG_DIR } from './config.js'

export interface ChannelConfigData {
  /** 渠道名称 */
  channel: string
  /** 二进制路径 */
  path: string
  /** 版本号 */
  version: string
}

export class ChannelConfig {
  private filePath: string

  constructor(configDir: string = CONFIG_DIR) {
    this.filePath = join(configDir, 'channel.json')
  }

  /** 检查是否已保存渠道配置 */
  hasChannel(): boolean {
    return existsSync(this.filePath)
  }

  /** 读取渠道配置 */
  getChannel(): ChannelConfigData | undefined {
    if (!existsSync(this.filePath)) {
      return undefined
    }
    const raw = readFileSync(this.filePath, 'utf-8')
    return JSON.parse(raw) as ChannelConfigData
  }

  /** 保存渠道配置 */
  saveChannel(data: ChannelConfigData): void {
    writeFileSync(this.filePath, JSON.stringify(data, null, 2))
  }

  /** 删除渠道配置 */
  clearChannel(): void {
    if (existsSync(this.filePath)) {
      rmSync(this.filePath)
    }
  }
}
