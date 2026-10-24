---
name: Draft navigation safety
description: Constraints behind unsaved approval draft warnings and browser compatibility.
---

Unsaved-draft protection must not autosave, create plan versions, invoke AI, or add synthetic browser history entries. Queue switching and opening an inline company folder must retain local drafts without a discard prompt.

**Why:** Explicit saves are versioned and audited business actions. A warning must not trigger those actions or change browser history merely to simulate cancellation.

**How to apply:** Use cancellable navigation when supported and native unload warnings for refresh/close. Without the browser Navigation API, History API wrappers cannot cancel native Back/Forward before the router unmounts: retain unsaved drafts in tab memory across route unmounts and restore them on return instead. This is not a server save and must not create versions or audit records. Do not claim universal traversal cancellation or introduce history-repair tricks. Browser unload-dialog wording is browser-controlled.

Treat task edits, customer review submissions, and the final-order reason as independent drafts. A successful save consumes only what that action submitted; carry other drafts into the resulting version without submitting them.

**Why:** Each action has different approval/audit consequences. Saving one customer's review must not silently submit or discard another customer's reason or the final-order reason. Reasons are new-submission inputs (initially blank); the historical saved reason is displayed separately, while the selection starts from the saved decision.

**How to apply:** Keep navigation dirty state separate from existing business-action blockers. Prepare any retained drafts before refreshing workspace data, because an implicitly selected newest pending version can mount during that refresh.
