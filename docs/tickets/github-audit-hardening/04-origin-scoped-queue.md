# 04: Pending work is scoped to its Change Origin

**What to build:** Staged changes belong to the exact connection, database, and connection target they were staged against. Commit All only ever applies the active origin's work, refuses work whose origin has been retargeted, and reports partial success honestly.

**Blocked by:** 01

**Seams:** Viewer interaction seam: catches queue scoping, commit targeting, and the partial-success message; misses the database write itself.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/93
**Status:** done

- [x] Pending changes staged on one connection are absent from Commit All while another connection is active.
- [x] Returning to the original connection restores its pending queue unchanged.
- [x] Commit All refuses work when the saved connection's target changed after staging.
- [x] Commit All applies changes in order, stops at the first failure, and states how many changes committed and which one failed.
- [x] The UI never claims an all-or-nothing queue rollback.
