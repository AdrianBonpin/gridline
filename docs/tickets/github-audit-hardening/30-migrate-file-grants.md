# 30: Migrate restore, export, and import to File Grants

**What to build:** Every remaining file-touching operation consumes a matching grant, and no renderer-supplied path remains an authorization for reading, writing, or executing a file.

**Blocked by:** 29

**Seams:** File Grant seam: catches the migrated operations; tool-job seam: catches their behavior after migration; misses operating-system dialog rendering.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/99
**Status:** ready

- [ ] Restore, streamed export, and data import each require and consume a matching grant.
- [ ] No command accepts a bare path as authorization to read or write a file.
- [ ] Prior file-selection, progress, and cancellation behavior is preserved.
- [ ] A failed export removes its temporary output and leaves any prior destination intact.
- [ ] A wrong-intent or expired grant produces a visible error, not a fallback to a raw path.
