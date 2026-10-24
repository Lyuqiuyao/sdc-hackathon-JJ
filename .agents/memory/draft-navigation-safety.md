---
name: Approval draft retention
description: No departure prompts; preserve independent draft retention without autosaving.
---

Do not show departure/discard confirmations or the extra unsaved-draft banners in Approval Center. Keep in-tab draft retention and separate-submit semantics; do not autosave, create plan versions, invoke AI, or add synthetic history entries. Queue switching and company-folder opening must retain drafts without prompts.

**Why:** The user explicitly requested removing both the new unsaved-content warnings and the extra existing-draft/not-yet-generated notice. Explicit saves remain versioned and audited business actions; removing prompts does not authorize silent saves or changes to approval requirements.

**How to apply:** Do not install navigation or unload guards for these drafts or reintroduce warning banners. Preserve tab-memory retention on route unmounts and independent drafts across successful version saves. Refresh/close may lose unsaved content without warning. Keep real validation errors and approval blockers; source provenance must remain truthful without the removed explanatory banner.

Treat task edits, customer review submissions, and the final-order reason as independent drafts. A successful save consumes only what that action submitted; carry other drafts into the resulting version without submitting them.

**Why:** Each action has different approval/audit consequences. Saving one customer's review must not silently submit or discard another customer's reason or the final-order reason. Reasons are new-submission inputs (initially blank); the historical saved reason is displayed separately, while the selection starts from the saved decision.

**How to apply:** Keep navigation dirty state separate from existing business-action blockers. Prepare any retained drafts before refreshing workspace data, because an implicitly selected newest pending version can mount during that refresh.
