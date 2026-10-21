---
name: 生成协调与审计留存边界
description: 租约不能保证供应商计费 exactly-once；共享演示不留原始模型文本
---

生成权协调只能防止遵守同一协议的实例并发应用结果，不能承诺供应商调用/计费 exactly-once。

**Why:** 外部供应商接收请求与本地事务提交不能原子化；进程崩溃或租约过期后接管存在重复外部调用窗口。

**How to apply:** 涉及恢复、超时、扩容或滚动更新时明确这一边界；旧实例不遵守协议，混合版本不能享有相同保证。

当前共享 synthetic demo 不保存原始模型正文；审计需要区别模型结构摘要、校验后的投影、受控模板、最终通知和人工版本。不要为了“可恢复”而扩大原文留存。

**Why:** 演示缺少生产级身份/访问控制及原文留存政策；原文可能含被拒绝的内容，保存它会扩大泄漏风险。

**How to apply:** 新增审计字段时保留诚实来源，失败/过期结果只存元数据；应用层追加式保证不可描述成数据库管理员也无法篡改。

启用完整原始模型响应持久化必须取得用户另行明确确认；完善审计不是原文留存授权。

**Why:** 用户要求优先使用字段级结构诊断，未经确认不得启用完整原文持久化。

**How to apply:** 即使日后新增身份或存储能力，也先单独提出访问、保留期限、敏感内容和删除策略。

Content fingerprints and structural comparisons crossing PostgreSQL JSONB must be independent of object-key order.

**Why:** A logically unchanged configuration can have different key order after JSONB persistence; order-sensitive checks can silently reject legitimate model work before transport.

**How to apply:** Use canonical content comparison across persistence boundaries. Never rewrite historical fingerprints or weaken stale-plan gates to conceal a representation mismatch; old active plans may require explicit recalculation and approval.
