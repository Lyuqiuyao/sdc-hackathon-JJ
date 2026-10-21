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

Gemini 接入使用用户自己的服务端 `GEMINI_API_KEY`；保留确定性规则引擎。Gemini 只提供建议，不能改变财务计算、排名、合同字段或批准/执行状态。

**Why:** 用户的接入附件明确要求自带密钥、规则无密钥仍可运行，以及算法结果和 AI 内容分离。

**How to apply:** 不擅自换成 Replit 代管 AI；仅建议生成链路可使用外部模型，任何失败必须诚实回退并标注实际来源。
