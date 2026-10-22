---
name: Administrator-only competition demo
description: User's standing product exclusions and synthetic-data requirement
---

The user strictly limits this product to “管理员端（Merchant Finance Admin）”.
Do not develop full certifier or customer applications. Admins may view ESG review outcomes, but must not perform certification reviews.
Do not ask the user for real customer financial records; use explicitly labelled synthetic demo data.

**Why:** The user's competition brief explicitly sets these scope and data-safety boundaries.

**How to apply:** Keep future enhancements within the administrator experience unless the user changes the scope. Do not turn integration or import work into a request for real customer financial information.

缺失 ESG 数据应标记为 unknown/unverified，不能自动视为低 ESG 评级或高坏账风险。

**Why:** 用户在业务工作流审查要求中明确规定缺失 ESG 的处理边界。

**How to apply:** 缺失、尚未核实的 ESG 证据不能触发负面信用结论；说明其不确定性，且不要为补全审计而虚构真实认证审核行为。

当前阶段保留明确标注的共享 Demo Admin，暂不新增正式鉴权。

**Why:** 用户在管理员单端与审计方案确认中明确选择该范围。

**How to apply:** 不把演示入口或工作区 ID 一致性检查描述为正式身份认证、授权或租户隔离；正式鉴权需单独明确范围。

## Final administrator MVP requirements

The administrator website must be English-only. Customer communication drafts must support English and Malay. Development naming, comments, documentation, tests and developer-facing errors must use English. Audit existing UI text before implementation and add a relevant Unicode language check; do not claim full UI compliance from a source scan alone.

**Why:** The user explicitly supplied mandatory project language requirements.

**How to apply:** Keep the language policy project-specific. Retain historical records; use English interface labels without rewriting original audit history merely for localization.

The final MVP replaces four-dimensional collection ranking with deterministic two-dimensional ranking (overdue days, outstanding amount) for customers without an assigned ESG rating and three-dimensional ranking (the same two dimensions plus the assigned ESG rating) for customers with one. Missing ESG must not cause a penalty. The user confirmed the proposed illustrative weights, normalization and rating mapping, invoice-level tasks, customer-level review, and separate deterministic queues followed by a human-confirmed merge.

**Why:** The user explicitly changed the ranking requirements, prohibited assuming weights, then approved the proposed demo parameters. This supersedes retaining four-dimensional ranking for new plans, but not independent cash-flow/risk rules or historical scoring snapshots. Approval is not empirical credit-model validation.

**How to apply:** Preserve historical versions and separate ranking from risk warnings. AI may explain and suggest communication only; it cannot change financial facts, weights, scores, rank or approval. Further parameter or automatic cross-queue ordering changes need explicit business confirmation; do not silently tune the approved demo.

Provide administrator-only synthetic SEDG submission/import, company information folders and human collection review. SEDG review is not certification or verification of a company, file or ESG rating. The user subsequently authorized manual NLP communication extraction and an advisory AI company portrait based on structured invoices and previous NLP results. Email execution defaults to simulation, displaying recipient, final body, status, time and audit provenance; the user subsequently authorized optional real SMTP behind an explicit environment switch.

**Why:** The user specified these final MVP scope and trust boundaries.

**How to apply:** Do not introduce a customer or certifier portal, unrelated model calls, Secret changes or shared database operations under this implementation scope. Later authorization permits the SMTP switch, communication extraction and the specified advisory AI portrait through the existing ai-provider, not broader workflow changes.

## Incremental enhancement constraints

用户要求绝对不要改动已经实现好的 13 个核心功能（仪表盘、现金流提醒、2D/3D 排程、SEDG 审核、AI 双语话术、审计日志等）的业务逻辑；不许引入 LangChain、Prisma、TypeORM 这类重型依赖；所有 AI 调用必须复用现有 ai-provider 模块；所有新增操作必须写审计日志。

**Why:** 用户明确规定后续增量开发的保护边界。

**How to apply:** 增量功能不得顺带重构或改变核心业务规则。按用户逐项授权推进，绝对禁止改动 planner.ts 排程计算逻辑或顺带实现未列功能。每次完成后输出改动文件和 diff，停止等待验收。

往来信息每个公司最多保留 5 条，超过自动删除最早记录及原文；原文只在用户查看详情时加载。

**Why:** 用户明确要求限制累计原文容量并避免列表轮询反复传输大段原文，且授权自动删除最早记录。

**How to apply:** 保持元数据列表与全文详情分离；不要把上传容量上限当作无限制累计留存的授权。

上传成功后自动串联该记录 NLP 与该公司画像生成；所有进入审核队列的客户，无论是否有 ESG 评级，都必须完成立即催收／可协商延期二选一。

**Why:** 用户明确授权这两个流程变化，同时要求保留排程触发方式、标签夹手动打开、邮件发送流程及审核页现有结构。

**How to apply:** 不再把手动 Analyze／Generate portrait 作为新上传的必要步骤；保留现有审计与规则兜底，不改变排程评分或金融事实。

用户随后授权审核后二类英／马双语稿件、对应客户邮箱投递及 SEDG 五项合成自评；未授权阶段四后端上传处理链或自动触发排程。

**Why:** 用户明确要求执行计划中的阶段一、二、三；这扩展了此前“保持邮件流程”的范围，仅允许所述收件人与话术确认变化。

**How to apply:** 保持默认模拟、实时发送确认、幂等和结果不确定时禁止自动重试；缺失客户邮箱不得回退统一邮箱。历史 SEDG 缺字段应显示未提供，不补写历史。

同一公司有多笔往来时，新增记录应由 AI 整合到之前的公司画像，而不是仅生成最新一笔的画像。

**Why:** 用户明确要求公司画像持续整合。

**How to apply:** 使用上一版画像、新增／重新解析的记录与累计证据生成新版，保留旧版本；同一记录重解析不重复计数，旧画像不得覆盖当前发票事实。

往来信息不是在每个公司分别上传，而是从统一入口上传，上传后由 AI 识别并整合到对应公司。

**Why:** 用户明确纠正了之前按公司分别上传的理解。

**How to apply:** 不再要求先打开或选择公司才能上传；公司档案是识别归档后的查看位置，不能把仅增加一个公司内上传按钮描述为统一识别归档。

