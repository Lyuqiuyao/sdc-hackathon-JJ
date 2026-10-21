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

Provide administrator-only synthetic SEDG submission/import, company information folders and human collection review. SEDG review is not certification or verification of a company, file or ESG rating. NLP extraction from Excel/WhatsApp is deferred. Email execution must remain simulated, displaying recipient, final body, status, time and audit provenance.

**Why:** The user specified these final MVP scope and trust boundaries.

**How to apply:** Do not introduce a customer or certifier portal, NLP profile generation, real email integration, model calls, Secret changes or shared database operations under this implementation scope.

