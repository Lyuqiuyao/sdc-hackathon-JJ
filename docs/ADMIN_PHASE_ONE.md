# 管理员端第一阶段：业务事实、ESG 中立性与合成输入

## 范围与工作区

只处理管理员端及直接依赖的服务、契约和测试。未重写风险公式、四维评分、
排程、审批或模拟执行。未修改认证员端、客户端、Secret 或原有凭据。
开始时 Git 工作区只有本轮上传说明未跟踪，没有已修改的代码；附件保持不变。

## 实现与文件清单

后端目录：`artifacts/api-server/src/lib/receivables/`。

| 文件 | 目的 |
| --- | --- |
| `ai-preflight.ts`（新增） | 纯函数检查当前计划版本、Pending、人工修改、关联、任务唯一性、0/50/51 边界、整数金额、MYR、有效日期、逾期天数、分数类型和数据签名。稳定 reasonCode，在 Transport 前阻断 |
| `ai-content-safety.ts`（新增） | 受限内部措辞校验；客户通知一律来自现有权威模板；ESG 考量只由业务记录提供；未知 ESG 的全部任务正文及含未知 ESG 的全局风险解释采用受控投影 |
| `ai-provider.ts` | 接入上述边界；保留原严格 Schema、本地 Zod、任务匹配、45 秒取消、8192 tokens、零重试和 Rules 回退；投影后再次完整 Zod 校验 |
| `ai-enrichment.ts`（新增） | 抽出相同编排逻辑，接受 Repository 接口；可用内存替身验证且不导入数据库 |
| `ai-generation.ts` | 生产 Repository 的薄适配，不改变业务 API 或事务规则 |
| `service.ts` | 新通知诚实标记 `rules_fallback`；审计说明受控内容；CSV 审计记录用户声明且来源未验证 |
| `csv.ts` | 要求显式合成数据确认；保存“用户声明 synthetic/demo、provenance unverified”来源；保留原子导入和既有金额/日期/重复校验 |
| `artifacts/receivables-admin/src/pages/receivables.tsx` | 确认框、禁止未确认上传、发送新契约字段；不执行任何实际导入 |
| `artifacts/receivables-admin/src/components/provider-details.tsx` | 显示前置失败原因及受控内容来源；只对新内容策略标记显示新说明 |
| 同目录 `plan.tsx` | 避免把受控建议统一称为 AI 原创 |
| `lib/api-spec/openapi.yaml` | ImportInput 必填 `demoDataConfirmed`；AIGeneration 可选 `contentPolicy: server_controlled_v1` |
| `lib/api-client-react/src/generated/api.schemas.ts` | 生成的前端契约 |
| `lib/api-zod/src/generated/api.ts`、`types/{aIGeneration,aIGenerationContentPolicy,importInput,index}.ts` | 生成的服务端契约与类型 |
| `artifacts/api-server/tests/phase-one.test.ts`（新增） | 39 个无费用边界、安全、CSV 原子性和内存编排用例 |
| 同测试目录 `gemini.test.ts`、`managed-openai.test.ts`、`openai-safety.test.ts`、`managed-startup.ts` | 夹具改为当前计划；通知来源断言改为受控模板；保留原安全断言 |
| `artifacts/api-server/test-workflow.mjs` | 把新用例加入现有隔离模拟 runner |
| 本报告、迁移报告链接、项目记忆 | 记录安全取舍与验收边界 |

## 内容安全取舍

- 关键客户义务不由模型文本决定。即使模型 notice 看起来正确，最终通知也使用
  `communication()` 的金额、日期、逾期天数及条件式模板，不接受模型批准延期。
- 明显错误数值、日期、未经批准承诺、额外字段、不完整任务等整份拒绝。
  结构合法也不等于事实正确。
- 未知 ESG：evidence/rating 必须匹配；已知危险推断拒绝。
  对不含关键词的间接推断，未知任务的 reasoning、assumptions、uncertainties、
  strategies、notice 和 ESG 说明均由服务器投影，避免把关键词规则当作完整语义保证。
  只要计划含未知 ESG，全局解释也来自既有确定性风险理由。
- 已有有效审核记录：ESG 说明仅复述合成评级与辅助用途，不进行新评级、真伪判断或信用预测。
- `openai/success` 仍表示一次模型响应通过当前结构/业务校验，不表示所有显示文字
  都由模型原创。新 `contentPolicy`、逐语言规则来源及 UI 说明区分这一点。
- 新策略统一增加“另行人工审核及客户同意，不代表合同变更已批准”的条件。
- 历史 Gemini/OpenAI 记录不添加新标记或改写内容；人工后续编辑保持既有 human 来源。
- CSV 确认仅是用户声明，不是数据识别器；不能证明文件不含真实信息。

## 实际运行

| 命令/检查 | 最终结果 |
| --- | --- |
| `pnpm --filter @workspace/api-spec run codegen` | 通过，含共享库类型检查 |
| `pnpm --filter @workspace/api-server run test:workflow` | **89/89 通过**，原 50 项回归 + 新 39 项 |
| `PORT=3000 BASE_PATH=/ pnpm run build` | 类型检查和所有包构建通过；包大小/sourcemap 非阻断警告 |
| `git diff --check` | 通过 |
| 前后端工作流恢复 | RUNNING；API 启动正常 |
| `/login` 截图 | 渲染正常，无浏览器错误；未点击登录或导入/审批/执行 |

首轮 84/85：一个旧响应测试切换 AI 模式后复用旧计划，被新的 stale_context 先拦截。
修正夹具为生成当前计划，没有放宽断言。随后 86/86。
首轮构建发现一处 TypeScript 未收窄可选风险记录，改成显式拒绝分支。
补齐当前版本、人改保护和 50 项上限测试后，最终 89/89、类型检查和构建通过。

## 无费用测试证据

新增用例证明：
- 缺计划/风险/客户/发票、关联错误、空任务、重复 ID、超量、过期、人改、
  非 Pending、更新版本、错误金额/日期/币种：Transport 调用数为零。
- 恰好 50 项仍可进入模拟 Transport，未扩大原有上限。
- 上下文金额分、MYR、到期日、罚息 bps、分数和顺序与业务计划一致。
- 错误金额/日期、英马延期承诺、内部编造费用不作为有效建议应用。
- 八条文本路径上的显式负面未知 ESG 推断不能通过；无关键词间接推断也不能进入
  最终未知任务正文或全局解释。
- 专用 ESG 文本和双语客户通知来自服务器；未知 ESG 评分仍为 50。
- 缺少确认、非法日期、重复记录、小数精度错误不留下部分发票、客户或审计。
- 内存 Repository 下，同进程并发只调用一个 Transport；迟到响应不能覆盖人改版本。

原测试再次通过：R1–R5、四维精确计算、ESG 中立、拒绝/版本替代/过期阻断、
审批门禁、重复模拟执行幂等、现金和账单不变、托管配置缺失、初始化失败、
超时取消、模拟 429/504、截断、严格 Schema 及历史来源保留。

Runner 只使用合成凭据、内存数据和注入的假 fetch，默认全局 fetch 被禁止。
没有运行 `test:openai-live`、Gemini live 或写共享状态的 `api-workflow.mjs`。

## 数据库与浏览器边界（重要）

测试及手动命令没有连接/查询共享业务数据库，没有实际执行导入、设置保存、
审批、执行或重置请求。没有真实模型请求、通知、收款或转账，没有改 Secret。

但恢复服务后，工作流日志实际出现 GET `/api/workspace` 200；
按现有路由，它会读取共享数据库。现有前端具有轮询能力，但日志不能确认具体调用者。
因此不能声称整个运行环境在本轮期间绝对没有数据库读取。
日志来源：`/tmp/logs/artifactsapi-server_API_Server_20261021_104204_685_cf80531b.log`。
未观察到本轮检查发出的业务写接口；本轮没有调用这些接口或运行迁移。
未检查数据库前后值，不据此额外宣称数据库状态已逐项比对。

为了不主动读共享业务数据，只截图 `/login`，未进行 CSV 页面/审批页面真实交互验收。
这些 UI 交互仍待在隔离后端中验证。

## 剩余风险/后续范围

1. 自然语言限制是保守过滤，不是通用事实/语言鉴别。已审核 ESG 客户的内部 AI
   建议仍可能有不含受限词的误导表述，必须人工审核；对外通知不使用此文本。
   保守限制也可能拒绝无害措辞并回退，真实输出可用率尚未测量。
2. 所有未知 ESG 任务采用受控正文，减少 AI 自由措辞；这是有意的安全取舍。
3. CSV 声明不能识别伪装成合成数据的真实记录，不能当作隐私防泄漏工具。
4. 跨进程付费调用去重、不可变完整 AI 输出审计快照、后台自动监测不在本阶段实现。
5. 真实托管生成、8192 tokens/45 秒适配和账户额度未验收。
6. 本轮没有验证生产数据库并发或浏览器完整操作；内存测试不等于这些验收。
