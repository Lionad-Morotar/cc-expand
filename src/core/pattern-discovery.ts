/**
 * Pattern 发现引擎(与 patch-engine 对偶:一个生产 pattern,一个消费 pattern)
 * 从 Claude Code 二进制中定位上下文窗口相关的混淆常量,产出可唯一搜索的 pattern 串
 */
import { CcxError, ErrorCode } from '../types/index.js'

export interface DiscoveredPattern {
  /** 唯一定位用的搜索串(含版本特定混淆变量名 + 贪婪伴生字段) */
  search: string
  /** 待替换的源常量值 */
  sourceValue: string
}

/** 期望的 =200000 上下文窗口锚点数(2.1.205 及更早为 5;2.1.206–2.1.209 为 7;2.1.210 起合并为 6;2.1.218 起扩展为 8;2.1.227 起伴生 200000+expr 表达式锚点,被 lookahead 过滤后真配置常量仍 8) */
const EXPECTED_ANCHOR_COUNTS = [5, 6, 7, 8]

/**
 * 真 context 配置常量的伴生字段签名值。
 * 2.1.235 起二进制中出现大量 =200000 的显示截断/噪声常量(approval 预览、stub render、
 * systemd userdb 等),它们不携带这些签名;签名值来自 model 表/预算常量的稳定伴生数值,
 * 在 2.1.228–2.1.235 全平台验证与已发布 shard 等价
 */
const COMPANION_SIGNATURES = new Set(['32000', '128000', '1e6', '1536', '26214400', '50000000', '50'])

/** 解析贪婪伴生字段串为 [name, value] 对列表(`,a=1,b=2` → [['a','1'],['b','2']]) */
function parseFields(fields: string): Array<[string, string]> {
  return [...fields.matchAll(/,([A-Za-z0-9_$]+)=([0-9eE._]+)/g)].map(m => [m[1], m[2]])
}

export class PatternDiscovery {
  /**
   * 从二进制 buffer 中发现上下文窗口 pattern
   *
   * 结构不变量(任一违反抛 PATTERN_DISCOVERY_FAILED,触发人工兜底):
   * - =200000 锚点(排除 20000000 噪声、200000+expr 表达式与无签名伴生的显示截断常量后)
   *   数量为 5、6、7 或 8 个
   * - exceeds200k 阈值 `>200000:!1}` 恰好出现 1 次
   * 这些不变量在已发布版本上未被违反;保留守卫是为应对未来版本增删模式。
   *
   * @param buffer Claude Code 平台二进制
   * @returns 发现的 pattern 列表(6 至 9 条)
   */
  discover(buffer: Buffer): DiscoveredPattern[] {
    const text = buffer.toString('latin1')
    const out: DiscoveredPattern[] = []

    // =200000 上下文窗口锚点;(?![0-9+\-*/%]) 同时排除数字噪声(20000000)与表达式形态(200000+T3i 这类 git/crypto buffer)，
    // 后者非 LLM 上下文窗口配置常量(2.1.227 起新增),避免误 patch 计算式里的 200000
    const anchors = [...text.matchAll(/[A-Za-z0-9_$]+=200000(?![0-9+\-*/%])/g)]
    for (const m of anchors) {
      // 贪婪吃掉紧随其后的连续伴生字段 ,VAR=NUM,增强抗版本漂移
      const after = text.slice(m.index + m[0].length)
      const fields = after.match(/^(,[A-Za-z0-9_$]+=[0-9eE._]+)+/)?.[0] ?? ''
      const pairs = parseFields(fields)

      const isContextConstant
        // 伴生数值命中已知签名(model 表 32000/128000/1e6、teamMemory 1536、
        // budget 26214400/50000000、tool-results 50)
        = pairs.some(([, v]) => COMPANION_SIGNATURES.has(v))
          // file-read 预算常量的单字段伴生形态 ,VAR=64
          || (pairs.length === 1 && pairs[0][1] === '64')
          // memories API 的 max-size 常量:裸锚紧邻 ,VAR="/memories" 路径初始化
          || /^,[A-Za-z0-9_$]+="\/memories"/.test(after.slice(fields.length))
      if (!isContextConstant) continue

      out.push({ search: m[0] + fields, sourceValue: '200000' })
    }

    if (!EXPECTED_ANCHOR_COUNTS.includes(out.length)) {
      throw new CcxError(
        ErrorCode.PATTERN_DISCOVERY_FAILED,
        `Expected context-window anchors to be one of ${EXPECTED_ANCHOR_COUNTS.join(', ')}, found ${out.length}`,
        '二进制结构可能突变(模式增减),需人工核对混淆变量'
      )
    }

    // 超过 200k 的阈值判断,规范化为裸串
    const exceedsMatches = text.match(/>200000:!1}/g) ?? []
    if (exceedsMatches.length !== 1) {
      throw new CcxError(
        ErrorCode.PATTERN_DISCOVERY_FAILED,
        `Expected exactly 1 exceeds200k threshold, found ${exceedsMatches.length}`,
        'exceeds200k 阈值结构可能变化,需人工核对'
      )
    }
    out.push({ search: '>200000:!1}', sourceValue: '200000' })

    return out
  }
}
