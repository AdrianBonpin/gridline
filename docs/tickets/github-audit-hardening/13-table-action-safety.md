# 13: Table actions are valid and single-path

**What to build:** Views and materialized views expose only actions that apply to them and stay read-only, and dropping a table with dependencies reaches a staging action through exactly one confirmation path.

**Blocked by:** None (can start immediately)

**Seams:** Viewer interaction seam: catches offered actions and the staged change; misses server-side rejection of an invalid action.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/68
**Status:** done

- [x] Views and materialized views offer no edit, empty-table, or drop action that would fail.
- [x] A dependent-table drop shows one acknowledgement and confirmation path, not stacked dialogs.
- [x] Proceeding through the confirmation stages exactly one drop change.
- [x] Cancelling stages nothing.
- [x] Read-only columns remain non-editable for these object kinds.
