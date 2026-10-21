# Replit 托管 OpenAI：迁移与模拟验收

## 状态与边界

正式应用已改为 Replit AI Integrations OpenAI 接入，不再使用私人 `OPENAI_API_KEY`。
模型保持 `gpt-5-mini`。本次只进行代码修改、模拟测试、类型检查和构建；
**没有运行任何 live 模型测试，没有进行真实模型调用或新增模型调用费用。**
这不代表真实托管模型验收成功。

原 Gemini、OpenAI 直连接入文档和旧 transport 保留为历史资料。
没有修改或删除任何 Secret，没有运行数据库修改/API 工作流测试，没有发送通知或执行收付款。
测试中的审批/模拟执行发生在内存合成数据上，不写入实际工作区。

## 官方模块核对

- 来源：`.local/skills/ai-integrations-openai/templates/lib/integrations-openai-ai-server/src/client.ts`。
- 模板具名导出 `openai`，使用官方 `openai` npm SDK。
- 配置名：`AI_INTEGRATIONS_OPENAI_BASE_URL`、`AI_INTEGRATIONS_OPENAI_API_KEY`。
- 通过环境管理接口仅检查存在性：两个配置均存在；原两个私人/历史密钥也保留，未读取输出值。
- 官方模板原本会在缺配置时于模块初始化抛错。
- 只引入必要的服务端客户端；`lib/integrations-openai-ai-server/src/client.ts`
  与本环境官方模板逐字节一致。没有引入聊天、图片、音频、客户端组件或数据库表。
- 新 workspace 包保留现有 `openai@7.39.0`，不另装第二份 SDK。
- Provider 延迟导入该模块，初始化异常位于安全回退边界内。
- 在返回的客户端上用 SDK `withOptions` 设置 45 秒超时、零自动重试；
  不修改官方客户端模板。

## 正式请求

- `client.responses.create()`，模型 `gpt-5-mini`。
- `text.format: { type: "json_schema", strict: true, ... }`。
- 原本地 Zod、任务完整性、三种不同方案、ESG 一致性、双语演示/未发送声明校验全部保留。
- `max_output_tokens: 8192`，按当前托管集成指引调整；`store: false`、
  `reasoning.effort: minimal` 保留。
- 45 秒外层截止时间、SDK timeout、AbortSignal 和 rules_fallback 保留。
- 托管配置缺失返回 `missing_managed_config`；客户端初始化/API 失败安全回退。
- `status !== completed` 的响应即使含有效 JSON 也整份拒绝；
  截断 JSON、缺任务、Schema/ESG 错误不合并任何部分建议。
- 不存在失败后自动读取私人 Key、直连 OpenAI 或切换 Gemini 的生产分支。

## 来源和审计

新 OpenAI 尝试增加可选字段 `aiGeneration.connectionMode: replit_managed`，
成功/失败均标明所选接入方式，随现有 AI generation 审计元数据保存。
`providerMode`、逐语言来源仍为原来的 `openai` / `rules_fallback` / `human` 等，
不批量重写历史数据。
缺少新字段的历史 OpenAI 记录显示“Historical OpenAI · connection unrecorded”，
不会被假定为托管接入。历史 Gemini 标签不变。

设置页明确标注 OpenAI (Replit managed)、Replit credits 运行时计费，
不再提示添加私人 Key；“配置存在”不等于连通性/生成成功。

## 实际运行及结果

| 命令/检查 | 结果 |
|---|---|
| `pnpm install --no-frozen-lockfile` | 通过；新增本地 workspace 客户端包链接，无 Secret 修改 |
| `pnpm --filter @workspace/api-spec run codegen` | 通过；含共享库类型检查 |
| `pnpm --filter @workspace/api-server run test:workflow` | 最终 **50/50 通过** |
| `PORT=3000 BASE_PATH=/ pnpm run build` | 通过；包含全项目类型检查和构建。Vite sourcemap/包大小警告不阻断构建 |
| 官方模板 `cmp` | 客户端文件逐字节一致 |
| `git diff --check` | 通过 |
| 前后端工作流启动与设置页截图 | 正常启动、API online，托管配置提示可见；当前仍为 Rules，未触发生成或保存设置 |

首轮模拟测试发现测试使用了不可靠的超时 HTTP 头断言；
最终直接断言 SDK 客户端 timeout/maxRetries，并将请求断言移到回退 catch 外，未削弱业务校验。

模拟测试覆盖：

- 缺任一托管配置、私人 Key 存在却不能满足托管配置，也不能触发 transport。
- 隔离子进程中官方客户端缺配置初始化失败；应用服务模块可加载，Rules 可用。
- 注入客户端加载失败、SDK 模拟 429/504、不重试、不使用私人凭据。
- 官方客户端实际构造的模拟目标、托管合成凭据、Responses body、严格 Schema、
  8192 token 上限、45 秒 timeout、取消信号。
- 有效结构化输出、截断、不完整状态、任务缺失、Schema 错误、ESG 不匹配。
- R1–R5、四维评分、ESG 中立、双语标签、人工编辑/版本/审批门禁/模拟执行。
- 新审计接入元数据和旧记录不改标。

模拟 runner 预载 `tests/no-network.mjs`，阻断未注入的全局 fetch；
测试子进程的托管和历史凭据均替换为合成占位值。
SDK 请求只由注入的假 fetch 返回内存响应，不调用外部服务。

## 修改文件及目的

| 文件/路径（相对仓库根） | 用途 |
|---|---|
| `lib/integrations-openai-ai-server/{package.json,tsconfig.json,src/client.ts,src/index.ts}` | 官方服务端客户端最小包，原样客户端与必要导出 |
| 根 `tsconfig.json`、`pnpm-lock.yaml`；`artifacts/api-server/{package.json,tsconfig.json}` | workspace 依赖与 TypeScript 引用 |
| `artifacts/api-server/src/lib/receivables/ai-provider.ts` | 托管配置、延迟客户端、8192 上限、请求级选项和连接元数据 |
| 同目录 `ai-generation.ts`、`planner.ts` | 缺托管配置判断、待生成状态与新草稿接入标记 |
| 同目录 `service.ts` | 托管可用性文案与审计；无私人 Key 回退 |
| 同目录 `legacy-openai.ts` | 保存旧直连 transport，仅供历史回查，不在正式导入图中 |
| `lib/api-spec/openapi.yaml`、相关 `lib/api-zod/src/generated/`、`lib/api-client-react/src/generated/api.schemas.ts` | 可选 connectionMode 契约及自动生成类型/验证器 |
| `artifacts/receivables-admin/src/pages/{settings,ai-planner}.tsx`、`src/components/provider-details.tsx` | 托管设置提示、来源展示及历史兼容 |
| `artifacts/api-server/tests/{gemini.test,openai-safety.test}.ts` | 保留原回归并改为托管模拟请求 |
| 同测试目录 `managed-openai.test.ts`、`managed-startup.ts`、`no-network.mjs`；`test-workflow.mjs` | 新安全用例、隔离启动探针、网络阻断、统一 runner |
| `artifacts/api-server/test-openai-live.mjs`、`tests/managed-openai-live.ts` | 将来专用托管 live 入口，默认拒绝运行，需显式参数 |
| `artifacts/api-server/tests/openai-live.ts` | 保留并禁用旧私人 Key 诊断源文件 |
| `docs/REPLIT_MANAGED_OPENAI.md`、`docs/OPENAI_SETUP.md`、`docs/DEMO_GUIDE.md`、`replit.md`、项目记忆 | 当前说明与历史文档状态更新 |

未改变四维算法/权重、金额/日期、ESG 数据、审批与模拟执行业务规则。
未修改 `ai-schema.ts`；没有放宽现有校验。

## 仍待验证

配置存在和模拟测试不能证明实际网络、账户/组织额度、代理端完整参数、
真实模型完整 Schema 响应或实际计费归属已经通过运行验收。
8192 token 能否在 45 秒内返回所有任务，也只能通过另行授权的真实请求确认。
超限/截断将安全回退，不接受任务子集；本轮不做付费重试或拆分多次请求。

## 最小后续真实验收（本轮未执行）

获得单独明确的真实调用/可能消耗 Replit credits 授权后，运行一次：

`pnpm --filter @workspace/api-server run test:openai-live --allow-managed-live`

默认不带显式参数会在构建/请求前退出；本轮连默认 live 命令也没有运行。
未来入口仅使用内存合成数据、托管客户端、一次请求和零重试，
禁止直连目标、重定向或第二次请求，不读写数据库；
成功需完整业务校验并记录 openai/success/replit_managed，再验收内存审批门禁。
失败仅报告脱敏状态/请求 ID/回退原因，不换私人 Key。
