---
name: Draft navigation safety
description: Constraints behind unsaved approval draft warnings and browser compatibility.
---

Unsaved-draft protection must not autosave, create plan versions, invoke AI, or add synthetic browser history entries. Queue switching and opening an inline company folder must retain local drafts without a discard prompt.

**Why:** Explicit saves are versioned and audited business actions. A warning must not trigger those actions or change browser history merely to simulate cancellation.

**How to apply:** Use cancellable navigation when supported and native unload warnings for refresh/close. Without the browser Navigation API, History API wrappers cannot cancel native Back/Forward before the router unmounts: retain unsaved drafts in tab memory across route unmounts and restore them on return instead. This is not a server save and must not create versions or audit records. Do not claim universal traversal cancellation or introduce history-repair tricks. Browser unload-dialog wording is browser-controlled.
