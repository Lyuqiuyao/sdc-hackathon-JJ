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

