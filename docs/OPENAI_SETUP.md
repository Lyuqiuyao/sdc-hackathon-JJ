# OpenAI 迁移与实际验收

> 历史直连资料：正式应用现已改为 Replit 托管 OpenAI，当前接入不再使用私人 Key。
> 本文保留之前直连迁移和 429 证据，不代表当前配置。当前说明见
> [REPLIT_MANAGED_OPENAI.md](REPLIT_MANAGED_OPENAI.md)；本轮未进行真实托管模型调用。

## 当前结论（2026-10-21）

正式提供方已从 Gemini 切换为 OpenAI，未重建项目、未改变页面布局。
已安装官方 `openai@7.39.0`；模型常量为 `OPENAI_MODEL = "gpt-5-mini"`。
模型官方文档列有 Responses API 和 Structured Outputs 支持：
https://developers.openai.com/api/docs/models/gpt-5-mini
文档支持不代表此密钥/项目实际可调用。真实请求返回 429，尚无真实成功生成证据。

服务端从 `process.env.OPENAI_API_KEY` 读取密钥，不写入前端、文件或日志。
本轮没有修改 Secrets；保留原 `GEMINI_API_KEY`。

## 请求与校验

- 官方 SDK `client.responses.create`，固定 `https://api.openai.com/v1`。
- 严格结构化输出：`text.format.type = json_schema`、`strict = true`。
- 全部对象禁止额外字段，所有业务输出字段必填。
- 由现有 Zod Schema 派生 wire schema；移除 `$schema` 和字符串/数组长度关键词以使用保守的 wire 子集。
  **本地原有长度、数量及业务校验全部保留**，不以 wire schema 替代本地校验。
- `max_output_tokens: 24000`，`reasoning.effort: minimal`，`store: false`。
- 45 秒超时、AbortSignal 取消、SDK `maxRetries: 0`；不自动改换提供方。
- 无密钥、超时、API 错误、空响应/不完整响应、无效 JSON、Schema 失败、
  重复/缺少任务、重复方案类型、ESG 评级/证据不匹配均安全回退。
- 不改变确定性金额、日期、四维评分、权重、排序或初步方法。
- 三种条件式方案 payment_full / installments / extension、EN/MS 通知必须存在。
- 英文必须含 Synthetic Demo draft 和 no message sent；
  马来文必须含 Draf demo sintetik 和 tiada mesej dihantar。
- 缺失/未核实 ESG 仍 unknown、neutral；相关内部警示由服务端写入中立声明。
- 仅允许合并建议文字，不批准、不发送、不扣款、不转账、不改付款状态。
- 提示词禁止编造发票号、联系人、银行信息、认证、费用、合同或违约概率；
  语义真实性不能仅靠 JSON Schema 证明，仍必须人工审阅。

## 历史兼容，不改写旧记录

新 UI 只提供 Rules 和 OpenAI；新请求 `requestedProvider: openai`，
有效输出来源为 `openai`，失败为 `rules_fallback`。
历史 `gemini` 枚举仅为读取旧设置、方案、来源与审计记录保留；
后端拒绝重新保存 Gemini 模式，旧模式不调用任何模型。
若历史设置仍为 Gemini，页面提示管理员显式选择并保存 Rules/OpenAI。
不批量改写历史设置/风险快照/方案签名，不把历史内容重新标成 OpenAI。

`legacy-gemini.ts` 保留旧 SDK transport，正式路由不导入、不选择它。
旧 Gemini live/API 测试入口已禁用，避免误调用 Google。
原 `@google/genai` 依赖和 `GEMINI_API_KEY` 未删除；
正式 OpenAI 路径不依赖该密钥。真实成功验收尚未完成，建议暂留回查资料，
后续确认不再需要旧诊断入口时，可移除旧 transport/依赖/密钥，不能删除历史来源枚举。

## 实际测试

| 命令/检查 | 实际结果与边界 |
|---|---|
| `pnpm --filter @workspace/api-spec run codegen` | 通过，重新生成 Zod 与客户端契约 |
| `pnpm --filter @workspace/api-server run test:workflow` | 42/42 通过；含官方 SDK 拦截测试、有效结构化输出合并、错误回退、R1–R5、四维评分、ESG 中立、版本/审批/模拟执行 |
| `PORT=3000 BASE_PATH=/ pnpm run build` | 通过；包含全 workspace 类型检查及构建。Vite 有 sourcemap 和 bundle 大小警告，未阻断构建 |
| `node artifacts/api-server/tests/api-openai-contract.mjs "https://$REPLIT_DEV_DOMAIN"` | 12 项检查通过；真实 HTTP API 设置保存/读取、拒绝旧 Gemini 模式、恢复原设置，不发起模型请求 |
| `node artifacts/api-server/tests/api-workflow.mjs "https://$REPLIT_DEV_DOMAIN"` | 31 项检查通过；人工编辑/延后重算/拒绝/批准/20 任务模拟执行及并发幂等；财务与 ESG 数据不变 |
| `pnpm --filter @workspace/api-server run test:openai-live` | 发出 1 次真实 OpenAI 请求，HTTP 429，退出码 1；仅验证真实请求和安全回退，**未通过真实生成验收** |
| Settings 页面截图 | 页面正常、API online、OpenAI 服务端密钥状态可见；未以截图声称下拉菜单点击流程已测试 |

真实调用证据：域名 `api.openai.com`，路径 `/v1/responses`；
响应头到达 2459 ms，总生成流程 2463 ms；
请求 ID `req_ea6e2d2fb67246998dd8a502ce1fa49a`。
生成记录 `requestedProvider: openai`、`model: gpt-5-mini`、
`status: fallback`、`reasonCode: api_error`。
没有保留原始错误正文，没有取得允许输出的细分错误码；
**不能根据 429 确定是余额、配额、限流或其他具体原因，也未确认该账号的模型可用性。**
没有自动重试或换模型。

真实 live 脚本使用内存合成数据，不导入 repository、不读写数据库。
有效结果测试由注入的合成结构化响应完成，不能替代真实 API 成功证据。
API 回归追加合成计划/审计/模拟执行历史，不删除原数据；
workflow 回归新增 4 个计划版本、32 条审计；原 Rules 设置已恢复。

## 修改文件与用途

以下路径除注明外均相对 `artifacts/api-server/`：

| 文件 | 用途 |
|---|---|
| `package.json`、根 `pnpm-lock.yaml` | 安装/锁定官方 OpenAI SDK，新增 live 命令，保留 Google SDK |
| `src/lib/receivables/ai-provider.ts` | OpenAI 常量、密钥存在检查、transport、严格请求、本地校验、取消/回退 |
| `src/lib/receivables/ai-schema.ts` | 从原 Schema 派生严格 wire 子集，保留本地校验 |
| `src/lib/receivables/ai-generation.ts` | OpenAI 编排、密钥状态、历史成功记录保护；保留外部 I/O 与事务分离 |
| `src/lib/receivables/planner.ts` | 草稿记录 OpenAI 等待状态，旧 Gemini 标记 retired |
| `src/lib/receivables/service.ts` | OpenAI 可用性提示、来源合并及审计、拒绝保存旧模式 |
| `src/lib/receivables/legacy-gemini.ts` | 保留非正式路径旧 transport 供回查 |
| `test-workflow.mjs` | 运行新增安全测试 |
| `tests/workflow.test.ts` | 设置测试改为 OpenAI，并验证旧模式拒绝 |
| `tests/gemini.test.ts` | 历史文件名保留；内容迁移为 OpenAI SDK/建议/安全回归测试 |
| `tests/openai-safety.test.ts` | wire Schema、历史兼容、无重试、空/不完整响应测试 |
| `test-openai-live.mjs`、`tests/openai-live.ts` | 真实单次合成业务请求；脱敏输出；成功后才验收内存审批与执行 |
| `tests/api-openai-contract.mjs` | 实际 HTTP 设置/API 契约回归，无模型生成 |
| `test-gemini-live.mjs`、`tests/gemini-live.ts`、`tests/api-gemini-live.mjs`、`tests/api-gemini-fallback.mjs` | 归档/禁用旧入口，不再意外调用 Google |

其余文件：

| 路径 | 用途 |
|---|---|
| `artifacts/receivables-admin/src/pages/settings.tsx` | OpenAI 选项、密钥安全提示、旧模式迁移提示 |
| `artifacts/receivables-admin/src/pages/ai-planner.tsx` | 对齐当前建议提供方 |
| `artifacts/receivables-admin/src/components/plan.tsx` | 建议标题不再错误固定为 Gemini |
| `artifacts/receivables-admin/src/components/provider-details.tsx` | 当前来源/历史来源、模型与回退原因 |
| `lib/api-spec/openapi.yaml` | OpenAI 契约和历史枚举兼容 |
| `lib/api-client-react/src/generated/api.schemas.ts` | 自动生成前端类型 |
| `lib/api-zod/src/generated/api.ts` | 自动生成验证 schema |
| `lib/api-zod/src/generated/types/{aIGenerationRequestedProvider,collectionPlanProviderMode,collectionTaskNoticeEnSource,collectionTaskNoticeMsSource,systemSetting,systemSettingAiMode}.ts` | 自动生成提供方/来源/设置类型 |
| `docs/OPENAI_SETUP.md` | 本报告与操作说明 |
| `docs/GEMINI_SETUP.md` | 标注历史文档，指向当前 OpenAI 说明 |
| `docs/DEMO_GUIDE.md`、`replit.md` | 更新当前提供方与验收边界 |
| `.agents/memory/MEMORY.md`、`.agents/memory/gemini-integration.md` | 更新跨会话验收规则，避免把旧接入状态当成当前事实 |

已检查 `model.ts`、API routes 和执行结果页：使用生成类型/通用编排，
没有需额外替换的固定 Gemini 调用；未为迁移修改这些业务模块。

## 后续手动演示

1. 当前保留 Rules 设置；所有原有规则演示继续可用。
2. 在 OpenAI 账户侧核查此项目的配额/限流等情况；429 具体原因仍待确认。
3. 需要重新验收时，运行一次 `pnpm --filter @workspace/api-server run test:openai-live`。
   这会产生真实外部调用并可能消耗配额；本轮已执行一次，不自动重跑。
4. Settings 选择 OpenAI API 并保存；Risk Triggers 手动检查，或 AI Collection Planner 新建方案。
5. 查看 requestedProvider/model/status 和逐语言来源；只有 openai/success 才代表有效模型输出，
   rules_fallback 不能作为 OpenAI 成功演示。
6. 人工检查 EN/MS 文案与三套条件式方案，可编辑产生新版本；批准前不能执行。
7. 批准后仅运行模拟执行，在 Execution Results/Audit Logs 查结果；
   不发送真实消息、不扣款、不转账、不改变付款状态。
