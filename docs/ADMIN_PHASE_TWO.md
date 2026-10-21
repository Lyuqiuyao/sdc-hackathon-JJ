# 第二阶段：生成权协调与建议快照

## 本轮范围及结果

仅管理员直接依赖的 API、编排、Repository、JSONB 契约及测试。没有修改风险公式、四维权重计算、评分顺序、审批状态机或模拟执行逻辑。服务层仅在既有事件旁追加快照。未运行 live 脚本，未改 Secret，未连接共享库做迁移或测试，未调用共享业务写接口。

### 存储及回滚

没有新增物理表、SQL 列、索引或 DDL。沿用 `demo_workspaces` 主键和行锁，给 JSONB 聚合增加可选的 `workspaceId`、`aiLeases`、`adviceSnapshots`；缺省视为空，不回填旧记录。数据库 schema 文件只有说明注释。

回滚：先停止/排空所有新版本实例，再回滚服务代码；保留新增 JSONB 字段和历史，不执行删除数据的回滚 SQL。旧代码忽略这些可选字段，但旧实例不遵守新租约协议，混合新旧实例期间不能承诺防重复生成。正常后续业务操作才会写这些字段，本轮未将它们写入共享业务数据库。

## A. 生成权

`ai-coordination.ts` 的 key 由工作区、风险事件、计划 ID、版本、业务数据签名和 `collection_advice` 组成。`ai-enrichment.ts` 每次在短事务中领取；模型 I/O 在事务外；完成后另一个短事务核验 owner token、租约有效期及原计划快照。原有内存 Map 仅作本实例请求合并，不是跨实例正确性的来源。

正式 Repository 使用既有 `FOR UPDATE` 串行化同一工作区的领取及提交，并在获得锁后读取 PostgreSQL `clock_timestamp()`，避免依赖不同应用实例的本地时钟。租约默认 60 秒，大于原来的 45 秒模型超时，不增加模型重试。

| 情形 | 行为 |
|---|---|
| 活跃 owner 存在 | 其他实例返回当前计划，不调用 Transport |
| 成功提交 | lease=succeeded，后续读取已有结果 |
| API 错误、初始化错误或校验失败 | Rules 回退，lease=failed；下次明确请求可重领 |
| 模型超时 | Rules 回退，lease=timed_out；下次明确请求可重领 |
| 进程退出、没有 finalize | lease 保持 running；过期后下一次请求接管并记录 expired |
| 旧 owner 过期/被替换后返回 | 仅追加 discarded 元数据，不动新 owner、不应用旧建议 |
| 期间编辑、批准、拒绝、延后或数据过期 | 原有版本/人工/新鲜度门禁拒绝应用，追加 discarded |

恢复是请求驱动的，没有新增自动后台重试或常驻队列。计费边界：供应商已接收请求、而进程在本地提交前崩溃时，过期接管可能造成第二次外部调用；供应商侧原请求也可能仍在处理。没有 exactly-once 计费保证，也没有承诺可撤销供应商已接收的工作。

## B. 追加式快照

`advice-snapshots.ts` 建立独立快照 ID，包含工作区、风险事件、计划、版本、尝试 ID、时间、provider/source/status/reasonCode/contentPolicy/validation、前一快照、跨计划版本关系及审批 ID。前向关系由其他快照的 `previousSnapshotId` 反查，不回写旧记录。人工动作链接原生成尝试（存在时），否则使用独立事件 ID。

内容分层：

1. **原始模型正文：不保存。** 当前共享 synthetic demo 无生产级身份与原文留存政策。
2. **模型校验摘要：**仅任务 ID、输入匹配后的 ESG evidence/rating、三种策略类型；不保存投影前自由文本，不能恢复原始模型措辞。
3. **有效建议：**通过完整 Schema/本地业务与安全投影后的建议对象。
4. **受控内容：**规则通信模板、受控 ESG 说明、unknown-task 投影及适用政策。
5. **最终通知：**当次实际草稿及逐语言来源；与规则模板分开，人工文本不冒充模板。
6. **人工版本与决定：**该事件时的计划内容、版本/父计划、人工通知，审批 ID、决定及精确计划版本。
7. **失败/丢弃：**失败回退保存有效 Rules 内容；未应用/过期结果只记元数据，不留返回正文。

快照不改变历史 provider 标签。任何新动作都追加，Repository 提交前校验旧记录仍是完整相同前缀并禁止重复快照 ID；拒绝时数据库事务回滚。查询返回副本。没有公开修改/删除快照接口。

只读接口：`GET /api/plans/{id}/advice-snapshots`。返回该精确计划的快照；跨版本沿 `previousPlanId`/`previousSnapshotId` 追踪。缺失计划/风险关联安全报错，不伪造成功。既有旧记录不会被自动补写成新格式，也不会重新标记来源。

这是 **Repository/API 层不可改写保证**，不是数据库管理员无法篡改的 WORM/密码学证明。直接 SQL 绕过 Repository 不在保证范围。所有写实例必须使用该协议。JSONB 聚合及完整前缀校验适合现有演示规模，不是无限规模的审计仓库。

凭据处理：不读取任何真实密钥用于测试或脱敏；不保存异常对象、HTTP 头或请求凭证。对允许留存的文本再遮蔽常见 key、Bearer、Authorization、具凭据 URL 及敏感键。模式遮蔽不是任意秘密或个人信息检测器，不能据此接纳真实客户资料。

## 实际执行的验证

| 命令 | 结果 |
|---|---|
| `pnpm --filter @workspace/api-spec run codegen` | 通过，包含生成库类型检查 |
| `pnpm --filter @workspace/api-server run test:workflow` | 109/109，通过；原 89 个回归加 20 个第二阶段测试 |
| `pnpm --filter @workspace/api-server run test:isolated-db` | 4/4，通过；真实临时 PostgreSQL，非共享库 |
| `PORT=3000 BASE_PATH=/ pnpm run build` | 全工作区类型检查及构建通过 |
| `git diff --check` | 通过 |

中间一次构建发现目标库不支持 `Array.findLast`，已改成兼容写法，最终构建通过。Vite 仍有原有大 chunk 提醒，不阻断构建。

### 并发测试到底创建了什么

- 内存测试：两个独立 `createPlanEnricher` 闭包、不同 Map，通过同一个序列化/可回滚的内存存储协调。覆盖版本隔离、失败重领、过期接管、崩溃遗留、过期且无继任者、人工/审批门禁及新版先完成、旧版后返回。
- SQL 测试：脚本在 `/tmp` 建立私人目录下的临时 PostgreSQL，只开 Unix socket、不监听 TCP；子进程显式使用临时连接，不读取共享数据库 URL。建测试表，结束停止集群并删除目录。
- **两个独立 Node OS 进程**各自加载正式 Repository 和编排，竞争相同版本；独立连接及真实行锁下，模拟 Transport 计数恰为 1。另有独立连接的过期接管、篡改/删除/异常事务回滚及 workspace 关联保护。
- 全部模型调用为注入的假 Transport/SDK fetch；全局网络 guard 拒绝未注入的 fetch。无真实模型验收、无费用。

边界：未验证真实模型的延迟/配额/输出成功率；未验证生产多机负载或滚动升级；未请求共享业务 API 做浏览器流程验收，也未对旧历史补快照。构建不等于已部署运行验收。

## 主要文件

- `src/lib/receivables/ai-coordination.ts`：共享租约键、领取、状态契约。
- `ai-enrichment.ts`：领取、外部 I/O、fencing、应用/丢弃的原子完成。
- `repository.ts`：工作区仓储工厂、数据库时钟、行锁和快照前缀保护。
- `advice-snapshots.ts`：内容分层、关联校验、脱敏、只读副本。
- `ai-provider.ts`：只返回非原文结构校验摘要；原校验与投影不放松。
- `service.ts`：在既有生成、编辑和审批事件旁追加快照，不改状态转换。
- `model.ts`、`ai-generation.ts`：可选状态契约及正式 Repository workspace 绑定。
- `src/routes/receivables.ts`：只读快照查询。
- `lib/api-spec/openapi.yaml` 及生成的 `api-zod`/`api-client-react`：快照/API/attemptId 类型。
- `tests/phase-two.test.ts`、`memory-advice-repository.ts`：20 项内存模拟测试与可回滚仓储。
- `tests/isolated-postgres.test.ts`、`coordination-process-worker.ts`、`synthetic-advice.ts`：4 项隔离 SQL/跨进程测试。
- `test-workflow.mjs`、`test-isolated-postgres.mjs`、`package.json`：无模型费用的测试入口。

上述 `src`、`tests` 相对 `artifacts/api-server/`。无新增前端页面或布局改动，无新增角色。
