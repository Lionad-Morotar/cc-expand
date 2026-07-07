# ADR 0004：CcxError / ErrorCode 单一来源

日期：2026-06-25
状态：Accepted
关联：[ADR 0003](./0003-plugin-unified-patch-abstraction.md)（plugin 体系，token 工具搬入子包）、[CONTEXT.md](../../CONTEXT.md)

## 背景

ADR 0003 把 token 工具（encodeTokenLiteral / parseTokenCount / formatTokenCount）搬入子包 `@cc-expand/plugin-context-expand`。子包内部抛错误需要 CcxError，但子包不能 import root（root 依赖子包，反向依赖会成环），于是子包**复制了一份**精简版 CcxError / ErrorCode（仅 INVALID_TARGET）。

后果：root 与子包各有一份 CcxError 类。`instanceof CcxError` 跨包失效——子包 encodeTokenLiteral 抛的是子包 CcxError，root 代码 `catch (e) { if (e instanceof CcxError) }` 判断的是 root CcxError，两者不同类，instanceof 永远 false。

临时止血：新增 `isCcxError(e)` 守卫（按 `name === 'CcxError' && typeof code === 'string'` 识别），patch-engine 等消费方改用守卫。功能正确，但 instanceof 这一标准手段失效是基础设施债——未来新消费方仍可能误用 instanceof。

## 决策

**CcxError / ErrorCode 的单一来源定为子包 `packages/plugin-context-expand/src/ccx-error.ts`**，root `src/types/index.ts` 通过 `import` + `export` re-export 它。root 与子包从此用**同一个 CcxError 类**，`instanceof` 跨包自然恢复有效。

子包 ccx-error.ts 的 ErrorCode 扩展为完整 11 个错误码（原仅 INVALID_TARGET），承担通用错误定义职责。isCcxError 守卫保留——单一来源后 instanceof 已可用，但守卫对来自 JSON / 边界（非 Error 子类）的对象更稳健，且语义自文档化。

## 理由

- **依赖方向决定来源位置**：root 依赖子包（workspace），子包不能依赖 root（循环）。跨包共享的类型必须定义在依赖图的底层，即子包侧。任何"root 定义、子包 import"的方案都会引入环。
- **re-export 保持 import 路径不变**：root 代码继续 `import { CcxError } from '../types/index.js'`，无需改动消费方。这是 re-export 而非搬迁消费方的好处。
- **instanceof 是标准手段**：守卫是补丁，instanceof 才是 JS 生态惯例。恢复它让错误处理回归直觉，降低新代码误用风险。

## 后果

- 正面：instanceof 跨包有效；错误处理回归标准；消除双份定义的认知负担。
- 负面 / 折衷：通用错误（CcxError/ErrorCode）暂居 token 专属子包，命名上有轻微职责违和。
- 演进方向：当通用共享类型增多，拆出独立子包 `@cc-expand/errors`，root 与 plugin-context-expand 都依赖它。当前 token 子包暂代，避免一次建太多包。

## 考虑过的替代方案

- **新建 `packages/errors`（@cc-expand/errors）**：职责最清晰，但引入第三个包 + 双向 workspace 依赖配置，当前收益不抵成本。留作演进方向。
- **root 定义、子包 import root**：引入循环依赖（子包 → root → 子包），不可行。
- **保持双份 + isCcxError 守卫**：功能正确但 instanceof 永久失效，是持续的基础设施债。本 ADR 即为消除它。
