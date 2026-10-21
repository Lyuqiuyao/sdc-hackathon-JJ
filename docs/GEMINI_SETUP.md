# Gemini 接入、验证与边界

> 历史资料：正式提供方现已迁移到 OpenAI。下文记录迁移前的实现与失败证据，
> 不代表当前运行配置。旧 live 测试入口已禁用，当前说明与真实验收结果见 [OPENAI_SETUP.md](OPENAI_SETUP.md)。

## 当前验收状态

已实现官方 `@google/genai` SDK 服务端调用、结构化输出校验、逐方案来源标识、失败回退与审计。
**尚未完成真实 Gemini 生成成功验收：密钥已配置，但实际生成请求失败。**
最初缺密钥时脚本输出 NOT_RUN；配置后真实 `models.list` 成功并返回模型列表，
但 `gemini-3.8-flash` 的完整业务请求与最小 JSON 请求均返回 HTTP 504。
另一个列表中出现的稳定模型 `gemini-2.5-flash` 最小生成请求返回 404/NOT_FOUND，
因此没有将生产默认模型盲目切换过去。模型列表成功不代表生成链路正常。

本项目采用用户自己的 Google API key，不使用 Replit 代管 AI 代理。
模型默认 `gemini-3.8-flash`，按 Google 官方模型页核对为稳定版本：
https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash 。
SDK 请求方式为 `client.models.generateContent`，JSON structured output。

## 1. 在哪里配置密钥

1. 在这个 Replit 项目编辑器的工具栏打开 **Secrets（锁图标）**。
2. 添加 secret，名称必须是 **GEMINI_API_KEY**，值填入你自己的 Google Gemini API key。
3. 不要把值发到聊天、CSV、前端 Settings 表单、源代码或 `.env` 提交文件中。
4. 保存后重启 **artifacts/api-server: API Server**，让服务读取新 secret。
5. 应用 **Settings → AI mode → Gemini API → Save Settings**。
6. 不需要添加 `VITE_GEMINI_API_KEY`；所有凭据与 SDK 均只在 API server。

也可使用本轮聊天提供的安全 Secrets 表单，密钥不会返回给 Agent。
Replit 官方说明：https://docs.replit.com/core-concepts/project-editor/app-setup/secrets 。

注意：Settings 的 “Key configured” 仅代表服务端看到了非空 secret，**不是连接测试成功**。
此 Demo 没有生产身份权限隔离，不要把带有可消耗 API 配额的应用无保护地公开发布。
请给自己的 Google key 设置适当 API 限制和配额，且仅用合成数据演示。

## 2. 怎样确认 UI 真正在用 Gemini

1. 保存 Gemini 模式后，进入 Risk Triggers 运行一次**新的**风险检测。
2. Medium/High 会生成新的 Pending 方案并尝试 Gemini；点击结果的 Generate AI Collection Plan 打开同一方案。
3. Approval Center 或 AI Collection Planner 应显示：
   - `providerMode = gemini`
   - `status = success`
   - 模型、生成时间、耗时
   - 独立的 Gemini risk explanation
   - 每项任务的三套 Gemini 协商备选、理由、假设、不确定性和 ESG 注意事项
   - English 与 Bahasa Melayu 的来源分别为 `gemini`
4. Audit Logs 中应有该版本的 **AI generation**，包含实际 provider、成功/失败状态、原因码、模型与生成时间。
5. 如果显示 `rules_fallback`，就是模板，**即使 Settings 已选择 Gemini 也不是模型成功**。
6. 人工改某种语言后该语言来源为 `human`；改催收方式而未改的通知自动换模板时来源为 `rules_fallback`。
   方案的 provider 表示原始建议来源，不掩盖之后的人工或模板修改。
7. 旧版、Approved/Executed 方案不会被重新写成 Gemini；请用新的检测/草稿验证。

首次失败后可以在当前新待审批事件点击 Generate plan 再尝试。已成功的待审批方案去重，不重复花费调用；
不要用旧的人工修改版本作为重试对象。发生数据变化后将重新创建当前风险事件和方案。

## 3. 计算与 AI 的边界

- `compute.ts`、`planner.ts` 先计算现金风险、四维得分、权重、综合分、排名、余额、到期日和初步催收方式。
- `ai-provider.ts` 只发送所需聚合现金信息和逐任务已计算结果，不发客户姓名、联系资料、
  凭证编号、完整文件、审批/审计历史或任何密钥。
- `ai-schema.ts` 同时驱动 JSON Schema 请求与本地 Zod 校验；不接受未知字段、缺失/重复任务、
  缺少三类策略或与证据不一致的 ESG 评级。
- 成功结果只写入独立的 AI 建议字段和 EN/MS 草稿。评分、排名、余额、合同字段、风险事件及状态不由模型覆盖。
- 无有效 ESG 保留 unknown、50 中性分；内部 ESG 缺失提示由服务端固定说明，不允许缺失推成坏账结论。
- 自由文本仍是未经过财务/法律验证的建议，必须人工核对，不代表真实信用评级或合同变更。
- 真实请求在数据库行锁外执行；提交前复查完整草稿快照、数据签名、人工修改记录及 Pending 状态。
  期间如果被修改、审批或基础数据变化，则丢弃迟到结果并记录 **AI generation discarded**。
- 已批准才允许模拟执行；不会真实发送、扣款、转账或改已收金额。

## 4. 回退与审计

每个新生成方案都记录 providerMode、requestedProvider、generatedAt、durationMs、status、reasonCode 和 model。

| 条件 | providerMode | 原因码 |
|---|---|---|
| 选择规则模式 | rules_fallback | rules_selected |
| 缺密钥 | rules_fallback | missing_api_key |
| API/权限/配额/网络错误（包括上游 504） | rules_fallback | api_error |
| 超过 45 秒截止时间 | rules_fallback | timeout |
| 无效 JSON/结构/任务/ESG证据 | rules_fallback | invalid_response |
| 超过 50 个任务的上下文限制 | rules_fallback | context_limit |
| 官方 SDK 调用成功且通过校验 | gemini | validated_response |

不保存或返回上游原始异常，不记录请求头、密钥或完整 prompt/raw response。
AI 审计只追加版本关联和安全元数据，既有业务审计保持不变。
同进程同方案的并发请求合并；历史 planMode 的旧文字不回填数据库，UI 明确将旧模板视为 legacy rules_fallback。

## 5. 实际验证记录

### 已运行且通过

```sh
pnpm --filter @workspace/api-server run test:workflow
```

**37 项通过**：23 项现有业务回归 + 14 项 Gemini 相关测试。
包括缺钥、显式规则模式、成功结构化响应、超时中止、API异常、错误JSON、恶意评分/审批字段、
错误ESG、重复/缺失任务、核心结果不变、人工审批门禁、迟到响应拦截、逐语言来源及最小上下文。

其中一个测试让官方 SDK 构造完整 HTTP 请求，但用本地拦截器返回测试响应，
明确是**离线 SDK 请求构造验证，不是真实 Gemini API 成功证据**。

```sh
node artifacts/api-server/tests/api-gemini-fallback.mjs "https://${REPLIT_DEV_DOMAIN}"
```

运行中真实 API/数据库缺钥测试通过：临时选择 Gemini，风险触发生成 20 任务 Pending 方案，
显示 rules_fallback / missing_api_key；未经审批执行返回 409；记录 AI generation 审计。
最后恢复原设置，比较客户、账单、凭证、设置、审批、执行及旧方案/审计历史均保持原值。
只追加本次演示事件、方案及日志。

```sh
node artifacts/api-server/tests/api-workflow.mjs "https://${REPLIT_DEV_DOMAIN}"
```

原 31 个 API 状态/关键断言组通过，包括审批/版本/延期/拒绝/执行及两次并发执行防重。
20 个模拟任务，财务与 ESG 数据不变。

此外，共享库、API 与前端类型检查通过，服务重启成功；
审批页面截图确认 rules_fallback、缺钥原因、生成时间、模型及四维结果可见。
本轮未再运行完整浏览器交互测试，不把截图等同于点击流程测试。

### 真实联网待完成

```sh
pnpm --filter @workspace/api-server run test:gemini-live
```

这个脚本不 mock，调用正式 officialGeminiTransport（仅在外层输出白名单 HTTP 状态/错误类别），
使用服务端 secret 调用真实 Google API，
只操作内存中的原始合成数据，不改数据库。成功才输出 `PASS / realApiRequest:true / providerMode:gemini`，
并验证双语、三策略、审批门禁及财务数据不变。

配置密钥后实际输出是 `FAIL / httpStatus:504 / reason:api_error`，不是生成成功。
最小生成请求也复现 504，因此不能仅凭请求代码存在或 SDK 构造测试通过宣称已联网验收。

```sh
node artifacts/api-server/tests/api-gemini-live.mjs "https://${REPLIT_DEV_DOMAIN}"
```

还验证了运行中真实服务与数据库的完整请求路径：
临时选择 Gemini → 手动风险检测 → 20 任务 Pending 方案 → 实际请求失败 → 持久化
`rules_fallback / api_error` → 追加 AI generation 审计 → 未批准执行返回 409。
脚本输出 `FALLBACK_VERIFIED_ONLY`（退出码 2，特意不当作真实生成通过），耗时约 43.9 秒。
原始客户、账单、凭证、设置、审批、执行和旧方案/审计记录均逐项比较保持不变，设置最终恢复。
审批页面可打开本次测试的新方案查看真实失败回退记录；没有保存真实密钥或上游原始异常。

当前限制是生成接口失败，非缺钥。没有进一步轮换模型或无限重试。
待生成服务可用后重新运行上述真实脚本；必须得到 gemini/success，
再按第2节在 UI 确认新的持久化方案，才可将真实 Gemini 接入标为验收通过。
